import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { runningProcesses, projects } from '@hatchway/agent-core/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { authenticateRunnerRequest, authenticateRunnerKey, extractRunnerKey, isLocalMode } from '@/lib/auth-helpers';

/**
 * Get list of running processes for health checking
 * GET /api/runner/process/list?runnerId=xxx (optional filter)
 * 
 * Authentication modes:
 * - Local mode: No filtering (all processes returned)
 * - Shared secret: No user filtering (legacy support, returns all processes)
 * - Runner key: Filter by user's projects only
 */
export async function GET(request: Request) {
  try {
    if (!await authenticateRunnerRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const runnerId = searchParams.get('runnerId');

    // Helper to fetch processes with optional runnerId filter
    const fetchProcesses = async (projectFilter?: string[]) => {
      if (projectFilter && projectFilter.length === 0) {
        return [];
      }
      
      if (runnerId && projectFilter) {
        return db.select().from(runningProcesses).where(
          and(
            eq(runningProcesses.runnerId, runnerId),
            inArray(runningProcesses.projectId, projectFilter)
          )
        );
      } else if (runnerId) {
        return db.select().from(runningProcesses).where(eq(runningProcesses.runnerId, runnerId));
      } else if (projectFilter) {
        return db.select().from(runningProcesses).where(inArray(runningProcesses.projectId, projectFilter));
      } else {
        return db.select().from(runningProcesses);
      }
    };

    // In local mode, return all processes (no multi-tenancy)
    if (isLocalMode()) {
      const processes = await fetchProcesses();
      return NextResponse.json({ processes });
    }

    // Check if authenticated with a runner key (for user-scoped filtering)
    const runnerKey = extractRunnerKey(request);
    
    if (runnerKey) {
      // Runner key auth - filter by user's projects
      const authResult = await authenticateRunnerKey(runnerKey);
      if (!authResult) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Get project IDs owned by this user
      const userProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.userId, authResult.userId));

      const projectIds = userProjects.map(p => p.id);
      const processes = await fetchProcesses(projectIds);
      return NextResponse.json({ processes });
    }

    // Shared secret auth (legacy) - return all processes
    // authenticateRunnerRequest already validated the shared secret
    const processes = await fetchProcesses();
    return NextResponse.json({ processes });
  } catch (error) {
    console.error('Failed to fetch running processes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch running processes' },
      { status: 500 }
    );
  }
}
