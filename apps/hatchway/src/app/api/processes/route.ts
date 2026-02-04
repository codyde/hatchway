import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { or, eq } from 'drizzle-orm';
import { getAllProcesses } from '@hatchway/agent-core/lib/process-manager';

// GET /api/processes - List all running dev servers
export async function GET() {
  try {
    // Get processes from database (source of truth)
    const runningProjects = await db.select()
      .from(projects)
      .where(
        or(
          eq(projects.devServerStatus, 'running'),
          eq(projects.devServerStatus, 'starting')
        )
      );

    // Also get in-memory processes for verification
    const inMemoryProcesses = getAllProcesses();

    const processData = runningProjects.map((project) => {
      const inMemoryInfo = inMemoryProcesses.get(project.id);

      return {
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        pid: project.devServerPid || null,
        port: project.devServerPort || null,
        tunnelUrl: project.tunnelUrl || null,
        status: project.devServerStatus,
        inMemory: !!inMemoryInfo, // Flag to show if process is tracked in memory
        runnerId: process.env.RUNNER_DEFAULT_ID ?? 'default', // TODO: Store per-project runner assignment
      };
    });

    return NextResponse.json({ processes: processData });
  } catch (error) {
    console.error('Error fetching processes:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch processes',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
