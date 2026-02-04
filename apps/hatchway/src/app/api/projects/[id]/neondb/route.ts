import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import type { NeonDBStatus } from '@hatchway/agent-core';

/**
 * GET /api/projects/:id/neondb
 * Get NeonDB integration status for a project
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    const { project } = await requireProjectOwnership(id);

    // Check if database is claimed (no expiration or expired in past)
    const now = new Date();
    const isClaimed = !project.neondbExpiresAt || project.neondbExpiresAt < now;

    const status: NeonDBStatus = {
      isConnected: !!project.neondbHost || !!project.neondbConnectionString,
      host: project.neondbHost,
      database: project.neondbDatabase,
      claimUrl: project.neondbClaimUrl,
      createdAt: project.neondbCreatedAt,
      expiresAt: project.neondbExpiresAt,
      isClaimed: project.neondbClaimUrl === null && !!project.neondbHost, // If no claim URL but has host, it's claimed
    };

    return NextResponse.json({ status });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error fetching NeonDB status:', error);
    return NextResponse.json({ error: 'Failed to fetch NeonDB status' }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/:id/neondb
 * Disconnect NeonDB integration (clears all NeonDB fields)
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    await requireProjectOwnership(id);

    const [updated] = await db.update(projects)
      .set({
        neondbConnectionString: null,
        neondbClaimUrl: null,
        neondbHost: null,
        neondbDatabase: null,
        neondbCreatedAt: null,
        neondbExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true,
      message: 'NeonDB integration disconnected' 
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error disconnecting NeonDB:', error);
    return NextResponse.json({ error: 'Failed to disconnect NeonDB' }, { status: 500 });
  }
}
