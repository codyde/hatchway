/**
 * Persistent Event Processor (Simplified)
 * 
 * This module now ONLY handles WebSocket broadcasts to frontend clients.
 * All database writes have been moved to HTTP endpoints (/api/build-events, /api/runner-events)
 * to ensure proper distributed trace context propagation.
 * 
 * The runner sends DB-worthy events via HTTP, which are then processed by the API routes.
 * This module subscribes to runner events via the event stream and broadcasts
 * updates to connected WebSocket clients.
 */

import type { RunnerEvent } from '../../shared/runner/messages';
import { addRunnerEventSubscriber } from './event-stream';
import { buildWebSocketServer } from '../../index';

interface ActiveBuildContext {
  commandId: string;
  sessionId: string;
  projectId: string;
  buildId: string;
  agentId: string;
  claudeModelId?: string;
  unsubscribe: () => void;
  startedAt: Date;
  lastActivityAt: Date; // Track last event received
  isFinalized: boolean;
  currentActiveTodoIndex: number;
}

// Global registry of active builds
declare global {
  // eslint-disable-next-line no-var
  var __activeBuilds: Map<string, ActiveBuildContext> | undefined;
}

const activeBuilds = global.__activeBuilds ?? new Map<string, ActiveBuildContext>();
global.__activeBuilds = activeBuilds;

/**
 * Parse SSE event data from build-stream format
 */
function parseSSEEventData(sseData: string): Record<string, unknown> | null {
  const dataPrefix = 'data: ';
  const dataStart = sseData.indexOf(dataPrefix);
  if (dataStart === -1) return null;

  const jsonStart = dataStart + dataPrefix.length;
  const jsonStr = sseData.slice(jsonStart).trim().replace(/\n\n$/, '');

  if (!jsonStr.startsWith('{')) return null;

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function cleanupBuild(commandId: string) {
  const context = activeBuilds.get(commandId);
  if (context) {
    console.log(`[persistent-processor] 🧹 Cleaning up build ${commandId}`);
    context.unsubscribe();
    activeBuilds.delete(commandId);
  }
}

/**
 * Register a build to be tracked for WebSocket broadcasts.
 * 
 * NOTE: Database persistence now happens via HTTP from the runner.
 * This function only sets up WebSocket broadcasting to frontend clients.
 *
 * @param commandId - Unique identifier for this build command
 * @param sessionId - Database session ID
 * @param projectId - Project ID
 * @param buildId - Build ID
 * @param agentId - Agent being used (claude-code or openai-codex)
 * @param claudeModelId - Claude model ID if using Claude Code
 * @returns Cleanup function to manually stop tracking
 */
export function registerBuild(
  commandId: string,
  sessionId: string,
  projectId: string,
  buildId: string,
  agentId: string,
  claudeModelId?: string
): () => void {
  // Check if already registered
  if (activeBuilds.has(commandId)) {
    console.warn(`[persistent-processor] Build ${commandId} already registered`);
    return () => cleanupBuild(commandId);
  }

  console.log(`[persistent-processor] 📝 Registering build ${commandId} for WebSocket broadcasts`);
  console.log(`[persistent-processor]    Agent: ${agentId}${claudeModelId ? ` (${claudeModelId})` : ''}`);
  console.log(`[persistent-processor]    NOTE: DB writes now via HTTP from runner`);

  const now = new Date();
  const context: ActiveBuildContext = {
    commandId,
    sessionId,
    projectId,
    buildId,
    agentId,
    claudeModelId,
    unsubscribe: () => {},
    startedAt: now,
    lastActivityAt: now, // Initialize to now, will be updated on each event
    isFinalized: false,
    currentActiveTodoIndex: -1,
  };

  // Subscribe to runner events for WebSocket broadcasting only
  // DB persistence is handled by HTTP endpoints
  const unsubscribe = addRunnerEventSubscriber(commandId, async (event: RunnerEvent) => {
    try {
      // Update last activity timestamp on any event
      context.lastActivityAt = new Date();
      
      if (event.type === 'build-stream' && typeof event.data === 'string') {
        // Parse SSE data for WebSocket broadcasting
        const eventData = parseSSEEventData(event.data);
        if (!eventData) return;

        // Handle WebSocket broadcasts based on event type
        // NOTE: DB writes are NOT done here - they happen via HTTP from runner
        switch (eventData.type) {
          case 'start':
            buildWebSocketServer.broadcastBuildStarted(
              context.projectId,
              context.sessionId,
              context.buildId
            );
            break;

          case 'tool-input-available': {
            const toolName = eventData.toolName as string | undefined;
            
            if (toolName === 'TodoWrite') {
              const input = eventData.input as { todos?: unknown } | undefined;
              let todosRaw = input?.todos;
              if (typeof todosRaw === 'string') {
                try {
                  const parsed = JSON.parse(todosRaw) as unknown;
                  todosRaw = Array.isArray(parsed)
                    ? parsed
                    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { todos?: unknown }).todos)
                      ? (parsed as { todos: unknown[] }).todos
                      : [];
                } catch {
                  todosRaw = [];
                }
              }
              const todos = Array.isArray(todosRaw)
                ? todosRaw.filter((t): t is { content?: string; activeForm?: string; status?: string } => !!t && typeof t === 'object')
                : [];
              
              // Update local active todo index for tracking
              context.currentActiveTodoIndex = todos.findIndex(t => t.status === 'in_progress');

              // Broadcast todos update via WebSocket
              buildWebSocketServer.broadcastTodosUpdate(
                context.projectId,
                context.sessionId,
                todos.map(t => ({
                  content: t.content ?? t.activeForm ?? 'Untitled task',
                  status: t.status ?? 'pending',
                  activeForm: t.activeForm,
                })),
                context.currentActiveTodoIndex
              );
            }
            // NOTE: Tool call broadcasts moved to /api/build-events endpoint
            // That route has access to DB and can send complete data (input + output + timing)
            break;
          }

          case 'tool-output-available': {
            // NOTE: Tool output broadcasts moved to /api/build-events endpoint
            // That route fetches input from DB and sends complete tool record with timing
            break;
          }

          // text-delta, reasoning, finish events:
          // No WebSocket broadcast needed - DB persistence via HTTP handles these
          default:
            break;
        }
      } else if (event.type === 'build-completed') {
        if (!context.isFinalized) {
          context.isFinalized = true;
          
          // Extract summary from event payload
          const payload = (event as { payload?: { summary?: string } }).payload;
          const summary = payload?.summary;
          
          console.log(`[persistent-processor] 🎉 Build completed: ${commandId}`, {
            hasSummary: !!summary,
            summaryLength: summary?.length,
          });
          
          buildWebSocketServer.broadcastBuildComplete(
            context.projectId,
            context.sessionId,
            'completed',
            summary
          );
        }
        cleanupBuild(commandId);
      } else if (event.type === 'build-failed' || event.type === 'error') {
        if (!context.isFinalized) {
          context.isFinalized = true;
          console.log(`[persistent-processor] ❌ Build failed: ${commandId}`);
          buildWebSocketServer.broadcastBuildComplete(
            context.projectId,
            context.sessionId,
            'failed'
          );
        }
        cleanupBuild(commandId);
      }
    } catch (error) {
      console.error('[persistent-processor] Error processing event for broadcast:', error);
    }
  });

  context.unsubscribe = unsubscribe;
  activeBuilds.set(commandId, context);

  return () => cleanupBuild(commandId);
}

/**
 * Check if a build is currently being tracked
 */
export function isBuildActive(commandId: string): boolean {
  return activeBuilds.has(commandId);
}

/**
 * Get all active build IDs (for debugging/monitoring)
 */
export function getActiveBuilds(): string[] {
  return Array.from(activeBuilds.keys());
}

// Throttle cleanup checks - only run every 5 minutes
declare global {
  // eslint-disable-next-line no-var
  var __lastStuckBuildCheck: number | undefined;
}
const STUCK_BUILD_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clean up stuck builds (builds that haven't received events in a while)
 * NOTE: This is simplified - DB finalization now happens via HTTP
 *
 * Throttled to only run every 5 minutes to avoid excessive logging.
 * 
 * IMPORTANT: This checks time since LAST ACTIVITY, not time since start.
 * A build that's been running for 30 minutes but received an event 1 minute ago
 * is NOT stuck - it's still active.
 */
export async function cleanupStuckBuilds(maxInactiveMinutes = 30) {
  const now = Date.now();
  const lastCheck = global.__lastStuckBuildCheck ?? 0;

  // Skip if we checked recently (within 5 minutes)
  if (now - lastCheck < STUCK_BUILD_CHECK_INTERVAL_MS) {
    return;
  }

  global.__lastStuckBuildCheck = now;
  const maxInactiveAge = maxInactiveMinutes * 60 * 1000;

  // Only log if there are active builds to check
  if (activeBuilds.size > 0) {
    console.log(`[persistent-processor] 🔍 Checking ${activeBuilds.size} builds for stuck state (inactive for ${maxInactiveMinutes}+ minutes)`);
  }

  for (const [commandId, context] of activeBuilds.entries()) {
    // Check time since LAST ACTIVITY, not time since start
    const timeSinceLastActivity = now - context.lastActivityAt.getTime();
    const totalAge = now - context.startedAt.getTime();
    
    if (timeSinceLastActivity > maxInactiveAge) {
      console.log(`[persistent-processor] Found stuck build ${commandId}, inactive for: ${Math.round(timeSinceLastActivity / 1000 / 60)} minutes (total age: ${Math.round(totalAge / 1000 / 60)} minutes)`);
      
      // Just clean up the tracking - DB finalization should have happened via HTTP
      if (!context.isFinalized) {
        console.log(`[persistent-processor] Cleaning up stuck build ${commandId}`);
        buildWebSocketServer.broadcastBuildComplete(
          context.projectId,
          context.sessionId,
          'failed'
        );
      }
      
      cleanupBuild(commandId);
    }
  }
}
