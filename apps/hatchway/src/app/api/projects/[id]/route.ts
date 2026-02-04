import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { getProjectRunnerId, enrichProjectWithRunnerStatus } from '@/lib/runner-utils';
import { randomUUID } from 'crypto';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';

// GET /api/projects/:id - Get single project
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    const { project } = await requireProjectOwnership(id);
    
    // Enrich project with runner connection status
    const enrichedProject = await enrichProjectWithRunnerStatus(project);

    return NextResponse.json({ project: enrichedProject });
  } catch (error) {
    // Handle auth errors (401, 403, 404)
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error fetching project:', error);
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
  }
}

// PATCH /api/projects/:id - Update project
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const executeUpdate = async () => {
    const { id } = await params;
    
    // Verify user owns this project
    await requireProjectOwnership(id);
    
    const updates = await req.json();

    // Validate allowed fields
    const allowedFields = [
      'name', 'description', 'originalPrompt', 'icon', 'status', 'projectType', 'runCommand',
      'port', 'devServerPid', 'devServerPort', 'devServerStatus', 'runnerId', 'generationState',
      'lastActivityAt', 'errorMessage'
    ];

    const filteredUpdates = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key];
        return obj;
      }, {} as Record<string, unknown>);

    if (Object.keys(filteredUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Wrap database update in span for tracing
    const updated = await Sentry.startSpan(
      {
        name: `api.projects.update${filteredUpdates.generationState ? '.generationState' : ''}`,
        op: 'db.update',
        attributes: {
          'project.id': id,
          'update.fields': Object.keys(filteredUpdates).join(','),
          'update.hasGenerationState': !!filteredUpdates.generationState,
        },
      },
      async () => {
        return await db.update(projects)
          .set(filteredUpdates)
          .where(eq(projects.id, id))
          .returning();
      }
    );

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ project: updated[0] });
  };
  
  try {
    return await executeUpdate();
  } catch (error) {
    // Handle auth errors (401, 403, 404)
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('❌ Error updating project:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

// DELETE /api/projects/:id - Delete project
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { deleteFiles = false } = await req.json().catch(() => ({ deleteFiles: false }));

    // Verify user owns this project (also returns project details)
    const { project } = await requireProjectOwnership(id);

    // Kill dev server if running
    if (project.devServerPid) {
      try {
        process.kill(project.devServerPid);
        console.log(`🔪 Killed dev server process: ${project.devServerPid}`);
      } catch (error) {
        console.warn('Failed to kill process:', error);
      }
    }

    // Delete from database (cascade will delete messages and running_processes)
    await db.delete(projects).where(eq(projects.id, id));

    // Instrument project deletion metric
    Sentry.metrics.count('project_delete', 1, {
      attributes: {
        project_id: id,
        delete_files: deleteFiles.toString(),
        had_dev_server: (!!project.devServerPid).toString()
      }
    });

    // Optionally delete filesystem - delegate to runner
    let filesDeleted = false;
    if (deleteFiles && project.slug) {
      try {
        // Try to use project's saved runner, fallback to any available runner
        const runnerId = await getProjectRunnerId(project.runnerId);

        if (!runnerId) {
          console.warn(`No runners connected - skipping file deletion for ${project.slug}`);
        } else {
          // Send command to runner - it will delete files from its workspace
          try {
            await sendCommandToRunner(runnerId, {
              id: randomUUID(),
              type: 'delete-project-files',
              projectId: id,
              timestamp: new Date().toISOString(),
              payload: {
                slug: project.slug,
              },
            });
            filesDeleted = true;
          } catch (sendError) {
            console.warn(`Failed to send delete command to runner:`, sendError);
          }
        }
      } catch (error) {
        console.warn('⚠️  Failed to send delete command to runner:', error);
        // Don't fail the request - project is already deleted from DB
      }
    } else if (deleteFiles) {
      console.warn('⚠️  Cannot delete files: project slug not found');
    }

    return NextResponse.json({
      success: true,
      filesDeleted,
      filesRequested: deleteFiles,
    });
  } catch (error) {
    // Handle auth errors (401, 403, 404)
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
