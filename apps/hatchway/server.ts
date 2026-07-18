// MUST be first: polyfill globalThis.AsyncLocalStorage before any Next module loads.
import './polyfill-als';

// Load .env.local for local development (Railway injects env vars directly)
import { config } from 'dotenv';
config({ path: '.env.local' });

// Force webpack mode instead of Turbopack for consistent builds
// This must be set before importing next
process.env.__NEXT_BUNDLER = 'webpack';

/**
 * Custom Next.js Server with WebSocket Support
 * 
 * This file creates a custom server that:
 * 1. Runs the Next.js app
 * 2. Adds WebSocket server for real-time updates (frontend clients on /ws)
 * 3. Adds WebSocket server for runner connections (/ws/runner)
 * 4. Handles both HTTP and WebSocket on the same port
 * 
 * Environment variables are loaded via --env-file flag in package.json scripts
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { buildWebSocketServer, db } from '@hatchway/agent-core';
import { onRunnerStatusChange } from '@hatchway/agent-core/lib/runner/broker-state';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { projectEvents } from './src/lib/project-events';
import { enrichProjectWithRunnerStatus } from './src/lib/runner-utils';
import { getAuth } from './src/lib/auth';
import { isProjectAccessibleBy } from './src/lib/auth-helpers';
import { fromNodeHeaders } from 'better-auth/node';

/**
 * Idempotent schema ensure for build metrics persistence.
 * Prefer this over full drizzle migrate on boot because production DBs may
 * predate a complete migration journal.
 */
async function ensureBuildMetricsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "build_metrics" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "project_id" uuid NOT NULL,
      "session_id" uuid,
      "build_id" text,
      "command_id" text,
      "status" text NOT NULL,
      "agent" text,
      "model" text,
      "total_ms" integer,
      "orchestration_ms" integer,
      "agent_ms" integer,
      "time_to_first_chunk_ms" integer,
      "runner_overhead_ms" integer,
      "total_tokens" integer,
      "input_tokens" integer,
      "output_tokens" integer,
      "cache_read_input_tokens" integer,
      "cache_creation_input_tokens" integer,
      "num_turns" integer,
      "total_cost_usd" text,
      "dependency_install_total_ms" integer,
      "dependency_install_calls" integer,
      "modified_file_count" integer,
      "completed_todo_count" integer,
      "error" text,
      "metrics" jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "build_metrics"
        ADD CONSTRAINT "build_metrics_project_id_projects_id_fk"
        FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
        ON DELETE cascade ON UPDATE no action;
    EXCEPTION
      WHEN duplicate_object THEN null;
      WHEN undefined_table THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "build_metrics"
        ADD CONSTRAINT "build_metrics_session_id_generation_sessions_id_fk"
        FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id")
        ON DELETE set null ON UPDATE no action;
    EXCEPTION
      WHEN duplicate_object THEN null;
      WHEN undefined_table THEN null;
    END $$
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "build_metrics_project_id_idx" ON "build_metrics" ("project_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "build_metrics_session_id_idx" ON "build_metrics" ("session_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "build_metrics_build_id_idx" ON "build_metrics" ("build_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "build_metrics_created_at_idx" ON "build_metrics" ("created_at")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "build_metrics_command_id_unique" ON "build_metrics" ("command_id")`);
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Log environment configuration for debugging
console.log('[server] Environment loaded:');
console.log('[server]   NODE_ENV:', process.env.NODE_ENV);
console.log('[server]   HATCHWAY_LOCAL_MODE:', process.env.HATCHWAY_LOCAL_MODE);
console.log('[server]   RUNNER_SHARED_SECRET:', process.env.RUNNER_SHARED_SECRET ? '***set***' : '***NOT SET***');

// WebSocket paths that should NOT be handled by Next.js
const WS_PATHS = ['/ws', '/ws/runner'];

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  if (process.env.DATABASE_URL) {
    try {
      await ensureBuildMetricsTable();
      console.log('[server] build_metrics table ready');
    } catch (error) {
      console.error('[server] Failed to ensure build_metrics table (continuing startup):', error);
    }
  } else {
    console.warn('[server] DATABASE_URL not set; skipping build_metrics ensure');
  }

  // Create HTTP server
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      const pathname = parsedUrl.pathname || '';
      
      // Don't let Next.js handle WebSocket paths
      // The ws library handles these via the 'upgrade' event
      if (WS_PATHS.some(wsPath => pathname.startsWith(wsPath))) {
        // Return 400 for non-upgrade HTTP requests to WebSocket paths
        // (Actual WebSocket upgrades are handled by the 'upgrade' event listener)
        res.statusCode = 400;
        res.end('WebSocket endpoint - use ws:// protocol');
        return;
      }
      
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  // Initialize WebSocket server on the same HTTP server
  // This sets up both /ws (frontend) and /ws/runner (runner) WebSocket servers
  buildWebSocketServer.initialize(server, '/ws');

  // Authenticate frontend WebSocket clients. Upgrade requests bypass Next.js
  // middleware, so the better-auth session must be validated here.
  buildWebSocketServer.setClientAuth(
    async (req) => {
      try {
        const session = await getAuth().api.getSession({
          headers: fromNodeHeaders(req.headers),
        });
        return session?.user?.id ? { userId: session.user.id } : null;
      } catch (error) {
        console.error('[server] WebSocket session validation failed:', error);
        return null;
      }
    },
    async (userId, projectId) => {
      const rows = await db
        .select({ userId: projects.userId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (rows.length === 0) return false;
      // Shared ownership rule - same as the HTTP API's requireProjectOwnership
      return isProjectAccessibleBy(rows[0], userId);
    }
  );

  // Register callback for runner status changes to update UI in real-time
  onRunnerStatusChange(async (runnerId, connected, affectedProjectIds) => {
    console.log(`[server] Runner ${runnerId} ${connected ? 'connected' : 'disconnected'}, notifying ${affectedProjectIds.length} projects`);

    // Emit project events for each affected project so SSE clients get updated
    for (const projectId of affectedProjectIds) {
      try {
        // Fetch the current project data from DB
        const projectData = await db
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        if (projectData.length > 0) {
          // Enrich with runner status and emit
          const enrichedProject = await enrichProjectWithRunnerStatus(projectData[0]);
          projectEvents.emitProjectUpdate(projectId, enrichedProject);
        }
      } catch (error) {
        console.error(`[server] Failed to emit project update for ${projectId}:`, error);
      }
    }
  });

  // Start listening
  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket server on ws://${hostname}:${port}/ws`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n> Shutting down gracefully...');
    buildWebSocketServer.shutdown();
    server.close(() => {
      console.log('> Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
});

