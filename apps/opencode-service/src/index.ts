#!/usr/bin/env node
/**
 * OpenCode Service
 * 
 * A wrapper service that:
 * 1. Starts an OpenCode server internally
 * 2. Validates runner key / shared secret authentication
 * 3. Proxies authenticated requests to OpenCode
 * 
 * This provides a unified AI service for both the frontend and runner.
 */

import express, { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { createOpencode } from '@opencode-ai/sdk';
import { authenticateRequest, isLocalMode } from './auth.js';

// Configuration
const PORT = parseInt(process.env.OPENCODE_SERVICE_PORT || '4096', 10);
const INTERNAL_PORT = parseInt(process.env.OPENCODE_INTERNAL_PORT || '4097', 10);
// Local mode disables auth, so never expose the service beyond loopback in that case
const HOST = process.env.OPENCODE_SERVICE_HOST
  || (process.env.HATCHWAY_LOCAL_MODE === 'true' ? '127.0.0.1' : '0.0.0.0');

async function main() {
  console.log('[opencode-service] Starting OpenCode service...');
  console.log(`[opencode-service] Local mode: ${isLocalMode()}`);
  
  // Start OpenCode server internally
  console.log(`[opencode-service] Starting internal OpenCode server on port ${INTERNAL_PORT}...`);
  
  let opencodeInstance: Awaited<ReturnType<typeof createOpencode>> | null = null;
  
  try {
    opencodeInstance = await createOpencode({
      hostname: '127.0.0.1',
      port: INTERNAL_PORT,
      timeout: 30000, // 30 second timeout for server start
      config: {
        // Default model - can be overridden per request
        model: process.env.OPENCODE_DEFAULT_MODEL || 'anthropic/claude-sonnet-4-6',
      },
    });
    
    console.log(`[opencode-service] Internal OpenCode server started at ${opencodeInstance.server.url}`);
  } catch (error) {
    console.error('[opencode-service] Failed to start internal OpenCode server:', error);
    console.error('[opencode-service] Make sure opencode-ai is installed globally or the opencode CLI is available');
    process.exit(1);
  }

  // Create Express app
  const app = express();

  // Health check endpoint (no auth required)
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      // Use type assertion since SDK types may vary
      const client = opencodeInstance?.client as any;
      const health = await client?.global?.health?.();
      res.json({
        status: 'healthy',
        opencode: health?.data,
        service: {
          port: PORT,
          internalPort: INTERNAL_PORT,
          localMode: isLocalMode(),
        },
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Auth middleware
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check
    if (req.path === '/health') {
      return next();
    }

    const authResult = await authenticateRequest(req.headers as Record<string, string | string[] | undefined>);

    if (!authResult.authenticated) {
      console.log(`[opencode-service] Auth failed: ${authResult.error}`);
      return res.status(401).json({
        error: 'Unauthorized',
        message: authResult.error,
      });
    }

    // Attach auth info to request for potential downstream use
    (req as any).auth = {
      userId: authResult.userId,
      keyId: authResult.keyId,
    };

    next();
  });

  // Log requests
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const auth = (req as any).auth;
    console.log(`[opencode-service] ${req.method} ${req.path} [user: ${auth?.userId || 'unknown'}]`);
    next();
  });

  // Proxy all other requests to OpenCode
  // NOTE: `ws` is intentionally disabled. WebSocket upgrade requests bypass the
  // Express middleware chain (including the auth middleware above), which would
  // expose an unauthenticated path into the bash-enabled OpenCode server.
  // SSE is plain HTTP and does not need upgrade handling.
  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${INTERNAL_PORT}`,
    changeOrigin: true,
    on: {
      proxyReq: fixRequestBody,
      error: (err, _req, res) => {
        console.error('[opencode-service] Proxy error:', err);
        if (res && 'writeHead' in res) {
          (res as Response).status(502).json({
            error: 'Proxy error',
            message: err.message,
          });
        }
      },
    },
  });

  app.use('/', proxy);

  // Start the service
  const server = app.listen(PORT, HOST, () => {
    console.log(`[opencode-service] Service listening on http://${HOST}:${PORT}`);
    console.log('[opencode-service] Ready to accept requests');
  });

  // Explicitly reject WebSocket upgrade attempts - they cannot be authenticated
  // by the Express middleware chain
  server.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[opencode-service] Received ${signal}, shutting down...`);
    
    server.close(() => {
      console.log('[opencode-service] HTTP server closed');
    });

    if (opencodeInstance) {
      try {
        opencodeInstance.server.close();
        console.log('[opencode-service] Internal OpenCode server closed');
      } catch (error) {
        console.error('[opencode-service] Error closing OpenCode server:', error);
      }
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Run
main().catch((error) => {
  console.error('[opencode-service] Fatal error:', error);
  process.exit(1);
});
