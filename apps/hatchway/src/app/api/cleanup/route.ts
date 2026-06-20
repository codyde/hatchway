import { NextResponse } from 'next/server';
import { findStaleProjects, markStaleProjectsAsFailed } from '@hatchway/agent-core/lib/stale-projects';
import { requireOperationalAccess, handleAuthError } from '@/lib/auth-helpers';

// GET /api/cleanup - Find stale projects
export async function GET(request: Request) {
  try {
    await requireOperationalAccess(request);

    const staleProjects = await findStaleProjects();

    return NextResponse.json({
      staleProjects,
      count: staleProjects.length,
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('Error finding stale projects:', error);
    return NextResponse.json(
      {
        error: 'Failed to find stale projects',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// POST /api/cleanup - Mark stale projects as failed
export async function POST(request: Request) {
  try {
    await requireOperationalAccess(request);

    console.log('🧹 Cleaning up stale projects...');
    const count = await markStaleProjectsAsFailed();

    return NextResponse.json({
      message: `Marked ${count} stale project(s) as failed`,
      count,
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('Error cleaning up stale projects:', error);
    return NextResponse.json(
      {
        error: 'Failed to cleanup stale projects',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
