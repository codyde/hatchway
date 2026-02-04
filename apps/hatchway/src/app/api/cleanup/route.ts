import { NextResponse } from 'next/server';
import { findStaleProjects, markStaleProjectsAsFailed } from '@hatchway/agent-core/lib/stale-projects';

// GET /api/cleanup - Find stale projects
export async function GET() {
  try {
    const staleProjects = await findStaleProjects();

    return NextResponse.json({
      staleProjects,
      count: staleProjects.length,
    });
  } catch (error) {
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
export async function POST() {
  try {
    console.log('🧹 Cleaning up stale projects...');
    const count = await markStaleProjectsAsFailed();

    return NextResponse.json({
      message: `Marked ${count} stale project(s) as failed`,
      count,
    });
  } catch (error) {
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
