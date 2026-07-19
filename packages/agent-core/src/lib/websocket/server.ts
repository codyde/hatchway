/**
 * WebSocket Server for Real-Time Build Updates and Runner Communication
 * 
 * Provides real-time state synchronization without SSE's connection fragility.
 * 
 * Frontend Clients (/ws):
 * - Subscribe to project/session updates
 * - Receive batched state changes
 * - Auto-reconnect on disconnect
 * - Resume from last known state
 * 
 * Runner Connections (/ws/runner):
 * - Persistent WebSocket connections from runner processes
 * - Receive commands (start-build, start-dev-server, etc.)
 * - Send events (build-stream, log-chunk, etc.)
 * - Heartbeat/ping-pong keepalive
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { GenerationState } from '../../types/generation';
import type { RunnerCommand, RunnerEvent, RunnerMessage } from '../../shared/runner/messages';
import { isRunnerEvent } from '../../shared/runner/messages';
import { publishRunnerEvent } from '../runner/event-stream';
// NOTE: processGlobalRunnerEvent removed - DB writes now happen via HTTP from runner
import { buildLogger } from '../logging/build-logger';
import { db } from '../db/client';
import { runnerKeys, generationSessions, generationTodos, generationToolCalls, runningProcesses, projects } from '../db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { httpProxyManager } from './http-proxy-manager';
import { hmrProxyManager } from './hmr-proxy-manager';
import { commandQueue } from '../runner/command-queue';
import { timingSafeEqualString } from '../timing-safe-equal';

interface ClientSubscription {
  ws: WebSocket;
  projectId: string;
  sessionId?: string;
  userId?: string; // Authenticated user (undefined only in local mode)
  lastHeartbeat: number;
  hmrConnections?: Set<string>; // Track HMR connections owned by this client
}

/**
 * Authenticates a frontend client's upgrade request (e.g. via session cookies).
 * Returns the authenticated user, or null to reject the connection.
 */
export type ClientAuthenticator = (req: IncomingMessage) => Promise<{ userId: string } | null>;

/**
 * Authorizes a user's access to a project (ownership check).
 */
export type ProjectAccessAuthorizer = (userId: string, projectId: string) => Promise<boolean>;

const isLocalMode = () => process.env.HATCHWAY_LOCAL_MODE === 'true';

// Carries the authenticated user from the upgrade handler to handleConnection
// without mutating the Node request object. GC-safe (keyed by request).
const upgradeAuthContext = new WeakMap<IncomingMessage, { userId?: string }>();

interface RunnerConnection {
  id: string;
  socket: WebSocket;
  lastHeartbeat: number;
  pingInterval: NodeJS.Timeout;
  userId?: string; // User who owns the runner key (undefined for shared secret auth)
}

interface StateUpdateMessage {
  type: 'state-update';
  projectId: string;
  sessionId: string;
  state: Partial<GenerationState>;
  timestamp: number;
}

interface BatchedUpdate {
  projectId: string;
  sessionId: string;
  updates: Array<{
    type: string;
    data: unknown;
    timestamp: number;
  }>;
}

// Get shared secret from environment - read dynamically to support late binding
const getSharedSecret = () => process.env.RUNNER_SHARED_SECRET;

// Hash a runner key for lookup
function hashRunnerKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// Validate a runner key against the database and return the associated userId
async function validateRunnerKey(key: string): Promise<{ valid: boolean; userId?: string }> {
  if (!key || !key.startsWith('sv_')) {
    return { valid: false };
  }

  const keyHash = hashRunnerKey(key);

  try {
    const results = await db
      .select({ id: runnerKeys.id, userId: runnerKeys.userId })
      .from(runnerKeys)
      .where(
        and(
          eq(runnerKeys.keyHash, keyHash),
          isNull(runnerKeys.revokedAt)
        )
      )
      .limit(1);

    if (results.length > 0) {
      // Update last used timestamp (fire and forget - ok for WS since it's long-lived)
      db.update(runnerKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(runnerKeys.id, results[0].id))
        .execute()
        .catch(() => {});
      return { valid: true, userId: results[0].userId };
    }
  } catch (error) {
    console.error('[websocket] Error validating runner key:', error);
  }

  return { valid: false };
}

class BuildWebSocketServer {
  private wss: WebSocketServer | null = null;
  private runnerWss: WebSocketServer | null = null;
  private clients: Map<string, ClientSubscription> = new Map();
  private runnerConnections: Map<string, RunnerConnection> = new Map();
  private pendingUpdates: Map<string, BatchedUpdate> = new Map();
  /** Recent activity-status updates retained briefly when no client is subscribed. */
  private activityStatusBuffer: Map<string, BatchedUpdate['updates']> = new Map();
  private batchInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private runnerCleanupInterval: NodeJS.Timeout | null = null;
  
  private readonly BATCH_DELAY = 200; // ms - batch updates for efficiency
  private readonly HEARTBEAT_INTERVAL = 30000; // 30s
  private readonly CLIENT_TIMEOUT = 60000; // 60s
  private readonly RUNNER_PING_INTERVAL = 30000; // 30s
  private readonly RUNNER_HEARTBEAT_TIMEOUT = 90000; // 90s
  private readonly ACTIVITY_BUFFER_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly ACTIVITY_BUFFER_MAX = 50;

  // Metrics tracking for runner connections
  private runnerTotalEvents = 0;
  private runnerTotalCommands = 0;
  private runnerTotalErrors = 0;

  // Instance ID for debugging singleton issues
  private readonly instanceId = Math.random().toString(36).substring(7);
  private initialized = false;

  // Callback for runner status changes (set by app layer)
  private onRunnerStatusChangeCallback: ((runnerId: string, connected: boolean, affectedProjectIds: string[]) => void) | null = null;

  // Client auth hooks (set by app layer). Without these, client connections are
  // only accepted in local mode - default deny in hosted deployments.
  private authenticateClient: ClientAuthenticator | null = null;
  private authorizeProjectAccess: ProjectAccessAuthorizer | null = null;

  /**
   * Install authentication hooks for frontend client connections.
   * Must be called by the app layer before clients connect in hosted mode.
   */
  setClientAuth(authenticate: ClientAuthenticator, authorize: ProjectAccessAuthorizer) {
    this.authenticateClient = authenticate;
    this.authorizeProjectAccess = authorize;
  }

  constructor() {
    buildLogger.websocket.serverCreated(this.instanceId);
  }

  /**
   * Initialize WebSocket server for both frontend clients and runners
   */
  initialize(server: Server, path: string = '/ws') {
    // Prevent multiple initializations (e.g., during HMR in dev mode)
    if (this.initialized) {
      buildLogger.log('debug', 'websocket', `Server already initialized (instance: ${this.instanceId}), skipping...`, { instanceId: this.instanceId });
      return;
    }
    
    buildLogger.log('debug', 'websocket', `Initializing server (instance: ${this.instanceId})...`, { instanceId: this.instanceId });
    this.initialized = true;
    
    // Frontend client WebSocket server - noServer mode for manual upgrade handling
    this.wss = new WebSocketServer({ 
      noServer: true,
      perMessageDeflate: false, // Disable compression for lower latency
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.handleConnection(ws, req).catch(error => {
        buildLogger.websocket.error('Failed to handle client connection', error);
        try {
          ws.close(1011, 'Internal error');
        } catch {
          // Socket may already be closed
        }
      });
    });

    // Runner WebSocket server on /ws/runner - noServer mode for manual upgrade handling
    this.runnerWss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
    });

    this.runnerWss.on('connection', (ws: WebSocket, req) => {
      this.handleRunnerConnection(ws, req);
    });

    // Manually handle HTTP upgrade events to route to correct WebSocket server
    server.on('upgrade', (request, socket, head) => {
      const pathname = request.url?.split('?')[0] || '';
      
      if (pathname === '/ws/runner') {
        // Runner connection - handle with runnerWss
        this.runnerWss!.handleUpgrade(request, socket, head, (ws) => {
          this.runnerWss!.emit('connection', ws, request);
        });
      } else if (pathname === path || pathname === '/ws') {
        // Frontend client connection - authenticate BEFORE completing the handshake.
        // Upgrade requests bypass Next.js middleware, so this is the only auth gate.
        this.resolveClientAuth(request)
          .then(auth => {
            if (!auth.allowed) {
              buildLogger.log('warn', 'websocket', 'Rejected unauthenticated client upgrade');
              socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
              socket.destroy();
              return;
            }
            upgradeAuthContext.set(request, { userId: auth.userId });
            this.wss!.handleUpgrade(request, socket, head, (ws) => {
              this.wss!.emit('connection', ws, request);
            });
          })
          .catch(error => {
            buildLogger.websocket.error('Client upgrade auth failed', error);
            socket.destroy();
          });
      } else {
        // Unknown path - destroy the socket
        // Only log non-root paths as warnings (root path is often probed by browsers/tools)
        if (pathname && pathname !== '/') {
          buildLogger.websocket.unknownUpgradePath(pathname);
        }
        socket.destroy();
      }
    });

    // Start batch processing interval
    this.batchInterval = setInterval(() => {
      this.processBatchedUpdates();
    }, this.BATCH_DELAY);

    // Start heartbeat interval for frontend clients
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeats();
    }, this.HEARTBEAT_INTERVAL);

    // Start stale runner connection cleanup interval
    this.runnerCleanupInterval = setInterval(() => {
      this.cleanupStaleRunnerConnections();
    }, 60000); // Check every 60s

    // Initialize command queue with our send function
    commandQueue.setSendFunction((runnerId, command) => {
      return this.sendCommandToRunner(runnerId, command);
    });

    buildLogger.websocket.serverInitialized(path, '/ws/runner');
  }

  // ============================================================
  // FRONTEND CLIENT HANDLING
  // ============================================================

  /**
   * Authenticate a client upgrade request.
   * Local mode: always allowed. Hosted mode: requires the app layer to have
   * installed an authenticator via setClientAuth() - otherwise deny.
   */
  private async resolveClientAuth(req: IncomingMessage): Promise<{ allowed: boolean; userId?: string }> {
    if (isLocalMode()) {
      return { allowed: true };
    }

    if (!this.authenticateClient) {
      buildLogger.log('warn', 'websocket', 'No client authenticator configured - denying client connection');
      return { allowed: false };
    }

    const auth = await this.authenticateClient(req);
    if (!auth) {
      return { allowed: false };
    }

    return { allowed: true, userId: auth.userId };
  }

  /**
   * Check whether a user may access a project. Local mode always allows.
   */
  private async canAccessProject(userId: string | undefined, projectId: string): Promise<boolean> {
    if (isLocalMode()) return true;
    if (!this.authorizeProjectAccess || !userId) return false;
    try {
      return await this.authorizeProjectAccess(userId, projectId);
    } catch (error) {
      buildLogger.websocket.error('Project access check failed', error, { projectId });
      return false;
    }
  }

  /**
   * Handle new frontend WebSocket connection
   */
  private async handleConnection(ws: WebSocket, req: any) {
    const clientId = this.generateClientId();
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId') || '';
    const sessionId = url.searchParams.get('sessionId') || undefined;
    const userId = upgradeAuthContext.get(req as IncomingMessage)?.userId;

    // Verify the authenticated user owns the project they're subscribing to
    if (projectId && !(await this.canAccessProject(userId, projectId))) {
      buildLogger.log('warn', 'websocket', `Client denied access to project ${projectId}`);
      ws.close(4403, 'Forbidden');
      return;
    }

    buildLogger.websocket.clientConnected(clientId, projectId, sessionId);

    // Store client subscription
    this.clients.set(clientId, {
      ws,
      projectId,
      sessionId,
      userId,
      lastHeartbeat: Date.now(),
    });

    // Send connection confirmation
    this.sendMessage(ws, {
      type: 'connected',
      clientId,
      projectId,
      sessionId,
      timestamp: Date.now(),
    });

    // Handle messages from client
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(clientId, message).catch(error => {
          buildLogger.websocket.error('Failed to handle client message', error, { clientId });
        });
      } catch (error) {
        buildLogger.websocket.error('Failed to parse client message', error, { clientId });
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      buildLogger.websocket.clientDisconnected(clientId);
      
      // Clean up any HMR connections owned by this client
      const client = this.clients.get(clientId);
      if (client?.hmrConnections) {
        for (const connectionId of client.hmrConnections) {
          hmrProxyManager.disconnect(connectionId);
        }
      }
      
      this.clients.delete(clientId);
    });

    // Handle errors
    ws.on('error', (error) => {
      buildLogger.websocket.error('Client error', error, { clientId });
      this.clients.delete(clientId);
    });
  }

  // ============================================================
  // RUNNER CONNECTION HANDLING
  // ============================================================

  /**
   * Handle new runner WebSocket connection
   */
  private async handleRunnerConnection(ws: WebSocket, req: any) {
    // Authenticate runner via Bearer token
    // Supports both shared secret and runner keys (sv_xxx)
    const sharedSecret = getSharedSecret();
    const authHeader = req.headers['authorization'] as string | undefined;
    
    // Extract token from Authorization header
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : authHeader;

    // Validate authentication and get userId (for runner key auth)
    let isAuthenticated = false;
    let runnerUserId: string | undefined;
    
    if (token) {
      if (token.startsWith('sv_')) {
        // Runner key authentication - returns userId for multi-tenancy
        const result = await validateRunnerKey(token);
        isAuthenticated = result.valid;
        runnerUserId = result.userId;
      } else if (sharedSecret && timingSafeEqualString(token, sharedSecret)) {
        // Shared secret authentication (legacy) - no userId available
        isAuthenticated = true;
      }
    }

    if (!isAuthenticated) {
      // Check if server is misconfigured (no shared secret and no DB for runner keys)
      if (!sharedSecret) {
        buildLogger.websocket.runnerAuthMissing();
        ws.close(1008, 'Server misconfigured');
        return;
      }
      buildLogger.websocket.runnerAuthRejected();
      ws.close(1008, 'Unauthorized');
      return;
    }

    // Extract runner ID from query params
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const runnerId = url.searchParams.get('runnerId') ?? 'default';

    // Guard against runner ID collisions/hijacking:
    // - A runner ID already claimed by a different user's key cannot be taken over.
    // - A reconnect by the same owner cleanly replaces the old connection.
    const existing = this.runnerConnections.get(runnerId);
    if (existing) {
      if (existing.userId !== runnerUserId) {
        buildLogger.log('warn', 'websocket', `Rejected runner connection: runnerId '${runnerId}' already claimed by another user`);
        ws.close(1008, 'Runner ID already in use');
        return;
      }
      clearInterval(existing.pingInterval);
      try {
        existing.socket.close(1000, 'Replaced by new connection');
      } catch {
        // Old socket may already be dead
      }
    }

    buildLogger.websocket.runnerConnected(runnerId);

    // Setup ping/pong keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, this.RUNNER_PING_INTERVAL);

    // Store runner connection with userId for multi-tenancy filtering
    this.runnerConnections.set(runnerId, {
      id: runnerId,
      socket: ws,
      lastHeartbeat: Date.now(),
      pingInterval,
      userId: runnerUserId,
    });

    // Process any queued commands for this runner
    const queueResult = commandQueue.processQueue(runnerId);
    if (queueResult.sent > 0 || queueResult.failed > 0) {
      buildLogger.log('info', 'websocket', `Runner ${runnerId} reconnected - processed queued commands`, {
        sent: queueResult.sent,
        failed: queueResult.failed,
        remaining: queueResult.remaining,
      });
    }

    // Notify app layer about runner connection so it can update project status in UI
    // Find projects associated with this runner and notify
    this.notifyRunnerConnected(runnerId);

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      const conn = this.runnerConnections.get(runnerId);
      if (conn) {
        conn.lastHeartbeat = Date.now();
      }
    });

    // Handle messages from runner
    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as RunnerMessage;
        if (isRunnerEvent(message)) {
          const event = message as RunnerEvent;

          // Update heartbeat on runner-status events
          if (event.type === 'runner-status') {
            const conn = this.runnerConnections.get(runnerId);
            if (conn) conn.lastHeartbeat = Date.now();
          }

          this.runnerTotalEvents++;
          await this.processRunnerEvent(event);
        }
      } catch (error) {
        this.runnerTotalErrors++;
        buildLogger.websocket.error('Failed to handle runner message', error, { runnerId });
      }
    });

    // Handle runner disconnect
    ws.on('close', (code) => {
      const conn = this.runnerConnections.get(runnerId);
      // A newer connection may have replaced this one - don't tear down its entry
      if (conn && conn.socket !== ws) {
        return;
      }
      buildLogger.websocket.runnerDisconnected(runnerId, code);
      if (conn) {
        clearInterval(conn.pingInterval);
      }
      this.runnerConnections.delete(runnerId);
      
      // Cancel any pending HTTP proxy requests for this runner
      httpProxyManager.cancelRequestsForRunner(runnerId);
      
      // Disconnect any HMR connections for this runner
      hmrProxyManager.disconnectRunner(runnerId);
      
      // Clean up running processes for this runner and update project statuses
      this.cleanupRunnerProcesses(runnerId);
    });

    // Handle runner errors
    ws.on('error', (error) => {
      buildLogger.websocket.error('Runner socket error', error, { runnerId });
      this.runnerTotalErrors++;

      const conn = this.runnerConnections.get(runnerId);
      if (conn) {
        clearInterval(conn.pingInterval);
      }
      this.runnerConnections.delete(runnerId);
    });
  }

  /**
   * Process runner event - publish to event stream for WebSocket broadcasts
   * NOTE: Database writes now happen via HTTP from the runner (/api/runner-events, /api/build-events)
   */
  private async processRunnerEvent(event: RunnerEvent) {
    // Check if this is an HTTP proxy event - handle specially
    if (httpProxyManager.processEvent(event)) {
      // HTTP proxy events are handled internally, don't broadcast
      return;
    }
    
    // Check if this is an HMR proxy event - handle specially
    if (hmrProxyManager.processEvent(event)) {
      // HMR proxy events are handled by the manager which calls our callbacks
      return;
    }
    
    // Publish event to internal event stream
    // This triggers persistent-event-processor for WebSocket broadcasts
    // DB writes are handled by HTTP endpoints called directly from runner
    publishRunnerEvent(event);
  }

  /**
   * Queue a command for reliable delivery to a runner
   * Automatically retries if runner is disconnected, with configurable TTL
   */
  queueCommandToRunner(
    runnerId: string,
    command: RunnerCommand,
    options?: {
      ttlMs?: number;
      maxAttempts?: number;
      onSuccess?: () => void;
      onFailure?: (error: string) => void;
    }
  ): { sent: boolean; queued: boolean } {
    return commandQueue.enqueue(runnerId, command, options);
  }

  /**
   * Send a command to a specific runner (immediate, no queueing)
   */
  sendCommandToRunner(runnerId: string, command: RunnerCommand): boolean {
    const connection = this.runnerConnections.get(runnerId);

    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      buildLogger.websocket.runnerNotConnected(runnerId, command.type);
      return false;
    }

    try {
      buildLogger.websocket.commandSent(runnerId, command.type, false);

      connection.socket.send(JSON.stringify(command));
      this.runnerTotalCommands++;
      return true;
    } catch (error) {
      this.runnerTotalErrors++;
      buildLogger.websocket.error('Failed to send command to runner', error, { runnerId, commandType: command.type });
      return false;
    }
  }

  /**
   * List all connected runners with their status
   * @param userId - Optional user ID to filter runners (only show runners owned by this user)
   */
  listRunnerConnections(userId?: string): Array<{ runnerId: string; lastHeartbeat: number; lastHeartbeatAge: number; userId?: string }> {
    const now = Date.now();
    let connections = Array.from(this.runnerConnections.values());
    
    // Filter by userId if provided (for multi-tenancy)
    if (userId) {
      connections = connections.filter(conn => conn.userId === userId);
    }
    
    return connections.map(({ id, lastHeartbeat, userId: connUserId }) => ({
      runnerId: id,
      lastHeartbeat,
      lastHeartbeatAge: now - lastHeartbeat,
      userId: connUserId,
    }));
  }

  /**
   * Check if a specific runner is connected
   */
  isRunnerConnected(runnerId: string): boolean {
    const conn = this.runnerConnections.get(runnerId);
    const isConnected = conn !== undefined && conn.socket.readyState === WebSocket.OPEN;
    
    // Debug logging to diagnose runner connection issues
    console.log(`[isRunnerConnected] Checking runner '${runnerId}':`, {
      hasConnection: conn !== undefined,
      socketState: conn?.socket.readyState,
      isOpen: conn?.socket.readyState === WebSocket.OPEN,
      result: isConnected,
      allRunners: Array.from(this.runnerConnections.keys()),
    });
    
    return isConnected;
  }

  /**
   * Register a callback to be notified when runner status changes
   * This allows the app layer to emit project events when runners connect/disconnect
   */
  onRunnerStatusChange(callback: (runnerId: string, connected: boolean, affectedProjectIds: string[]) => void) {
    this.onRunnerStatusChangeCallback = callback;
  }

  /**
   * Get runner metrics
   */
  getRunnerMetrics() {
    return {
      totalEvents: this.runnerTotalEvents,
      totalCommands: this.runnerTotalCommands,
      totalErrors: this.runnerTotalErrors,
      activeConnections: this.runnerConnections.size,
    };
  }

  /**
   * Cleanup stale runner connections
   */
  private cleanupStaleRunnerConnections() {
    const now = Date.now();
    for (const [runnerId, conn] of this.runnerConnections.entries()) {
      if (now - conn.lastHeartbeat > this.RUNNER_HEARTBEAT_TIMEOUT) {
        buildLogger.websocket.runnerStaleRemoved(runnerId);

        clearInterval(conn.pingInterval);
        conn.socket.close(1000, 'Heartbeat timeout');
        this.runnerConnections.delete(runnerId);
        
        // Clean up processes for this stale runner
        this.cleanupRunnerProcesses(runnerId);
      }
    }
  }

  /**
   * Clean up running processes and update project statuses when a runner disconnects.
   * This ensures the UI shows accurate state when the runner is gone.
   */
  private async cleanupRunnerProcesses(runnerId: string) {
    try {
      buildLogger.log('info', 'websocket', `Cleaning up processes for disconnected runner: ${runnerId}`, { runnerId });

      // Find all running processes for this runner
      const processes = await db
        .select({ projectId: runningProcesses.projectId })
        .from(runningProcesses)
        .where(eq(runningProcesses.runnerId, runnerId));

      if (processes.length === 0) {
        buildLogger.log('debug', 'websocket', `No running processes found for runner: ${runnerId}`, { runnerId });
        return;
      }

      const projectIds = processes.map(p => p.projectId);
      buildLogger.log('info', 'websocket', `Found ${projectIds.length} processes to clean up for runner: ${runnerId}`, { 
        runnerId, 
        projectIds 
      });

      // Delete all running processes for this runner
      await db
        .delete(runningProcesses)
        .where(eq(runningProcesses.runnerId, runnerId));

      // Update project statuses to 'disconnected' so UI shows accurate state
      // We use 'stopped' status but the frontend will check runnerConnected to show disconnected state
      const now = new Date();
      for (const projectId of projectIds) {
        await db
          .update(projects)
          .set({
            devServerStatus: 'stopped',
            devServerStatusUpdatedAt: now,
            devServerPid: null,
          })
          .where(eq(projects.id, projectId));
      }

      buildLogger.log('info', 'websocket', `Cleaned up ${projectIds.length} processes for disconnected runner: ${runnerId}`, { 
        runnerId,
        projectIds
      });

      // Notify app layer about runner disconnection so it can emit project events
      if (this.onRunnerStatusChangeCallback) {
        try {
          this.onRunnerStatusChangeCallback(runnerId, false, projectIds);
        } catch (callbackError) {
          buildLogger.websocket.error('Runner status change callback failed', callbackError, { runnerId });
        }
      }
    } catch (error) {
      buildLogger.websocket.error('Failed to cleanup runner processes', error, { runnerId });
    }
  }

  /**
   * Notify app layer when a runner connects so projects can update their UI
   */
  private async notifyRunnerConnected(runnerId: string) {
    if (!this.onRunnerStatusChangeCallback) return;

    try {
      // Find all projects that have this runner assigned
      const projectsWithRunner = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.runnerId, runnerId));

      if (projectsWithRunner.length > 0) {
        const projectIds = projectsWithRunner.map(p => p.id);
        buildLogger.log('info', 'websocket', `Runner ${runnerId} connected - notifying ${projectIds.length} projects`, { 
          runnerId, 
          projectIds 
        });
        this.onRunnerStatusChangeCallback(runnerId, true, projectIds);
      }
    } catch (error) {
      buildLogger.websocket.error('Failed to notify runner connected', error, { runnerId });
    }
  }

  /**
   * Handle messages from client (heartbeat, resubscribe, HMR, etc.)
   */
  private async handleClientMessage(clientId: string, message: any) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'heartbeat':
        client.lastHeartbeat = Date.now();
        this.sendMessage(client.ws, { type: 'heartbeat-ack', timestamp: Date.now() });
        break;

      case 'subscribe': {
        // Re-verify ownership before switching subscription to another project.
        // Skip the DB check when re-subscribing to the project already verified
        // at connection time (the common connect-then-subscribe path).
        const targetProjectId = typeof message.projectId === 'string' ? message.projectId : '';
        const alreadyVerified = targetProjectId === client.projectId;
        if (targetProjectId && !alreadyVerified && !(await this.canAccessProject(client.userId, targetProjectId))) {
          buildLogger.log('warn', 'websocket', `Client ${clientId} denied subscribe to project ${targetProjectId}`);
          this.sendMessage(client.ws, { type: 'error', error: 'Forbidden', projectId: targetProjectId });
          break;
        }
        client.projectId = targetProjectId;
        client.sessionId = message.sessionId;
        buildLogger.websocket.clientSubscribed(clientId, targetProjectId);
        break;
      }
      
      case 'get-state':
        // Client requesting current state (on reconnect)
        this.sendCurrentState(client);
        break;
      
      // HMR Proxy Messages from frontend iframe
      case 'hmr-connect':
        this.handleHmrConnect(clientId, client, message);
        break;
      
      case 'hmr-send':
        this.handleHmrSend(message);
        break;
      
      case 'hmr-disconnect':
        this.handleHmrDisconnect(clientId, client, message);
        break;
    }
  }

  /**
   * Handle HMR connect request from frontend
   */
  private async handleHmrConnect(clientId: string, client: ClientSubscription, message: any) {
    const { connectionId, protocol } = message;

    // Derive runner and port from the project record - never trust
    // client-supplied values, which would allow tunneling to arbitrary
    // runners/ports.
    if (!client.projectId) {
      this.sendMessage(client.ws, {
        type: 'hmr-error',
        connectionId,
        error: 'Not subscribed to a project',
      });
      return;
    }

    const target = await this.getHmrTargetForProject(client.projectId);
    if (!target) {
      this.sendMessage(client.ws, {
        type: 'hmr-error',
        connectionId,
        error: 'No runner available for project',
      });
      return;
    }
    const { runnerId: targetRunnerId, port } = target;

    // Track this connection on the client
    if (!client.hmrConnections) {
      client.hmrConnections = new Set();
    }
    client.hmrConnections.add(connectionId);

    // Initiate HMR connection through proxy manager
    // IMPORTANT: Pass the connectionId from frontend to maintain correlation
    hmrProxyManager.connect(
      connectionId,
      targetRunnerId,
      client.projectId,
      port,
      protocol,
      {
        onConnected: () => {
          this.sendMessage(client.ws, {
            type: 'hmr-connected',
            connectionId,
          });
        },
        onMessage: (msg: string) => {
          this.sendMessage(client.ws, {
            type: 'hmr-message',
            connectionId,
            message: msg,
          });
        },
        onDisconnected: (code?: number, reason?: string) => {
          client.hmrConnections?.delete(connectionId);
          this.sendMessage(client.ws, {
            type: 'hmr-closed',
            connectionId,
            code,
            reason,
          });
        },
        onError: (error: string) => {
          client.hmrConnections?.delete(connectionId);
          this.sendMessage(client.ws, {
            type: 'hmr-error',
            connectionId,
            error,
          });
        },
      }
    );
  }

  /**
   * Handle HMR send request from frontend
   */
  private handleHmrSend(message: any) {
    const { connectionId, message: hmrMessage } = message;
    hmrProxyManager.send(connectionId, hmrMessage);
  }

  /**
   * Handle HMR disconnect request from frontend
   */
  private handleHmrDisconnect(clientId: string, client: ClientSubscription, message: any) {
    const { connectionId } = message;
    client.hmrConnections?.delete(connectionId);
    hmrProxyManager.disconnect(connectionId);
  }

  /**
   * Resolve the HMR tunnel target (runner + dev server port) for a project.
   * The project's assigned runner must be connected and its dev server port
   * recorded - no fallback to "any runner".
   */
  private async getHmrTargetForProject(projectId: string): Promise<{ runnerId: string; port: number } | null> {
    try {
      const rows = await db
        .select({ runnerId: projects.runnerId, devServerPort: projects.devServerPort })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (rows.length === 0) return null;
      const { runnerId, devServerPort } = rows[0];
      if (!runnerId || !devServerPort) return null;
      if (!this.runnerConnections.has(runnerId)) return null;

      return { runnerId, port: devServerPort };
    } catch (error) {
      buildLogger.websocket.error('Failed to resolve HMR target', error, { projectId });
      return null;
    }
  }

  /**
   * @deprecated Use discrete event broadcasts instead (broadcastBuildStarted, broadcastTodosUpdate,
   * broadcastToolCall, broadcastBuildComplete). This method broadcasts full state snapshots which
   * is inefficient for real-time updates. Kept for state recovery scenarios.
   */
  broadcastStateUpdate(
    projectId: string,
    sessionId: string,
    state: Partial<GenerationState>
  ) {
    const key = `${projectId}-${sessionId}`;
    
    // Add to pending updates for batching
    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId,
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'state-update',
      data: state,
      timestamp: Date.now(),
    });

    // If batch is getting large, flush immediately
    if (batch.updates.length >= 10) {
      this.flushBatch(key);
    }
  }

  /**
   * Broadcast tool call event
   */
  broadcastToolCall(
    projectId: string,
    sessionId: string,
    toolCall: {
      id: string;
      name: string;
      todoIndex: number; // Can be -1 for planning phase tools (before first TodoWrite)
      input?: unknown;
      output?: unknown; // Tool output for completion events
      state: 'input-available' | 'output-available' | 'error'; // input-available for planning shimmer
    }
  ) {
    const key = `${projectId}-${sessionId}`;

    // Debug: Log planning tool broadcasts
    if (toolCall.todoIndex < 0) {
      const subscriberCount = Array.from(this.clients.values()).filter(
        client => client.projectId === projectId
      ).length;
      buildLogger.websocket.broadcastToolCall(toolCall.name, toolCall.state, subscriberCount);
    }

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId,
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'tool-call',
      data: toolCall,
      timestamp: Date.now(),
    });

    // Tool updates are critical for UI - flush immediately
    this.flushBatch(key);
  }

  /**
   * Broadcast build started event
   * This signals a new build has begun - flush immediately
   */
  broadcastBuildStarted(
    projectId: string,
    sessionId: string,
    buildId: string
  ) {
    const key = `${projectId}-${sessionId}`;

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId,
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'build-started',
      data: { buildId, sessionId, projectId },
      timestamp: Date.now(),
    });

    // Build start is important - flush immediately
    this.flushBatch(key);
  }

  /**
   * Broadcast todos update (when TodoWrite tool is called)
   * This establishes or updates the todo list - flush immediately
   * @param phase - Optional phase ('template' | 'build') to distinguish template setup from build tasks
   */
  broadcastTodosUpdate(
    projectId: string,
    sessionId: string,
    todos: Array<{ content: string; status: string; activeForm?: string }>,
    activeTodoIndex: number,
    phase?: 'template' | 'build'
  ) {
    const key = `${projectId}-${sessionId}`;

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId,
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'todos-update',
      data: { todos, activeTodoIndex, phase },
      timestamp: Date.now(),
    });

    // Todos are critical for UI - flush immediately
    this.flushBatch(key);
  }

  /**
   * Broadcast that a specific todo has completed (batch write finished)
   * This signals that all events for this todo have been persisted to DB
   */
  broadcastTodoCompleted(
    projectId: string,
    sessionId: string,
    todoIndex: number
  ) {
    const key = `${projectId}-${sessionId}`;

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId,
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'todo-completed',
      data: { todoIndex, persisted: true },
      timestamp: Date.now(),
    });

    // Todo completion is important for reconnection state - flush immediately
    this.flushBatch(key);
  }

  /**
   * Broadcast build completed/failed event
   * This is a terminal state event - flush immediately
   */
  broadcastBuildComplete(
    projectId: string,
    sessionId: string,
    status: 'completed' | 'failed',
    summary?: string
  ) {
    const key = `${projectId}-${sessionId}`;

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId,
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'build-complete',
      data: { status, summary },
      timestamp: Date.now(),
    });

    buildLogger.websocket.broadcastBuildComplete(projectId, sessionId, Array.from(this.clients.values()).filter(
      client => client.projectId === projectId
    ).length);

    // Terminal event - flush immediately
    this.flushBatch(key);
  }

  broadcastBuildSummary(
    projectId: string,
    sessionId: string,
    summary: string
  ) {
    const key = `${projectId}-${sessionId}`;

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId,
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'build-summary',
      data: { summary },
      timestamp: Date.now(),
    });

    this.flushBatch(key);
  }

  /**
   * Broadcast a non-todo activity status line (sandbox provision, preview failure, etc.)
   * When sessionId is empty, deliver to all clients subscribed to the project.
   */
  broadcastActivityStatus(
    projectId: string,
    sessionId: string,
    payload: { message: string; phase?: string; level?: 'info' | 'success' | 'warning' | 'error' }
  ) {
    const key = sessionId ? `${projectId}-${sessionId}` : `${projectId}-activity`;

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, {
        projectId,
        sessionId: sessionId || '',
        updates: [],
      });
    }

    const batch = this.pendingUpdates.get(key)!;
    batch.updates.push({
      type: 'activity-status',
      data: payload,
      timestamp: Date.now(),
    });

    this.flushBatch(key);
  }

  /**
   * Process and send batched updates
   */
  private processBatchedUpdates() {
    for (const [key, batch] of this.pendingUpdates.entries()) {
      this.flushBatch(key);
    }
  }

  /**
   * Retain activity-status updates briefly so reconnecting clients still see
   * preview/status failures that landed while they were offline.
   */
  private bufferActivityUpdates(projectId: string, updates: BatchedUpdate['updates']) {
    const activityUpdates = updates.filter((u) => u.type === 'activity-status');
    if (activityUpdates.length === 0) return;

    const now = Date.now();
    const existing = (this.activityStatusBuffer.get(projectId) || []).filter(
      (u) => now - (u.timestamp || 0) < this.ACTIVITY_BUFFER_TTL_MS
    );
    const merged = [...existing, ...activityUpdates];
    this.activityStatusBuffer.set(
      projectId,
      merged.length > this.ACTIVITY_BUFFER_MAX
        ? merged.slice(merged.length - this.ACTIVITY_BUFFER_MAX)
        : merged
    );
  }

  private getBufferedActivityUpdates(projectId: string): BatchedUpdate['updates'] {
    const now = Date.now();
    const buffered = (this.activityStatusBuffer.get(projectId) || []).filter(
      (u) => now - (u.timestamp || 0) < this.ACTIVITY_BUFFER_TTL_MS
    );
    // Keep entries for other reconnecting clients until TTL expires.
    if (buffered.length === 0) {
      this.activityStatusBuffer.delete(projectId);
    } else {
      this.activityStatusBuffer.set(projectId, buffered);
    }
    return buffered;
  }

  private latestPreviewErrorFromActivity(
    updates: BatchedUpdate['updates']
  ): string | undefined {
    for (let i = updates.length - 1; i >= 0; i--) {
      const update = updates[i];
      if (update.type !== 'activity-status') continue;
      const data = update.data as { message?: string; level?: string } | undefined;
      if (data?.level === 'error' && typeof data.message === 'string' && /preview failed/i.test(data.message)) {
        return data.message;
      }
    }
    return undefined;
  }

  /**
   * Flush a specific batch to clients
   */
  private flushBatch(key: string) {
    const batch = this.pendingUpdates.get(key);
    if (!batch || batch.updates.length === 0) return;

    const { projectId, sessionId, updates } = batch;

    // Always buffer activity-status (incl. preview-failed) so reconnects can recover it.
    this.bufferActivityUpdates(projectId, updates);

    // Find all clients subscribed to this project/session.
    // Empty sessionId = project-wide broadcast (status / preview-failed).
    const subscribers = Array.from(this.clients.values()).filter(
      client => client.projectId === projectId &&
                (!sessionId || !client.sessionId || client.sessionId === sessionId)
    );

    if (subscribers.length === 0) {
      // No live subscribers; activity already buffered above.
      this.pendingUpdates.delete(key);
      return;
    }

    // Send batched update
    const message = {
      type: 'batch-update',
      projectId,
      sessionId,
      updates,
      timestamp: Date.now(),
    };

    subscribers.forEach(client => {
      this.sendMessage(client.ws, message);
    });

    // Clear batch
    this.pendingUpdates.delete(key);
  }

  /**
   * Send heartbeat to all connected clients
   */
  private sendHeartbeats() {
    const now = Date.now();
    
    for (const [clientId, client] of this.clients.entries()) {
      // Check if client timed out
      if (now - client.lastHeartbeat > this.CLIENT_TIMEOUT) {
        buildLogger.websocket.clientTimeout(clientId);
        client.ws.close();
        this.clients.delete(clientId);
        continue;
      }

      // Send heartbeat
      this.sendMessage(client.ws, { type: 'heartbeat', timestamp: now });
    }
  }

  /**
   * Enrich recovered generation state with buffered activity + project preview errors
   * so clients that missed live broadcasts still see the correct status.
   */
  private async enrichRecoveredState(
    projectId: string,
    state: Record<string, unknown> | null | undefined
  ): Promise<Record<string, unknown> | null> {
    if (!state) return null;

    const next: Record<string, unknown> = { ...state };
    const buffered = this.getBufferedActivityUpdates(projectId);

    if (buffered.length > 0) {
      const existingFeed = Array.isArray(next.activityFeed)
        ? ([...next.activityFeed] as Array<Record<string, unknown>>)
        : [];
      for (const update of buffered) {
        const data = (update.data || {}) as {
          message?: string;
          phase?: string;
          level?: string;
        };
        const id = `status-${data.phase || 'general'}-${update.timestamp || Date.now()}`;
        if (existingFeed.some((item) => item.id === id)) continue;
        existingFeed.push({
          id,
          kind: 'status',
          timestamp: new Date(update.timestamp || Date.now()),
          label: data.message || 'Status update',
          detail: data.phase,
          status: data.level || 'info',
        });
      }
      next.activityFeed = existingFeed;

      const bufferedPreviewError = this.latestPreviewErrorFromActivity(buffered);
      if (bufferedPreviewError && !next.previewError) {
        next.previewError = bufferedPreviewError;
      }
    }

    if (!next.previewError) {
      try {
        const [project] = await db
          .select({
            errorMessage: projects.errorMessage,
            devServerStatus: projects.devServerStatus,
            status: projects.status,
          })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        if (
          project?.errorMessage &&
          project.devServerStatus === 'failed' &&
          project.status !== 'failed' &&
          /preview failed|sandbox sync failed/i.test(project.errorMessage)
        ) {
          next.previewError = project.errorMessage;
          const feed = Array.isArray(next.activityFeed)
            ? ([...next.activityFeed] as Array<Record<string, unknown>>)
            : [];
          if (!feed.some((item) => item.id === 'status-preview-error-recovered')) {
            feed.push({
              id: 'status-preview-error-recovered',
              kind: 'status',
              timestamp: new Date(),
              label: project.errorMessage,
              status: 'error',
            });
            next.activityFeed = feed;
          }
        }
      } catch (error) {
        buildLogger.websocket.error('Failed to load project preview error for recovery', error, {
          projectId,
        });
      }
    }

    return next;
  }

  /**
   * Send current state to a client (on reconnect)
   * Fetches the active build session from database and sends full state
   */
  private async sendCurrentState(client: ClientSubscription) {
    if (!client.projectId) {
      this.sendMessage(client.ws, {
        type: 'state-recovery',
        state: null,
        timestamp: Date.now(),
      });
      return;
    }

    try {
      // Fetch active session for this project
      const sessions = await db
        .select()
        .from(generationSessions)
        .where(
          and(
            eq(generationSessions.projectId, client.projectId),
            eq(generationSessions.status, 'active')
          )
        )
        .orderBy(desc(generationSessions.updatedAt))
        .limit(1);

      if (sessions.length === 0) {
        // No active session - check for recently completed session
        const recentSessions = await db
          .select()
          .from(generationSessions)
          .where(eq(generationSessions.projectId, client.projectId))
          .orderBy(desc(generationSessions.updatedAt))
          .limit(1);

        if (recentSessions.length > 0 && recentSessions[0].rawState) {
          buildLogger.log('debug', 'websocket', `Sending completed session state for project ${client.projectId}`);
          const enriched = await this.enrichRecoveredState(
            client.projectId,
            recentSessions[0].rawState as Record<string, unknown>
          );
          this.sendMessage(client.ws, {
            type: 'state-recovery',
            state: enriched,
            sessionStatus: recentSessions[0].status,
            timestamp: Date.now(),
          });
          return;
        }

        // No session at all — still surface buffered preview/status if present
        const emptyEnriched = await this.enrichRecoveredState(client.projectId, {
          id: `recovery-${client.projectId}`,
          projectId: client.projectId,
          projectName: '',
          todos: [],
          toolsByTodo: {},
          textByTodo: {},
          activeTodoIndex: -1,
          isActive: false,
          startTime: new Date(),
          activityFeed: [],
        });
        this.sendMessage(client.ws, {
          type: 'state-recovery',
          state: emptyEnriched?.previewError || (emptyEnriched?.activityFeed as unknown[] | undefined)?.length
            ? emptyEnriched
            : null,
          timestamp: Date.now(),
        });
        return;
      }

      const session = sessions[0];

      // If rawState exists, send it directly (most efficient)
      if (session.rawState) {
        buildLogger.log('debug', 'websocket', `Sending active session state for project ${client.projectId}`);
        const enriched = await this.enrichRecoveredState(
          client.projectId,
          session.rawState as Record<string, unknown>
        );
        this.sendMessage(client.ws, {
          type: 'state-recovery',
          state: enriched,
          sessionId: session.id,
          sessionStatus: session.status,
          timestamp: Date.now(),
        });
        return;
      }

      // Fallback: Reconstruct state from related tables
      const [todos, toolCalls] = await Promise.all([
        db
          .select()
          .from(generationTodos)
          .where(eq(generationTodos.sessionId, session.id))
          .orderBy(generationTodos.todoIndex),
        db
          .select()
          .from(generationToolCalls)
          .where(eq(generationToolCalls.sessionId, session.id)),
      ]);

      // Group tool calls by todo index
      const toolsByTodo: Record<number, typeof toolCalls> = {};
      for (const tool of toolCalls) {
        if (!toolsByTodo[tool.todoIndex]) {
          toolsByTodo[tool.todoIndex] = [];
        }
        toolsByTodo[tool.todoIndex].push(tool);
      }

      // Find active todo index
      const activeTodoIndex = todos.findIndex(t => t.status === 'in_progress');

      const reconstructedState = {
        id: session.buildId,
        projectId: session.projectId,
        operationType: session.operationType || 'continuation',
        todos: todos.map(t => ({
          content: t.content,
          status: t.status as 'pending' | 'in_progress' | 'completed',
          activeForm: t.activeForm || t.content,
        })),
        toolsByTodo: Object.fromEntries(
          Object.entries(toolsByTodo).map(([idx, tools]) => [
            idx,
            tools.map(t => ({
              id: t.toolCallId,
              name: t.name,
              input: t.input,
              output: t.output,
              state: t.state,
              startTime: t.startedAt,
              endTime: t.endedAt,
            })),
          ])
        ),
        textByTodo: {},
        activeTodoIndex: activeTodoIndex,  // -1 if no todo is in_progress
        isActive: session.status === 'active',
        startTime: session.startedAt,
        endTime: session.endedAt,
        buildSummary: session.summary,
        isAutoFix: session.isAutoFix,
        autoFixError: session.autoFixError,
        activityFeed: [],
      };

      const enriched = await this.enrichRecoveredState(
        client.projectId,
        reconstructedState as unknown as Record<string, unknown>
      );

      buildLogger.log('debug', 'websocket', `Sending reconstructed state for project ${client.projectId}`);
      this.sendMessage(client.ws, {
        type: 'state-recovery',
        state: enriched,
        sessionId: session.id,
        sessionStatus: session.status,
        timestamp: Date.now(),
      });
    } catch (error) {
      buildLogger.websocket.error('Failed to fetch state for recovery', error, { projectId: client.projectId });
      this.sendMessage(client.ws, {
        type: 'state-recovery-failed',
        error: 'Failed to recover state from database',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send message to a specific WebSocket
   */
  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        buildLogger.websocket.error('Failed to send message', error);
      }
    }
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get connection stats
   */
  getStats() {
    return {
      totalClients: this.clients.size,
      totalRunners: this.runnerConnections.size,
      pendingBatches: this.pendingUpdates.size,
      clientsByProject: this.getClientsByProject(),
      runners: this.listRunnerConnections(),
      runnerMetrics: this.getRunnerMetrics(),
    };
  }

  /**
   * Get clients grouped by project
   */
  private getClientsByProject() {
    const byProject = new Map<string, number>();
    
    for (const client of this.clients.values()) {
      const count = byProject.get(client.projectId) || 0;
      byProject.set(client.projectId, count + 1);
    }

    return Object.fromEntries(byProject);
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown() {
    buildLogger.websocket.shutdown();
    
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.runnerCleanupInterval) {
      clearInterval(this.runnerCleanupInterval);
    }

    // Close all frontend client connections
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.pendingUpdates.clear();

    // Close all runner connections gracefully
    for (const conn of this.runnerConnections.values()) {
      clearInterval(conn.pingInterval);
      conn.socket.close(1000, 'Server shutting down');
    }
    this.runnerConnections.clear();

    if (this.wss) {
      this.wss.close();
    }

    if (this.runnerWss) {
      this.runnerWss.close();
    }

    // Shutdown command queue
    commandQueue.shutdown();

    buildLogger.websocket.shutdownComplete();
  }

  /**
   * Get command queue stats
   */
  getCommandQueueStats() {
    return commandQueue.getStats();
  }
}

// Use globalThis to ensure singleton survives Next.js bundling
// Without this, API routes get a different instance than server.ts
declare global {
  // eslint-disable-next-line no-var
  var __buildWebSocketServer: BuildWebSocketServer | undefined;
}

// Create singleton on globalThis to share across all bundles
if (!globalThis.__buildWebSocketServer) {
  globalThis.__buildWebSocketServer = new BuildWebSocketServer();
}

export const buildWebSocketServer = globalThis.__buildWebSocketServer;

