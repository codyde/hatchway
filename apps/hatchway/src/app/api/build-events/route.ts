/**
 * HTTP endpoint for persisting build events from the runner.
 *
 * SIMPLIFIED: Only persists meaningful events:
 * - Build start/complete (session status)
 * - Todo updates (via TodoWrite tool)
 * - Tool call start/complete
 *
 * Skipped events (handled via WebSocket for real-time UI only):
 * - text-delta (streaming text)
 * - reasoning (Claude's thinking)
 * - message content
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@hatchway/agent-core/lib/db/client';
import {
  buildMetrics,
  generationSessions,
  generationTodos,
  generationToolCalls,
  projects,
} from '@hatchway/agent-core/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { buildWebSocketServer } from '@hatchway/agent-core/lib/websocket/server';
import { authenticateRunnerKey, extractRunnerKey, isLocalMode } from '@/lib/auth-helpers';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function asOptionalText(value: unknown, maxLen = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function asCostText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 64);
  return null;
}

const SHARED_SECRET = process.env.RUNNER_SHARED_SECRET;

/**
 * Extract a project-relative path from an absolute path.
 * Looks for common project markers (src/, package.json, etc.) and shows from there.
 * Falls back to showing just the filename if path is too long.
 */
function formatProjectPath(absolutePath: string, maxLen: number = 60): string {
  const pathStr = String(absolutePath);
  
  // Common project directory markers - show path from these points
  const projectMarkers = [
    '/src/',
    '/app/',
    '/pages/',
    '/components/',
    '/lib/',
    '/utils/',
    '/api/',
    '/routes/',
    '/public/',
    '/styles/',
    '/assets/',
    '/config/',
    '/test/',
    '/tests/',
    '/__tests__/',
    '/spec/',
  ];
  
  // Try to find a project marker and show from there
  for (const marker of projectMarkers) {
    const markerIndex = pathStr.lastIndexOf(marker);
    if (markerIndex !== -1) {
      // Show from one directory before the marker for context
      // e.g., "project-name/src/components/App.tsx"
      const beforeMarker = pathStr.substring(0, markerIndex);
      const lastSlash = beforeMarker.lastIndexOf('/');
      const projectRelative = pathStr.substring(lastSlash + 1);
      
      if (projectRelative.length <= maxLen) {
        return projectRelative;
      }
      // Still too long, truncate from the start
      return '...' + projectRelative.slice(-(maxLen - 3));
    }
  }
  
  // Check for root config files (package.json, tsconfig.json, etc.)
  const configFiles = ['package.json', 'tsconfig.json', 'vite.config', 'next.config', 'astro.config', 'drizzle.config'];
  for (const config of configFiles) {
    if (pathStr.includes(config)) {
      // Get project name + config file
      const parts = pathStr.split('/');
      const configIndex = parts.findIndex(p => p.includes(config));
      if (configIndex > 0) {
        const projectRelative = parts.slice(configIndex - 1).join('/');
        if (projectRelative.length <= maxLen) {
          return projectRelative;
        }
      }
      // Just show the config file name
      return parts[parts.length - 1];
    }
  }
  
  // No markers found - show from the last directory that fits
  if (pathStr.length <= maxLen) {
    return pathStr;
  }
  
  // Get the last few path segments that fit
  const parts = pathStr.split('/');
  let result = parts[parts.length - 1]; // Start with filename
  
  for (let i = parts.length - 2; i >= 0; i--) {
    const potential = parts[i] + '/' + result;
    if (potential.length > maxLen - 3) {
      break;
    }
    result = potential;
  }
  
  return result.length < pathStr.length ? '.../' + result : result;
}

/**
 * Format a tool call into a user-friendly log message.
 * Extracts the most relevant info (file path, command, etc.) for each tool type.
 */
function formatToolLogMessage(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return toolName;
  }
  
  const args = input as Record<string, unknown>;
  
  switch (toolName) {
    case 'Read': {
      const filePath = args.filePath || args.file_path || args.path;
      if (filePath) {
        return `Read: ${formatProjectPath(String(filePath))}`;
      }
      return 'Read';
    }
    
    case 'Edit': {
      const filePath = args.filePath || args.file_path || args.path;
      if (filePath) {
        return `Edit: ${formatProjectPath(String(filePath))}`;
      }
      return 'Edit';
    }
    
    case 'Write': {
      const filePath = args.filePath || args.file_path || args.path;
      if (filePath) {
        return `Write: ${formatProjectPath(String(filePath))}`;
      }
      return 'Write';
    }
    
    case 'Bash': {
      const command = args.command || args.cmd;
      if (command) {
        const cmdStr = String(command);
        // Show first line only, truncated
        const firstLine = cmdStr.split('\n')[0];
        const maxLen = 60;
        const display = firstLine.length > maxLen 
          ? firstLine.slice(0, maxLen - 3) + '...' 
          : firstLine;
        return `Run: ${display}`;
      }
      return 'Bash';
    }
    
    case 'Glob': {
      const pattern = args.pattern;
      if (pattern) {
        return `Find: ${pattern}`;
      }
      return 'Glob';
    }
    
    case 'Grep': {
      const pattern = args.pattern;
      const include = args.include;
      if (pattern) {
        let msg = `Search: "${pattern}"`;
        if (include) msg += ` in ${include}`;
        return msg;
      }
      return 'Grep';
    }
    
    case 'WebFetch': {
      const url = args.url;
      if (url) {
        const urlStr = String(url);
        const maxLen = 60;
        const display = urlStr.length > maxLen 
          ? urlStr.slice(0, maxLen - 3) + '...' 
          : urlStr;
        return `Fetch: ${display}`;
      }
      return 'WebFetch';
    }
    
    case 'TodoWrite': {
      const todos = normalizeTodoWriteTodos(args.todos);
      if (todos.length > 0) {
        return `Update tasks (${todos.length} items)`;
      }
      return 'Update tasks';
    }
    
    default:
      return toolName;
  }
}

type NormalizedTodo = {
  content: string;
  status: string;
  activeForm?: string;
};

function asTodoRecord(item: unknown): NormalizedTodo | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const content =
    typeof rec.content === 'string'
      ? rec.content
      : typeof rec.activeForm === 'string'
        ? rec.activeForm
        : typeof rec.title === 'string'
          ? rec.title
          : '';
  if (!content.trim()) return null;
  return {
    content: content.trim(),
    status: typeof rec.status === 'string' ? rec.status : 'pending',
    activeForm: typeof rec.activeForm === 'string' ? rec.activeForm : undefined,
  };
}

/** Claude sometimes serializes TodoWrite.todos as a JSON string instead of an array. */
function normalizeTodoWriteTodos(raw: unknown): NormalizedTodo[] {
  const fromArray = (items: unknown[]): NormalizedTodo[] =>
    items.map(asTodoRecord).filter((item): item is NormalizedTodo => item !== null);

  if (Array.isArray(raw)) {
    return fromArray(raw);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return fromArray(parsed);
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { todos?: unknown }).todos)) {
        return fromArray((parsed as { todos: unknown[] }).todos);
      }
    } catch {
      return [];
    }
  }
  return [];
}

async function ensureAuthorized(request: Request): Promise<boolean> {
  // In local mode, always allow
  if (isLocalMode()) {
    return true;
  }
  
  const authHeader = request.headers.get('authorization');
  
  // First, check for user-scoped runner key (sv_xxx format)
  const runnerKey = extractRunnerKey(request);
  if (runnerKey) {
    const auth = await authenticateRunnerKey(runnerKey);
    return auth !== null;
  }
  
  // Fall back to shared secret (legacy/local mode)
  if (!SHARED_SECRET || !authHeader || authHeader !== `Bearer ${SHARED_SECRET}`) {
    return false;
  }
  return true;
}

interface BuildEventPayload {
  commandId: string;
  sessionId: string;
  projectId: string;
  buildId: string;
  agentId: string;
  claudeModelId?: string;
  event: {
    type: string;
    messageId?: string;
    toolCallId?: string;
    toolName?: string;
    todoIndex?: number;
    todo_index?: number;
    phase?: 'template' | 'build';
    input?: { todos?: Array<{ content?: string; activeForm?: string; status?: string }>; phase?: 'template' | 'build' };
    output?: unknown;
    error?: unknown;
    id?: string;
    delta?: string;
    message?: string;
    data?: { message?: string };
    metrics?: Record<string, unknown>;
  };
}

// Track active todo index per session
declare global {
  // eslint-disable-next-line no-var
  var __httpActiveTodoIndexes: Map<string, number> | undefined;
}
const activeTodoIndexes = global.__httpActiveTodoIndexes ?? new Map();
global.__httpActiveTodoIndexes = activeTodoIndexes;

// Track finalized sessions to prevent duplicate operations
declare global {
  // eslint-disable-next-line no-var
  var __httpFinalizedSessions: Set<string> | undefined;
}
const finalizedSessions = global.__httpFinalizedSessions ?? new Set();
global.__httpFinalizedSessions = finalizedSessions;

// Track previous todo count per session to avoid unnecessary pruning queries
declare global {
  // eslint-disable-next-line no-var
  var __httpPreviousTodoCounts: Map<string, number> | undefined;
}
const previousTodoCounts = global.__httpPreviousTodoCounts ?? new Map();
global.__httpPreviousTodoCounts = previousTodoCounts;

// Track started sessions to avoid duplicate start event processing
declare global {
  // eslint-disable-next-line no-var
  var __httpStartedSessions: Set<string> | undefined;
}
const startedSessions = global.__httpStartedSessions ?? new Set();
global.__httpStartedSessions = startedSessions;

export async function POST(request: Request) {
  if (!(await ensureAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as BuildEventPayload;
    const { commandId, projectId, buildId, event } = payload;
    let { sessionId } = payload;

    if (!projectId || !event?.type) {
      return NextResponse.json({ error: 'Missing required fields: projectId and event.type' }, { status: 400 });
    }

    // If sessionId not provided, look it up from buildId or commandId
    if (!sessionId && (buildId || commandId)) {
      const lookupId = buildId || `build-${commandId}`;
      const sessions = await db.select()
        .from(generationSessions)
        .where(eq(generationSessions.buildId, lookupId))
        .limit(1);

      if (sessions.length > 0) {
        sessionId = sessions[0].id;
      } else {
        // Try alternative lookup by projectId and recent session
        const recentSessions = await db.select()
          .from(generationSessions)
          .where(eq(generationSessions.projectId, projectId))
          .orderBy(sql`${generationSessions.createdAt} DESC`)
          .limit(1);

        if (recentSessions.length > 0) {
          sessionId = recentSessions[0].id;
        }
      }
    }

    if (!sessionId) {
      console.warn(`[build-events] No session found for buildId=${buildId}, commandId=${commandId}, projectId=${projectId}`);
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const timestamp = new Date();

    // Process based on event type - ONLY persist meaningful events
    switch (event.type) {
      case 'start': {
        console.log(`[build-events] 🚀 start event received (sessionId=${sessionId}, projectId=${projectId})`);

        // Skip duplicate start events for the same session
        if (startedSessions.has(sessionId)) {
          console.log(`[build-events] ⏭️ Skipping duplicate start event for session ${sessionId}`);
          break;
        }

        // Mark session as started
        startedSessions.add(sessionId);

        // DB: Update session status to active
        await db.update(generationSessions)
          .set({ status: 'active', updatedAt: timestamp })
          .where(eq(generationSessions.id, sessionId));

        // WebSocket: Broadcast build started
        console.log(`[build-events] 📡 Broadcasting build-started (projectId=${projectId}, sessionId=${sessionId})`);
        buildWebSocketServer.broadcastBuildStarted(projectId, sessionId, buildId);
        break;
      }

      case 'tool-input-available': {
        const toolCallId = event.toolCallId ?? randomUUID();
        const todoIndex = event.todoIndex ?? event.todo_index ?? activeTodoIndexes.get(sessionId) ?? -1;

        if (event.toolName === 'TodoWrite') {
          // DB: Also insert TodoWrite as a tool call (for output-available to find)
          await db.insert(generationToolCalls).values({
            sessionId,
            todoIndex,
            toolCallId,
            name: 'TodoWrite',
            input: event.input ?? null,
            state: 'input-available',
            startedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          }).onConflictDoUpdate({
            target: [generationToolCalls.sessionId, generationToolCalls.toolCallId],
            set: { input: event.input ?? null, state: 'input-available', updatedAt: timestamp },
          });

          // DB: Upsert todos
          // Claude sometimes serializes `todos` as a JSON string instead of an array.
          const todos = normalizeTodoWriteTodos(event.input?.todos);
          const prevCount = previousTodoCounts.get(sessionId) ?? 0;

          if (todos.length > 0) {
            const todoValues = todos.map((todo, index) => ({
              sessionId,
              todoIndex: index,
              content: todo.content,
              activeForm: todo.activeForm ?? null,
              status: todo.status,
              createdAt: timestamp,
              updatedAt: timestamp,
            }));

            await db.insert(generationTodos)
              .values(todoValues)
              .onConflictDoUpdate({
                target: [generationTodos.sessionId, generationTodos.todoIndex],
                set: {
                  content: sql`excluded.content`,
                  activeForm: sql`excluded.active_form`,
                  status: sql`excluded.status`,
                  updatedAt: sql`excluded.updated_at`,
                },
              });
          }

          // Prune if todo count decreased
          if (todos.length < prevCount) {
            await db.delete(generationToolCalls)
              .where(and(
                eq(generationToolCalls.sessionId, sessionId),
                sql`${generationToolCalls.todoIndex} >= ${todos.length}`,
              ));
            await db.delete(generationTodos)
              .where(and(
                eq(generationTodos.sessionId, sessionId),
                sql`${generationTodos.todoIndex} >= ${todos.length}`,
              ));
          }

          // Update tracking
          previousTodoCounts.set(sessionId, todos.length);
          const activeIndex = todos.findIndex(t => t.status === 'in_progress');
          activeTodoIndexes.set(sessionId, activeIndex);

          // WebSocket: Broadcast todos update (include phase if present)
          const phase = event.input?.phase ?? event.phase;
          buildWebSocketServer.broadcastTodosUpdate(
            projectId,
            sessionId,
            todos.map(t => ({
              content: t.content,
              status: t.status,
              activeForm: t.activeForm,
            })),
            activeIndex,
            phase
          );

          // Auto-finalize if all todos complete
          // NOTE: Only auto-finalize for build phase todos, not template phase
          // Don't broadcast build-complete here - the runner will send build-completed
          // event with the summary, and persistent-event-processor will broadcast it
          const allComplete = todos.length > 0 && todos.every(t => t.status === 'completed');
          const isTemplatePhase = phase === 'template';
          if (allComplete && !finalizedSessions.has(sessionId) && !isTemplatePhase) {
            finalizedSessions.add(sessionId);
            await db.update(generationSessions)
              .set({ status: 'completed', endedAt: timestamp, updatedAt: timestamp })
              .where(eq(generationSessions.id, sessionId));
            // Don't broadcast here - let persistent-event-processor handle it with summary
            console.log(`[build-events] ✅ Session ${sessionId} marked complete in DB (waiting for runner summary)`);
          }
        }

        // DB: Insert tool call record (skip TodoWrite - handled above)
        if (event.toolName && event.toolName !== 'TodoWrite') {
          // Log user-friendly tool info with relevant details
          const toolInfo = formatToolLogMessage(event.toolName, event.input);
          console.log(`🔧 ${toolInfo}`);

          await db.insert(generationToolCalls).values({
            sessionId,
            todoIndex,
            toolCallId,
            name: event.toolName,
            input: event.input ?? null,
            state: 'input-available',
            startedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          }).onConflictDoUpdate({
            target: [generationToolCalls.sessionId, generationToolCalls.toolCallId],
            set: { input: event.input ?? null, state: 'input-available', updatedAt: timestamp },
          });

          // Broadcast tool starts immediately so the activity feed feels live.
          // (Previously execution-phase tools only broadcast on completion.)
          buildWebSocketServer.broadcastToolCall(projectId, sessionId, {
            id: toolCallId,
            name: event.toolName,
            todoIndex,
            input: event.input ?? undefined,
            state: 'input-available',
          });
        }
        break;
      }

      case 'tool-output-available': {
        const toolCallId = event.toolCallId ?? '';
        const todoIndex = event.todoIndex ?? event.todo_index ?? activeTodoIndexes.get(sessionId) ?? -1;

        // DB: Fetch existing tool call to get input data
        const existingTools = await db.select()
          .from(generationToolCalls)
          .where(and(
            eq(generationToolCalls.sessionId, sessionId),
            eq(generationToolCalls.toolCallId, toolCallId),
          ))
          .limit(1);

        const existingTool = existingTools[0];

        if (!existingTool) {
          // Tool not found - input event never arrived or had different ID
          // Don't broadcast if we don't have the input data
          break;
        }

        // DB: Update tool call with output
        await db.update(generationToolCalls)
          .set({
            output: event.output ?? null,
            state: 'output-available',
            endedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(and(
            eq(generationToolCalls.sessionId, sessionId),
            eq(generationToolCalls.toolCallId, toolCallId),
          ));

        // Check for GitHub repo info in tool output (gh repo view --json output)
        // This parses the output server-side so frontend doesn't need to handle it
        // IMPORTANT: Only match actual repository URLs, not issues/PRs/etc
        if (event.output && typeof event.output === 'string') {
          // First, check if this looks like gh repo view JSON output (has defaultBranchRef which is repo-specific)
          // This prevents matching gh issue view or gh pr view output
          const hasDefaultBranch = event.output.includes('"defaultBranchRef"');
          
          // Only try to extract repo URL if this looks like repo data
          if (hasDefaultBranch) {
            // Match repo URL - must be exactly owner/repo format, not owner/repo/issues/123 etc
            const ghRepoMatch = event.output.match(/"url"\s*:\s*"(https:\/\/github\.com\/([^\/]+)\/([^"\/]+))"/);
            if (ghRepoMatch) {
              const [, url, owner, repoName] = ghRepoMatch;
              
              // Double-check: skip if this looks like an issue/PR URL somehow
              if (url.includes('/issues/') || url.includes('/pull/') || url.includes('/discussions/')) {
                console.log(`🐙 [build-events] Skipping non-repo URL: ${url}`);
              } else {
                // Try to extract branch from the output
                // Check for defaultBranchRef in gh repo view output
                let branch = 'main'; // fallback
                const branchMatch = event.output.match(/"defaultBranchRef"\s*:\s*{\s*"name"\s*:\s*"([^"]+)"/);
                if (branchMatch) {
                  branch = branchMatch[1];
                }
                
                console.log(`🐙 [build-events] Found GitHub repo in tool output: ${owner}/${repoName} (branch: ${branch})`);
                
                // Update project with GitHub info
                try {
                  await db.update(projects)
                    .set({
                      githubRepo: `${owner}/${repoName}`,
                      githubUrl: url,
                      githubBranch: branch,
                      githubLastPushedAt: timestamp,
                      updatedAt: timestamp,
                    })
                    .where(eq(projects.id, projectId));
                  console.log(`🐙 [build-events] Updated project ${projectId} with GitHub info`);
                } catch (e) {
                  console.error('[build-events] Failed to update project GitHub info:', e);
                }
              }
            }
          }

          // Check for NeonDB/get-db CLI output in Bash command output
          // The CLI outputs: DATABASE_URL=postgresql://... and claim URL
          // Example output:
          // # Claimable DB expires at: Sun, 05 Oct 2025 23:11:33 GMT
          // # Claim it now to your account: https://neon.new/database/xxx
          // DATABASE_URL=postgresql://neondb_owner:password@ep-xxx.region.aws.neon.tech/neondb?...
          const databaseUrlMatch = event.output.match(/DATABASE_URL=postgresql:\/\/([^:]+):([^@]+)@([^\/]+)\/([^\s?]+)/);
          const claimUrlMatch = event.output.match(/https:\/\/neon\.new\/database\/[a-f0-9-]+/);
          const expiresMatch = event.output.match(/Claimable DB expires at:\s*([^\n]+)/);
          
          if (databaseUrlMatch) {
            try {
              const [fullMatch, username, password, host, database] = databaseUrlMatch;
              const connectionString = `postgresql://${username}:${password}@${host}/${database}`;
              const claimUrl = claimUrlMatch ? claimUrlMatch[0] : null;
              
              // Parse expiration date or default to 72 hours from now
              let expiresAt: Date;
              if (expiresMatch) {
                const parsedDate = new Date(expiresMatch[1].trim());
                expiresAt = isNaN(parsedDate.getTime()) 
                  ? new Date(Date.now() + 72 * 60 * 60 * 1000)
                  : parsedDate;
              } else {
                expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
              }
              
              console.log(`🐘 [build-events] Found NeonDB setup in CLI output: ${host}/${database}`);
              
              await db.update(projects)
                .set({
                  neondbHost: host,
                  neondbDatabase: database,
                  neondbClaimUrl: claimUrl,
                  neondbConnectionString: connectionString,
                  neondbCreatedAt: timestamp,
                  neondbExpiresAt: expiresAt,
                  updatedAt: timestamp,
                })
                .where(eq(projects.id, projectId));
              console.log(`🐘 [build-events] Updated project ${projectId} with NeonDB info`);
            } catch (e) {
              console.error('[build-events] Failed to parse/update NeonDB result:', e);
            }
          }

          // Also check for explicit NEONDB_RESULT marker (skill output)
          const neondbMarkerMatch = event.output.match(/NEONDB_RESULT:(\{[^}]+\})/);
          if (neondbMarkerMatch && !databaseUrlMatch) {
            try {
              const neonResult = JSON.parse(neondbMarkerMatch[1]);
              if (neonResult.success) {
                console.log(`🐘 [build-events] Found NeonDB result marker in output`);
                
                const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
                
                await db.update(projects)
                  .set({
                    neondbHost: neonResult.host || null,
                    neondbDatabase: neonResult.database || 'neondb',
                    neondbClaimUrl: neonResult.claimUrl || null,
                    neondbConnectionString: neonResult.connectionString || null,
                    neondbCreatedAt: timestamp,
                    neondbExpiresAt: expiresAt,
                    updatedAt: timestamp,
                  })
                  .where(eq(projects.id, projectId));
                console.log(`🐘 [build-events] Updated project ${projectId} with NeonDB info from marker`);
              }
            } catch (e) {
              console.error('[build-events] Failed to parse NeonDB marker:', e);
            }
          }
        }

        // WebSocket: Broadcast tool completion WITH COMPLETE DATA
        // Broadcast ALL tools including planning phase (todoIndex < 0)
        // Frontend handles planning tools separately via planningTools array
        if (event.toolName) {
          buildWebSocketServer.broadcastToolCall(projectId, sessionId, {
            id: toolCallId,
            name: event.toolName,
            todoIndex,
            input: existingTool?.input ?? undefined, // Include input for UI details (file paths, etc.)
            output: event.output, // Include output for frontend
            state: 'output-available',
          });
        }
        break;
      }

      case 'tool-error': {
        const toolCallId = event.toolCallId ?? '';
        const todoIndex = event.todoIndex ?? event.todo_index ?? activeTodoIndexes.get(sessionId) ?? -1;

        // DB: Fetch existing tool call to get input data
        const existingErrorTools = await db.select()
          .from(generationToolCalls)
          .where(and(
            eq(generationToolCalls.sessionId, sessionId),
            eq(generationToolCalls.toolCallId, toolCallId),
          ))
          .limit(1);

        const existingErrorTool = existingErrorTools[0];

        if (!existingErrorTool) {
          // Tool not found - don't broadcast
          break;
        }

        // DB: Update tool call with error
        await db.update(generationToolCalls)
          .set({
            output: event.error ?? event.output ?? null,
            state: 'error',
            endedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(and(
            eq(generationToolCalls.sessionId, sessionId),
            eq(generationToolCalls.toolCallId, toolCallId),
          ));

        // WebSocket: Broadcast tool error WITH COMPLETE DATA
        // Broadcast ALL tools including planning phase (todoIndex < 0)
        if (event.toolName) {
          buildWebSocketServer.broadcastToolCall(projectId, sessionId, {
            id: toolCallId,
            name: event.toolName,
            todoIndex,
            input: existingErrorTool?.input ?? undefined, // Include input for UI details
            output: event.error ?? event.output, // Include error for frontend
            state: 'error',
          });
        }
        break;
      }

      case 'build-metrics': {
        const metrics = asRecord(event.metrics);
        const timings = asRecord(metrics.timings);
        const tokens = asRecord(metrics.tokens);
        const agentMetrics = asRecord(metrics.agentMetrics);
        const dependencies = asRecord(metrics.dependencies);
        const output = asRecord(metrics.output);

        const resolvedCommandId =
          asOptionalText(metrics.commandId ?? commandId, 200) ?? null;
        const resolvedBuildId =
          asOptionalText(metrics.buildId ?? buildId, 200) ?? null;
        const resolvedStatus =
          asOptionalText(metrics.status, 32) ?? 'unknown';

        const row = {
          projectId,
          sessionId,
          buildId: resolvedBuildId,
          commandId: resolvedCommandId,
          status: resolvedStatus,
          agent: asOptionalText(metrics.agent, 100),
          model: asOptionalText(metrics.model, 200),
          totalMs: asFiniteInt(timings.totalMs),
          orchestrationMs: asFiniteInt(timings.orchestrationMs),
          agentMs: asFiniteInt(timings.agentMs),
          timeToFirstChunkMs: asFiniteInt(timings.timeToFirstChunkMs),
          runnerOverheadMs: asFiniteInt(timings.runnerOverheadMs),
          totalTokens: asFiniteInt(tokens.total),
          inputTokens: asFiniteInt(tokens.input),
          outputTokens: asFiniteInt(tokens.output),
          cacheReadInputTokens: asFiniteInt(tokens.cacheReadInput),
          cacheCreationInputTokens: asFiniteInt(tokens.cacheCreationInput),
          numTurns: asFiniteInt(agentMetrics.numTurns),
          totalCostUsd: asCostText(agentMetrics.totalCostUsd),
          dependencyInstallTotalMs: asFiniteInt(dependencies.installTotalMs),
          dependencyInstallCalls: asFiniteInt(dependencies.installCalls),
          modifiedFileCount: asFiniteInt(output.modifiedFileCount),
          completedTodoCount: asFiniteInt(output.completedTodoCount),
          error: asOptionalText(metrics.error, 500),
          metrics: {
            projectId,
            sessionId,
            buildId: resolvedBuildId,
            commandId: resolvedCommandId,
            ...metrics,
          },
        };

        try {
          if (resolvedCommandId) {
            await db.insert(buildMetrics).values(row).onConflictDoUpdate({
              target: buildMetrics.commandId,
              set: {
                projectId: row.projectId,
                sessionId: row.sessionId,
                buildId: row.buildId,
                status: row.status,
                agent: row.agent,
                model: row.model,
                totalMs: row.totalMs,
                orchestrationMs: row.orchestrationMs,
                agentMs: row.agentMs,
                timeToFirstChunkMs: row.timeToFirstChunkMs,
                runnerOverheadMs: row.runnerOverheadMs,
                totalTokens: row.totalTokens,
                inputTokens: row.inputTokens,
                outputTokens: row.outputTokens,
                cacheReadInputTokens: row.cacheReadInputTokens,
                cacheCreationInputTokens: row.cacheCreationInputTokens,
                numTurns: row.numTurns,
                totalCostUsd: row.totalCostUsd,
                dependencyInstallTotalMs: row.dependencyInstallTotalMs,
                dependencyInstallCalls: row.dependencyInstallCalls,
                modifiedFileCount: row.modifiedFileCount,
                completedTodoCount: row.completedTodoCount,
                error: row.error,
                metrics: row.metrics,
              },
            });
          } else {
            await db.insert(buildMetrics).values(row);
          }

          console.log(`[build-metrics] persisted ${JSON.stringify({
            projectId,
            sessionId,
            buildId: resolvedBuildId,
            commandId: resolvedCommandId,
            status: resolvedStatus,
            totalMs: row.totalMs,
            agentMs: row.agentMs,
            orchestrationMs: row.orchestrationMs,
            dependencyInstallTotalMs: row.dependencyInstallTotalMs,
            totalTokens: row.totalTokens,
            agent: row.agent,
            model: row.model,
          })}`);
        } catch (metricsError) {
          // Keep the log fallback so we never lose the payload if the table
          // is missing or a write fails before migrations land.
          console.error('[build-metrics] failed to persist metrics', metricsError);
          console.log(`[build-metrics] ${JSON.stringify({
            projectId,
            sessionId,
            buildId,
            commandId,
            ...metrics,
          })}`);
        }
        break;
      }

      // SKIPPED EVENTS - no DB writes, just acknowledge
      case 'text-delta':
      case 'data-reasoning':
      case 'reasoning':
      case 'finish':
        // These events are handled via WebSocket for real-time UI
        // No database persistence needed
        break;

      default:
        // No-op for unknown event types
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[build-events] Error processing event:', error);
    return NextResponse.json({ error: 'Failed to process event' }, { status: 500 });
  }
}
