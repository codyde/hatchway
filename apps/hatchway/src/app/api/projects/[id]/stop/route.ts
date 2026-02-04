import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { releasePortForProject } from '@hatchway/agent-core/lib/port-allocator';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { getProjectRunnerId } from '@/lib/runner-utils';
import type { StopDevServerCommand } from '@/shared/runner/messages';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';

// POST /api/projects/:id/stop - Stop dev server
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    console.log(`[stop-route] ⛔ Received stop request for project ${id}`);

    // Verify user owns this project
    const { project } = await requireProjectOwnership(id);

    // Try to use project's saved runner, fallback to any available runner
    const runnerId = await getProjectRunnerId(project.runnerId);

    if (!runnerId) {
      return NextResponse.json(
        { error: 'No runners connected' },
        { status: 503 }
      );
    }

    // Update status to stopping
    await db.update(projects)
      .set({
        devServerStatus: 'stopping',
        lastActivityAt: new Date(),
      })
      .where(eq(projects.id, id));

    // Stop tunnel first if it exists
    if (project.tunnelUrl) {
      const stopTunnelCommand = {
        id: randomUUID(),
        type: 'stop-tunnel' as const,
        projectId: id,
        timestamp: new Date().toISOString(),
        payload: {
          port: project.devServerPort || 0,
        },
      };

      try {
        await sendCommandToRunner(runnerId, stopTunnelCommand);
        console.log(`🔌 Sent stop-tunnel command for project ${id}`);
      } catch (error) {
        console.warn(`Failed to stop tunnel for project ${id}:`, error);
        // Continue anyway - tunnel might already be stopped
      }
    }

    const command: StopDevServerCommand = {
      id: randomUUID(),
      type: 'stop-dev-server',
      projectId: id,
      timestamp: new Date().toISOString(),
    };

    await sendCommandToRunner(runnerId, command);

    // Release port allocation immediately
    // The runner will handle killing the process, but we free the port now
    await releasePortForProject(id);
    
    // Clear port and tunnel info from database
    await db.update(projects)
      .set({
        devServerPort: null,
        tunnelUrl: null,
        devServerStatus: 'stopped',
        lastActivityAt: new Date(),
      })
      .where(eq(projects.id, id));

    console.log(`🛑 Released port allocation for project ${id}`);
    console.log(`[stop-route] ✅ Completed stop request for project ${id}`);

    return NextResponse.json({
      message: 'Dev server stop requested',
    }, { status: 202 });

  } catch (error) {
    // Handle auth errors (401, 403, 404)
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error stopping dev server:', error);

    if (error instanceof Error && /not connected/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Runner is not connected' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to stop dev server',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
