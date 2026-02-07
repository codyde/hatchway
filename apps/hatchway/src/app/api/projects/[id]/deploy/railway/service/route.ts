import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import { createRailwayClient } from '@/lib/railway';

/**
 * DELETE /api/projects/:id/deploy/railway/service
 * Delete the Railway service (keeps project) or delete entire Railway project
 * Query params:
 * - deleteProject=true to delete the entire Railway project
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    const url = new URL(req.url);
    const deleteProject = url.searchParams.get('deleteProject') === 'true';

    if (!project.railwayProjectId || !project.railwayServiceId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);

    if (deleteProject) {
      // Delete all services in the Railway project, then try to delete the project itself.
      // OAuth tokens may not have permission for projectDelete, so we delete services
      // individually first and treat the project deletion as best-effort.
      const projectDetails = await railway.getProject(project.railwayProjectId);
      for (const service of projectDetails.services) {
        try {
          await railway.deleteService(service.id);
        } catch (err) {
          console.warn(`Failed to delete Railway service ${service.id}:`, err);
        }
      }
      try {
        await railway.deleteProject(project.railwayProjectId);
      } catch (err) {
        console.warn('Failed to delete Railway project (OAuth may lack permission):', err);
      }
    } else {
      // Just delete the service
      await railway.deleteService(project.railwayServiceId);
    }

    // Clear Railway info from our project record
    await db.update(projects)
      .set({
        railwayProjectId: null,
        railwayServiceId: null,
        railwayEnvironmentId: null,
        railwayDatabaseServiceId: null,
        railwayDomain: null,
        railwayDeploymentStatus: null,
        railwayLastDeployedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    return NextResponse.json({
      success: true,
      message: deleteProject 
        ? 'Railway project deleted successfully'
        : 'Railway service deleted successfully',
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Service] Error deleting:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete Railway service' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/:id/deploy/railway/service/redeploy
 * Redeploy the service
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    if (!project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    await railway.redeployService(
      project.railwayServiceId,
      project.railwayEnvironmentId
    );

    // Update deployment status
    await db.update(projects)
      .set({
        railwayDeploymentStatus: 'deploying',
        railwayLastDeployedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    return NextResponse.json({
      success: true,
      message: 'Redeployment triggered successfully',
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Service] Error redeploying:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to redeploy service' },
      { status: 500 }
    );
  }
}
