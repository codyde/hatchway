import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { buildMetrics, projects } from '@hatchway/agent-core/lib/db/schema';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  handleAuthError,
  isLocalMode,
  isProjectAccessibleBy,
  requireAuth,
  requireOperationalAccess,
} from '@/lib/auth-helpers';

function parseLimit(value: string | null, fallback = 25, max = 100): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * GET /api/build-metrics
 *
 * Inspect recent build timing/cost metrics.
 * Auth:
 * - local mode: open
 * - signed-in users: own projects (or legacy null-owner)
 * - OPS_SECRET bearer: all projects
 *
 * Query params:
 * - projectId?: uuid
 * - buildId?: string
 * - commandId?: string
 * - limit?: number (default 25, max 100)
 * - includeRaw?: "1" to include full metrics JSON
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const buildId = url.searchParams.get('buildId');
    const commandId = url.searchParams.get('commandId');
    const includeRaw = url.searchParams.get('includeRaw') === '1';
    const limit = parseLimit(url.searchParams.get('limit'));

    let allowAllProjects = isLocalMode();
    let userId: string | null = null;

    if (!allowAllProjects) {
      const opsSecret = process.env.OPS_SECRET;
      const authHeader = request.headers.get('Authorization');
      if (opsSecret && authHeader) {
        try {
          await requireOperationalAccess(request);
          allowAllProjects = true;
        } catch {
          // Fall through to session auth
        }
      }

      if (!allowAllProjects) {
        const session = await requireAuth();
        userId = session.user.id;
      }
    }

    if (!allowAllProjects && projectId) {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
        columns: { id: true, userId: true },
      });
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      if (!userId || !isProjectAccessibleBy(project, userId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const conditions: SQL[] = [];
    if (projectId) conditions.push(eq(buildMetrics.projectId, projectId));
    if (buildId) conditions.push(eq(buildMetrics.buildId, buildId));
    if (commandId) conditions.push(eq(buildMetrics.commandId, commandId));

    // When scoped to a user without a project filter, over-fetch then filter.
    const fetchLimit = allowAllProjects || projectId ? limit : Math.min(limit * 5, 200);

    const rows = await db
      .select({
        id: buildMetrics.id,
        projectId: buildMetrics.projectId,
        sessionId: buildMetrics.sessionId,
        buildId: buildMetrics.buildId,
        commandId: buildMetrics.commandId,
        status: buildMetrics.status,
        agent: buildMetrics.agent,
        model: buildMetrics.model,
        totalMs: buildMetrics.totalMs,
        orchestrationMs: buildMetrics.orchestrationMs,
        agentMs: buildMetrics.agentMs,
        timeToFirstChunkMs: buildMetrics.timeToFirstChunkMs,
        runnerOverheadMs: buildMetrics.runnerOverheadMs,
        totalTokens: buildMetrics.totalTokens,
        inputTokens: buildMetrics.inputTokens,
        outputTokens: buildMetrics.outputTokens,
        cacheReadInputTokens: buildMetrics.cacheReadInputTokens,
        cacheCreationInputTokens: buildMetrics.cacheCreationInputTokens,
        numTurns: buildMetrics.numTurns,
        totalCostUsd: buildMetrics.totalCostUsd,
        dependencyInstallTotalMs: buildMetrics.dependencyInstallTotalMs,
        dependencyInstallCalls: buildMetrics.dependencyInstallCalls,
        modifiedFileCount: buildMetrics.modifiedFileCount,
        completedTodoCount: buildMetrics.completedTodoCount,
        error: buildMetrics.error,
        createdAt: buildMetrics.createdAt,
        ...(includeRaw ? { metrics: buildMetrics.metrics } : {}),
        projectName: projects.name,
        projectSlug: projects.slug,
        projectUserId: projects.userId,
        isAutoFix: sql<boolean | null>`(
          select gs.is_auto_fix
          from generation_sessions gs
          where gs.id = ${buildMetrics.sessionId}
          limit 1
        )`,
      })
      .from(buildMetrics)
      .leftJoin(projects, eq(buildMetrics.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(buildMetrics.createdAt))
      .limit(fetchLimit);

    const filtered = (allowAllProjects || projectId
      ? rows
      : rows.filter((row) =>
          isProjectAccessibleBy({ userId: row.projectUserId }, userId!)
        )
    ).slice(0, limit);

    const metrics = filtered.map(({ projectUserId: _projectUserId, ...rest }) => rest);

    return NextResponse.json({
      count: metrics.length,
      metrics,
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[build-metrics] Failed to list metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to list build metrics',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
