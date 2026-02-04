// Load .env.local for local development (Railway injects env vars directly)
import { config } from 'dotenv';
config({ path: '.env.local' });

// Force webpack mode instead of Turbopack for consistent builds
// This must be set before importing next
process.env.__NEXT_BUNDLER = 'webpack';

import './sentry.server.config';
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
import { eq } from 'drizzle-orm';
import { projectEvents } from './src/lib/project-events';
import { enrichProjectWithRunnerStatus } from './src/lib/runner-utils';

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

app.prepare().then(() => {
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

