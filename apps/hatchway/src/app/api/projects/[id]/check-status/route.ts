import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects, serverOperations } from '@hatchway/agent-core/lib/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { projectEvents } from '@/lib/project-events';

// Timeout thresholds
const STARTING_TIMEOUT_MS = 60000; // 60 seconds for starting state
const STOPPING_TIMEOUT_MS = 30000; // 30 seconds for stopping state

/**
 * GET /api/projects/:id/check-status
 * 
 * Check if a project is stuck in a transitional state and handle timeouts.
 * This endpoint can be called by the frontend when it suspects a stuck state.
 * 
 * Returns:
 * - ok: true if status is valid
 * - timeout: true if status was stuck and has been reset
 * - status: current devServerStatus
 * - statusAge: how long the current status has been set (in ms)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get project with status timestamp
    const [project] = await db.select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const now = new Date();
    const statusUpdatedAt = project.devServerStatusUpdatedAt || project.updatedAt;
    const statusAge = now.getTime() - statusUpdatedAt.getTime();

    // Check for stuck states
    let isStuck = false;
    let timeoutThreshold = 0;

    if (project.devServerStatus === 'starting') {
      timeoutThreshold = STARTING_TIMEOUT_MS;
      isStuck = statusAge > timeoutThreshold;
    } else if (project.devServerStatus === 'stopping') {
      timeoutThreshold = STOPPING_TIMEOUT_MS;
      isStuck = statusAge > timeoutThreshold;
    }

    if (isStuck) {
      console.log(`[check-status] ⏰ Project ${id} stuck in '${project.devServerStatus}' for ${Math.round(statusAge / 1000)}s (threshold: ${timeoutThreshold / 1000}s)`);

      // Mark as failed due to timeout
      const [updated] = await db.update(projects)
        .set({
          devServerStatus: 'failed',
          devServerStatusUpdatedAt: now,
          errorMessage: `Operation timed out after ${Math.round(statusAge / 1000)} seconds. The server may have failed to start or the runner may be disconnected.`,
          lastActivityAt: now,
        })
        .where(eq(projects.id, id))
        .returning();

      // Also mark any pending/sent operations as timeout
      await db.update(serverOperations)
        .set({
          status: 'timeout',
          error: 'Operation timed out',
          completedAt: now,
        })
        .where(
          and(
            eq(serverOperations.projectId, id),
            inArray(serverOperations.status, ['pending', 'sent', 'ack'])
          )
        );

      // Emit update to SSE subscribers
      if (updated) {
        projectEvents.emitProjectUpdate(id, updated);
      }

      return NextResponse.json({
        ok: false,
        timeout: true,
        previousStatus: project.devServerStatus,
        status: 'failed',
        statusAge,
        message: `Status was stuck in '${project.devServerStatus}' for ${Math.round(statusAge / 1000)}s. Marked as failed.`,
      });
    }

    // Get latest operation for context
    const [latestOperation] = await db.select()
      .from(serverOperations)
      .where(eq(serverOperations.projectId, id))
      .orderBy(desc(serverOperations.createdAt))
      .limit(1);

    return NextResponse.json({
      ok: true,
      timeout: false,
      status: project.devServerStatus,
      statusAge,
      port: project.devServerPort,
      latestOperation: latestOperation ? {
        id: latestOperation.id,
        operation: latestOperation.operation,
        status: latestOperation.status,
        createdAt: latestOperation.createdAt,
        error: latestOperation.error,
      } : null,
    });

  } catch (error) {
    console.error('Error checking project status:', error);
    return NextResponse.json(
      { error: 'Failed to check status', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
