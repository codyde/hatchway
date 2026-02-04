import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects, serverOperations } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  getRunCommand,
  reserveOrReallocatePort,
  buildEnvForFramework
} from '@hatchway/agent-core/lib/port-allocator';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { getProjectRunnerId } from '@/lib/runner-utils';
import type { StartDevServerCommand } from '@/shared/runner/messages';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';

// POST /api/projects/:id/start - Start dev server
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify user owns this project
    const { project: proj } = await requireProjectOwnership(id);

    // Get the project's runner - no fallback to other runners
    const runnerId = await getProjectRunnerId(proj.runnerId);

    if (!runnerId) {
      // Provide specific error based on whether project has a runner assigned
      const errorMessage = proj.runnerId 
        ? `Project runner '${proj.runnerId}' is not connected`
        : 'No runners connected';
      return NextResponse.json(
        { error: errorMessage },
        { status: 503 }
      );
    }

    // Check if already running
    if (proj.devServerStatus === 'running' && proj.devServerPid) {
      return NextResponse.json({
        message: 'Dev server already running',
        pid: proj.devServerPid,
        port: proj.devServerPort,
      });
    }

    // Ensure we have a run command
    if (!proj.runCommand) {
      return NextResponse.json({
        error: 'No run command configured for this project'
      }, { status: 400 });
    }

    if (!proj.path) {
      return NextResponse.json({
        error: 'Project path is not set'
      }, { status: 400 });
    }

    // Operation ID declared outside try block so catch can access it
    let operationId: string | undefined;
    
    try {
      console.log(`🚀 Starting dev server for ${proj.name}`);
      console.log(`   Previous port: ${proj.devServerPort ?? 'none'}, Framework: ${proj.detectedFramework ?? 'unknown'}`);

      // Step 1: Allocate port BEFORE spawning (proactive allocation)
      // Skip local port availability checks for remote runners (they run on different machines)
      const isRemoteRunner = runnerId !== 'local';
      const portInfo = await reserveOrReallocatePort({
        projectId: id,
        projectType: proj.projectType,
        runCommand: proj.runCommand,
        preferredPort: proj.devServerPort, // Try to reuse existing port if available
        detectedFramework: proj.detectedFramework, // Framework detected during build
      }, isRemoteRunner); // Skip port check for remote runners

      // Log if port changed (helps debug port drift issues)
      if (proj.devServerPort && proj.devServerPort !== portInfo.port) {
        console.warn(`⚠️ Port changed for ${proj.name}: ${proj.devServerPort} → ${portInfo.port} (framework: ${portInfo.framework})`);
      }
      
      console.log(`📍 Allocated port ${portInfo.port} for framework ${portInfo.framework}`);

      // Step 2: Create operation record for tracking
      operationId = randomUUID();
      await db.insert(serverOperations).values({
        id: operationId,
        projectId: id,
        operation: 'start',
        status: 'pending',
        runnerId: runnerId,
        port: portInfo.port,
        metadata: { framework: portInfo.framework },
      });

      // Step 3: Update database with allocated port BEFORE sending command
      // This makes devServerPort the single source of truth
      const now = new Date();
      await db.update(projects)
        .set({
          devServerStatus: 'starting',
          devServerStatusUpdatedAt: now,
          devServerPort: portInfo.port,
          errorMessage: null,
          lastActivityAt: now,
        })
        .where(eq(projects.id, id));

      // Step 4: Build environment variables for port (frameworks read PORT env var)
      const portEnv = buildEnvForFramework(portInfo.framework, portInfo.port);
      const runCommand = getRunCommand(proj.runCommand);

      console.log(`📝 Run command: ${runCommand}`);
      console.log(`🔧 Port environment: ${JSON.stringify(portEnv)}`);

      // Step 5: Send command to runner with pre-allocated port
      const runnerCommand: StartDevServerCommand = {
        id: operationId, // Use the operation ID for correlation
        type: 'start-dev-server',
        projectId: id,
        timestamp: new Date().toISOString(),
        payload: {
          runCommand,
          workingDirectory: proj.path,
          env: portEnv,
          preferredPort: portInfo.port,
        },
      };

      await sendCommandToRunner(runnerId, runnerCommand);

      // Step 6: Mark operation as sent
      await db.update(serverOperations)
        .set({
          status: 'sent',
          sentAt: new Date(),
        })
        .where(eq(serverOperations.id, operationId));

      return NextResponse.json({
        message: 'Dev server start requested',
        port: portInfo.port,
        operationId, // Return operation ID for tracking
      }, { status: 202 });

    } catch (error) {
      // Extract and enhance error message for better user feedback
      let errorMessage = 'Failed to start dev server';
      let userFriendlyMessage = errorMessage;
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Provide user-friendly messages for common port allocation errors
        if (errorMessage.includes('All ports in range')) {
          const match = errorMessage.match(/(\d+)-(\d+)/);
          if (match) {
            const [, start, end] = match;
            userFriendlyMessage = 
              `All ports (${start}-${end}) are currently in use. ` +
              `Please stop other dev servers to free up ports.`;
          } else {
            userFriendlyMessage = 'All available ports are in use. Please stop other dev servers.';
          }
        } else if (errorMessage.includes('No available ports')) {
          userFriendlyMessage = 'No available ports found. Please stop other dev servers or check your system.';
        } else if (errorMessage.includes('Unable to allocate port')) {
          userFriendlyMessage = 'Could not allocate a port. Please ensure ports are available.';
        } else {
          // Use the original error message if it's already clear
          userFriendlyMessage = errorMessage;
        }
      }

      // Update project status with user-friendly error message
      const failedAt = new Date();
      await db.update(projects)
        .set({
          devServerStatus: 'failed',
          devServerStatusUpdatedAt: failedAt,
          devServerPort: null,
          errorMessage: userFriendlyMessage,
        })
        .where(eq(projects.id, id));

      // Mark operation as failed if it was created
      if (typeof operationId !== 'undefined') {
        await db.update(serverOperations)
          .set({
            status: 'failed',
            error: userFriendlyMessage,
            failureReason: errorMessage.includes('port') ? 'port_in_use' : 'unknown',
            completedAt: failedAt,
          })
          .where(eq(serverOperations.id, operationId));
      }

      // Re-throw with enhanced message
      const enhancedError = new Error(userFriendlyMessage);
      enhancedError.stack = error instanceof Error ? error.stack : undefined;
      throw enhancedError;
    }

  } catch (error) {
    // Handle auth errors (401, 403, 404)
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error starting dev server:', error);

    if (error instanceof Error && /not connected/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Runner is not connected' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to start dev server',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
