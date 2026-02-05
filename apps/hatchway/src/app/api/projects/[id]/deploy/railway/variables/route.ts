import { NextResponse } from 'next/server';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import { createRailwayClient } from '@/lib/railway';

/**
 * GET /api/projects/:id/deploy/railway/variables
 * Get environment variables for the Railway service
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    const variables = await railway.getVariables(
      project.railwayProjectId,
      project.railwayEnvironmentId,
      project.railwayServiceId
    );

    return NextResponse.json({ variables });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Variables] Error fetching variables:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch variables' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/projects/:id/deploy/railway/variables
 * Update environment variables for the Railway service
 * Body: { variables: Record<string, string> }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    const body = await req.json() as { variables: Record<string, string> };
    
    if (!body.variables || typeof body.variables !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body. Expected { variables: Record<string, string> }' },
        { status: 400 }
      );
    }

    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    await railway.setVariables(
      project.railwayProjectId,
      project.railwayEnvironmentId,
      project.railwayServiceId,
      body.variables
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Variables] Error updating variables:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update variables' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/:id/deploy/railway/variables
 * Delete a single environment variable
 * Body: { name: string }
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    const body = await req.json() as { name: string };
    
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request body. Expected { name: string }' },
        { status: 400 }
      );
    }

    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    await railway.deleteVariable(
      project.railwayProjectId,
      project.railwayEnvironmentId,
      project.railwayServiceId,
      body.name
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Variables] Error deleting variable:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete variable' },
      { status: 500 }
    );
  }
}
