import { NextResponse } from 'next/server';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import { createRailwayClient } from '@/lib/railway';
import type { RailwayServiceInstanceUpdateInput } from '@/lib/railway/types';

/**
 * GET /api/projects/:id/deploy/railway/settings
 * Get service instance settings
 */
export async function GET(
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
    const settings = await railway.getServiceInstance(
      project.railwayServiceId,
      project.railwayEnvironmentId
    );

    return NextResponse.json({ settings });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Settings] Error fetching settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/projects/:id/deploy/railway/settings
 * Update service instance settings
 * Body: RailwayServiceInstanceUpdateInput
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    const body = await req.json() as RailwayServiceInstanceUpdateInput;

    if (!project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    await railway.updateServiceInstance(
      project.railwayServiceId,
      project.railwayEnvironmentId,
      body
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Settings] Error updating settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
