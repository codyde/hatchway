/**
 * Force Complete API - Debug endpoint to reset stuck project state
 * 
 * POST /api/projects/:id/force-complete
 * 
 * This endpoint is used to manually reset stuck projects:
 * - Marks active generation sessions as completed
 * - Resets dev server status to 'stopped'
 * - Updates project status to 'completed'
 * 
 * Useful when projects get stuck due to bugs or connection issues.
 */

import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { generationSessions, projects } from '@hatchway/agent-core/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
    }

    const now = new Date();
    const changes: string[] = [];

    // Find all active sessions for this project
    const activeSessions = await db.select()
      .from(generationSessions)
      .where(
        and(
          eq(generationSessions.projectId, projectId),
          eq(generationSessions.status, 'active')
        )
      );

    // Mark all active sessions as completed
    if (activeSessions.length > 0) {
      await db.update(generationSessions)
        .set({
          status: 'completed',
          endedAt: now,
          updatedAt: now,
          summary: 'Build manually marked as completed (force-complete)',
        })
        .where(
          and(
            eq(generationSessions.projectId, projectId),
            eq(generationSessions.status, 'active')
          )
        );
      changes.push(`${activeSessions.length} session(s) marked complete`);
    }

    // Get current project state
    const [project] = await db.select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Build update object for project
    const projectUpdates: Record<string, unknown> = {
      lastActivityAt: now,
      updatedAt: now,
    };

    // Reset project status if stuck
    if (project.status === 'in_progress' || project.status === 'pending') {
      projectUpdates.status = 'completed';
      changes.push('project status → completed');
    }

    // Reset dev server status if stuck (starting, running but stale, etc.)
    if (project.devServerStatus && project.devServerStatus !== 'stopped') {
      projectUpdates.devServerStatus = 'stopped';
      projectUpdates.devServerPid = null;
      projectUpdates.devServerPort = null;
      changes.push(`dev server status: ${project.devServerStatus} → stopped`);
    }

    // Apply project updates
    if (Object.keys(projectUpdates).length > 2) { // More than just timestamps
      await db.update(projects)
        .set(projectUpdates)
        .where(eq(projects.id, projectId));
    }

    // Build response message
    const message = changes.length > 0 
      ? `Reset: ${changes.join(', ')}`
      : 'No stuck state found - project already clean';

    console.log(`[force-complete] ✅ ${message} for project ${projectId}`);

    return NextResponse.json({
      message,
      changes,
      sessionsCompleted: activeSessions.length,
      sessionIds: activeSessions.map(s => s.id),
    });
  } catch (error) {
    console.error('[force-complete] Error:', error);
    return NextResponse.json(
      { error: 'Failed to force-complete/reset project' },
      { status: 500 }
    );
  }
}
