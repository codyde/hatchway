import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { runningProcesses, projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { projectEvents } from '@/lib/project-events';
import { authenticateRunnerRequest } from '@/lib/auth-helpers';

/**
 * Receive health check report from runner
 * POST /api/runner/process/:projectId/health
 *
 * The runner checks ports locally and reports status here
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    if (!await authenticateRunnerRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const { port, status, failCount } = await request.json();

    if (!status || !['healthy', 'unhealthy'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be "healthy" or "unhealthy"' },
        { status: 400 }
      );
    }

    // If unhealthy for 3 consecutive checks, mark as failed
    if (status === 'unhealthy' && failCount >= 3) {
      console.log(`❌ Process failed for project ${projectId} after ${failCount} health check failures`);

      // Mark project as failed
      await db.update(projects)
        .set({
          devServerStatus: 'failed',
          devServerPort: null,
        })
        .where(eq(projects.id, projectId));

      // Remove from running processes
      await db.delete(runningProcesses)
        .where(eq(runningProcesses.projectId, projectId));

      // Emit event for real-time update
      const updatedProject = await db.select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (updatedProject.length > 0) {
        projectEvents.emitProjectUpdate(projectId, updatedProject[0]);
      }

      return NextResponse.json({ ok: true, action: 'marked_failed' });
    }

    // Update health check status
    await db.update(runningProcesses)
      .set({
        healthCheckFailCount: failCount || 0,
        lastHealthCheck: new Date(),
        ...(port && { port }),
      })
      .where(eq(runningProcesses.projectId, projectId));

    if (status === 'unhealthy') {
      console.log(`⚠️  Unhealthy check for project ${projectId} (fail ${failCount}/3)`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to process health check:', error);
    return NextResponse.json(
      { error: 'Failed to process health check' },
      { status: 500 }
    );
  }
}
