import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { runningProcesses } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { releasePortForProject } from '@hatchway/agent-core/lib/port-allocator';
import { authenticateRunnerRequest } from '@/lib/auth-helpers';

/**
 * Unregister a process when it exits
 * DELETE /api/runner/process/:projectId
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    if (!await authenticateRunnerRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    await db.delete(runningProcesses)
      .where(eq(runningProcesses.projectId, projectId));

    // Release the port allocation so it can be reused
    try {
      await releasePortForProject(projectId);
      console.log(`✅ Unregistered process and released port for project ${projectId}`);
    } catch (portError) {
      // Log but don't fail - process unregistration is more important
      console.warn(`⚠️ Failed to release port for project ${projectId}:`, portError);
      console.log(`✅ Unregistered process for project ${projectId} (port release failed)`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to unregister process:', error);
    return NextResponse.json(
      { error: 'Failed to unregister process' },
      { status: 500 }
    );
  }
}
