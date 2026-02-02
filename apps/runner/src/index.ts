// Sentry is initialized via --import flag (see package.json scripts)
// This ensures instrumentation loads before any other modules
import * as Sentry from "@sentry/node";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { fileLog, setFileLoggerTuiMode } from "./lib/file-logger.js";
import { config as loadEnv } from "dotenv";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeClaudeQuery } from "./lib/native-claude-sdk.js";
import { createOpenCodeQuery, USE_OPENCODE_SDK } from "./lib/opencode-sdk.js";
import { createDroidQuery } from "./lib/droid-sdk-query.js";
import WebSocket from "ws";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import express from "express";
import type { Server } from "http";
import {
  CLAUDE_SYSTEM_PROMPT,
  CODEX_SYSTEM_PROMPT, // Codex-specific prompt without TodoWrite tool references
  DEFAULT_CLAUDE_MODEL_ID,
  DEFAULT_OPENCODE_MODEL_ID,
  normalizeModelId,
  type RunnerCommand,
  type RunnerEvent,
  type AgentId,
  type ClaudeModelId,
  type OpenCodeModelId,
  setTemplatesPath,
} from "@openbuilder/agent-core";
import { CLAUDE_CLI_TOOL_REGISTRY } from "@openbuilder/agent-core/lib/claude/tools";
import { buildLogger } from "@openbuilder/agent-core/lib/logging/build-logger";
import { createBuildStream } from "./lib/build/engine.js";
import { startDevServer, startDevServerAsync, stopDevServer, checkPortInUse, findAvailablePort } from "./lib/process-manager.js";
import { getWorkspaceRoot } from "./lib/workspace.js";
import {
  transformAgentMessageToSSE,
  resetTransformerState,
  setExpectedCwd,
} from "./lib/message-transformer.js";
import { transformCodexStream } from "./lib/codex-sdk-adapter.js";

import { orchestrateBuild } from "./lib/build-orchestrator.js";
import { analyzeProject } from "./lib/project-analyzer.js";
import { tunnelManager } from "./lib/tunnel/manager.js";
import { waitForPort } from "./lib/port-checker.js";
import { createProjectScopedPermissionHandler } from "./lib/permissions/project-scoped-handler.js";
import { hmrProxyManager } from "./lib/hmr-proxy-manager.js";
import { ensureProjectSkills } from "./lib/skills.js";
import { 
  initRunnerLogger, 
  getLogger,
  type RunnerLoggerOptions 
} from "./lib/logging/index.js";

// AI SDK log warnings disabled (legacy - no longer using AI SDK)

/**
 * Truncate strings for logging to prevent excessive output
 */
function truncate(str: string, maxLength: number = 200): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

/**
 * Truncate JSON objects for logging
 */
function truncateJSON(obj: unknown, maxLength: number = 200): string {
  const json = JSON.stringify(obj, null, 2);
  return truncate(json, maxLength);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
setTemplatesPath(resolve(__dirname, "../templates.json"));

loadEnv({ path: resolve(__dirname, "../.env.local"), override: true });

export interface RunnerOptions {
  wsUrl?: string;
  apiUrl?: string;
  sharedSecret?: string;
  runnerId?: string;
  workspace?: string;
  heartbeatInterval?: number;
  silent?: boolean; // Suppress console output (for TUI mode)
  verbose?: boolean; // Enable verbose logging
  tuiMode?: boolean; // Enable TUI dashboard (default: true)
}

let isSilentMode = false;
let isVerboseMode = false;
let isTuiMode = true;

// Build logging can be controlled separately
const DEBUG_BUILD = process.env.DEBUG_BUILD === "1" || false;



/**
 * Log a message through the unified logger
 * Falls back to console.log if logger not initialized
 */
const log = (...args: unknown[]) => {
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  
  try {
    const logger = getLogger();
    logger.info('system', message);
  } catch {
    // Logger not yet initialized - use console
    console.log("[runner]", ...args);
  }
};

/**
 * Log a build-related message
 */
const buildLog = (...args: unknown[]) => {
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  
  try {
    const logger = getLogger();
    logger.info('build', message);
  } catch {
    // Logger not yet initialized - use console  
    console.log("[runner] [build]", ...args);
  }
};

/**
 * Log a debug/verbose message (only shown in verbose mode)
 */
const debugLog = (...args: unknown[]) => {
  if (!isVerboseMode && !DEBUG_BUILD) return;
  
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  
  try {
    const logger = getLogger();
    logger.debug('system', message);
  } catch {
    console.log("[runner] [debug]", ...args);
  }
};

const DEFAULT_AGENT: AgentId = "claude-code";
const CODEX_MODEL = "gpt-5-codex";

// Stderr debug logging - suppressed in TUI mode (SILENT_MODE=1)
const stderrDebug = (message: string) => {
  if (process.env.SILENT_MODE !== '1' && DEBUG_BUILD) {
    process.stderr.write(message);
  }
};

type CodexEvent = {
  type: string;
  item?: Record<string, unknown>;
  finalResponse?: string;
  usage?: unknown;
  error?: unknown;
};

interface MessagePart {
  type: string;
  text?: string;
  image?: string;
  mimeType?: string;
  fileName?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  state?: string;
}

type BuildQueryFn = (
  prompt: string,
  workingDirectory: string,
  systemPrompt: string,
  agent?: AgentId,
  codexThreadId?: string,
  messageParts?: MessagePart[]
) => AsyncGenerator<unknown, void, unknown>;

function resolveCodexItemType(
  item: Record<string, unknown> | undefined
): string {
  if (!item) return "";
  if (typeof item.type === "string") return item.type;
  if (typeof (item as { item_type?: unknown }).item_type === "string") {
    return String((item as { item_type?: unknown }).item_type);
  }
  return "";
}

function resolveCodexItemId(item: Record<string, unknown> | undefined): string {
  if (!item) return randomUUID();
  const candidateKeys = [
    "id",
    "item_id",
    "tool_call_id",
    "tool_use_id",
  ] as const;
  for (const key of candidateKeys) {
    const value = item[key as keyof typeof item];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return randomUUID();
}

/**
 * Helper to extract just the filename from a path
 */
function getBasename(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Helper to extract command name and filename from a full command string
 * Example: "cd /path/to/project && npm install" -> "npm install"
 * Example: "cat /long/path/to/file.ts" -> "cat file.ts"
 */
function simplifyCommand(fullCommand: string): string {
  // Remove cd commands and everything before &&
  let cmd = fullCommand.replace(/^.*&&\s*/, '').trim();
  
  // Strip leading and trailing quotes (single or double)
  cmd = cmd.replace(/^["']|["']$/g, '');
  
  // For file operation commands (cat, grep, edit, etc.), extract just filename
  const fileOpMatch = cmd.match(/^(\w+)\s+(.+)$/);
  if (fileOpMatch) {
    const [, command, args] = fileOpMatch;
    // Split by spaces to handle multiple arguments
    const argParts = args.split(/\s+/);
    const simplifiedArgs = argParts.map(arg => {
      // Strip quotes from individual arguments
      const cleanArg = arg.replace(/^["']|["']$/g, '');
      // If it looks like a file path, extract basename
      if (cleanArg.includes('/')) {
        return cleanArg.split('/').pop() || cleanArg;
      }
      return cleanArg;
    });
    return `${command} ${simplifiedArgs.join(' ')}`;
  }
  
  return cmd;
}

function extractCodexToolInput(item: Record<string, unknown> | undefined) {
  if (!item) return {};
  const possibleKeys = ["arguments", "args", "input"] as const;
  for (const key of possibleKeys) {
    const value = item[key as keyof typeof item];
    if (value !== undefined) {
      // Simplify paths in tool inputs for better display
      if (typeof value === 'object' && value !== null) {
        const inputObj = { ...value } as Record<string, unknown>;
        
        // Simplify file_path or path parameters
        if (typeof inputObj.file_path === 'string') {
          inputObj.file_path = getBasename(inputObj.file_path);
        }
        if (typeof inputObj.path === 'string') {
          inputObj.path = getBasename(inputObj.path);
        }
        if (typeof inputObj.target_file === 'string') {
          inputObj.target_file = getBasename(inputObj.target_file);
        }
        
        return inputObj;
      }
      return value;
    }
  }
  return {};
}

function extractCodexToolOutput(item: Record<string, unknown> | undefined) {
  if (!item) return null;
  const possibleKeys = [
    "aggregated_output",
    "output",
    "stdout",
    "result",
    "response",
    "content",
  ] as const;
  for (const key of possibleKeys) {
    const value = item[key as keyof typeof item];
    if (value !== undefined) {
      return value;
    }
  }
  return null;
}

async function* convertCodexEventsToAgentMessages(
  events: AsyncIterable<unknown>
): AsyncGenerator<Record<string, unknown>, void, unknown> {
  let eventCount = 0;
  for await (const rawEvent of events) {
    eventCount++;
    const event = rawEvent as CodexEvent;

    // Log every single raw event from Codex
    console.log(
      `[codex-events] ═══════════════════════════════════════════════`
    );
    if (!isSilentMode && DEBUG_BUILD)
      console.log(`[codex-events] RAW EVENT #${eventCount}`);
    if (!isSilentMode && DEBUG_BUILD)
      console.log(`[codex-events] Type: ${event.type}`);
    if (!isSilentMode && DEBUG_BUILD)
      console.log(
        `[codex-events] Full event: ${JSON.stringify(event, null, 2)}`
      );
    console.log(
      `[codex-events] ═══════════════════════════════════════════════`
    );

    const item = (event.item ?? undefined) as unknown as
      | Record<string, unknown>
      | undefined;
    const itemType = resolveCodexItemType(item);
    const itemId = resolveCodexItemId(item);

    switch (event.type) {
      case "item.started": {
        if (itemType === "tool_call" || itemType === "mcp_tool_call") {
          yield {
            type: "assistant",
            message: {
              id: itemId,
              content: [
                {
                  type: "tool_use",
                  id: itemId,
                  name:
                    (item?.name as string) ||
                    (item?.tool_name as string) ||
                    "tool_call",
                  input: extractCodexToolInput(item),
                },
              ],
            },
          };
        } else if (itemType === "command_execution") {
          const fullCommand = (item?.command as string) || (item?.cmd as string) || "";
          const displayCommand = simplifyCommand(fullCommand);
          yield {
            type: "assistant",
            message: {
              id: itemId,
              content: [
                {
                  type: "tool_use",
                  id: itemId,
                  name: "command_execution",
                  input: {
                    command: displayCommand,
                  },
                },
              ],
            },
          };
        } else if (itemType === "file_change") {
          // Convert file_change events to tool_use for UI display
          const changes =
            (item?.changes as { kind: string; path: string }[]) || [];
          const filePaths = changes.map((c) => getBasename(c.path) || "unknown").join(", ");
          yield {
            type: "assistant",
            message: {
              id: itemId,
              content: [
                {
                  type: "tool_use",
                  id: itemId,
                  name: "file_change",
                  input: {
                    changes: changes,
                    summary: `Modified ${changes.length} file(s): ${filePaths}`,
                  },
                },
              ],
            },
          };
        }
        break;
      }
      case "item.completed": {
        if (itemType === "assistant_message" || itemType === "agent_message") {
          const text = (item?.text as string) || "";
          if (text.trim().length > 0) {
            yield {
              type: "assistant",
              message: {
                id: itemId,
                content: [
                  {
                    type: "text",
                    text,
                  },
                ],
              },
            };
          }
        } else if (itemType === "reasoning") {
          const reasoning = (item?.text as string) || "";
          if (reasoning.trim().length > 0) {
            yield {
              type: "assistant",
              message: {
                id: itemId,
                content: [
                  {
                    type: "text",
                    text: reasoning,
                  },
                ],
              },
            };
          }
        } else if (
          itemType === "command_execution" ||
          itemType === "tool_call" ||
          itemType === "mcp_tool_call" ||
          itemType === "file_change"
        ) {
          const output = extractCodexToolOutput(item);
          const exitCode =
            typeof item?.exit_code === "number" ? item.exit_code : undefined;
          const status =
            typeof item?.status === "string" ? item.status : undefined;
          const isError =
            typeof exitCode === "number"
              ? exitCode !== 0
              : status === "failed" || status === "error";

          // For file_change, create a more readable output
          let finalOutput = output;
          if (itemType === "file_change" && !output) {
            const changes =
              (item?.changes as { kind: string; path: string }[]) || [];
            finalOutput = changes
              .map((c) => `${c.kind || "modified"}: ${c.path}`)
              .join("\n");
          }

          yield {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: itemId,
                  content: finalOutput,
                  is_error: isError || undefined,
                  status,
                  exit_code: exitCode,
                },
              ],
            },
          };
        }
        break;
      }
      case "turn.completed": {
        yield {
          type: "result",
          result: event.finalResponse ?? null,
          usage: event.usage,
        };
        break;
      }
      case "error": {
        yield {
          type: "error",
          error: event.error,
        };
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Create Codex query function using ORIGINAL Codex SDK (NOT AI SDK)
 *
 * NOTE: This function prepends CLAUDE_SYSTEM_PROMPT to the systemPrompt from orchestrator.
 * UNIFIED: Both Claude and Codex now use the same base prompt for consistency.
 * The orchestrator provides context-specific sections only (no base prompt).
 *
 * Uses two-phase execution:
 * 1. Planning phase: Get structured task list with JSON schema
 * 2. Execution phase: Work through tasks sequentially
 */
function createCodexQuery(): BuildQueryFn {
  return async function* codexQuery(
    prompt: string,
    workingDirectory: string,
    systemPrompt: string,
    agent?: AgentId,
    codexThreadId?: string,
    messageParts?: MessagePart[]
  ) {
    buildLogger.codexQuery.promptBuilding(
      workingDirectory,
      CLAUDE_SYSTEM_PROMPT.length + (systemPrompt?.length || 0),
      prompt.length
    );

    fileLog.info("━━━ CODEX QUERY STARTED ━━━");
    fileLog.info("Working directory:", workingDirectory);
    fileLog.info("Prompt length:", prompt.length);

    // Note: Codex is auto-instrumented by Sentry's openAIIntegration via OTel
    const codex = new Codex();

    const systemParts: string[] = [CODEX_SYSTEM_PROMPT.trim()]; // Use Codex-specific prompt (no TodoWrite tool)
    if (systemPrompt && systemPrompt.trim().length > 0) {
      systemParts.push(systemPrompt.trim());
    }

    // Combine system prompt and user prompt
    // Note: Codex SDK doesn't have system prompt configuration, so we prepend it to the user prompt
    const combinedPrompt = `${systemParts.join("\n\n")}\n\n${prompt}`;

    fileLog.info('Using CODEX_SYSTEM_PROMPT (TodoWrite references replaced with JSON code blocks)');

    // Resume existing thread for enhancements, start new for initial builds
    let thread;

    // NOTE: MCP server configuration
    // The Codex SDK doesn't support mcpServers in ThreadOptions (checked types)
    // MCP servers are auto-discovered from ~/.codex/config or environment
    // TODO: Research proper MCP configuration method for Codex SDK

    if (codexThreadId) {
      log(`🔄 [codex-query] Resuming thread: ${codexThreadId}`);
      fileLog.info('Resuming Codex thread:', codexThreadId);
      thread = codex.resumeThread(codexThreadId, {
        sandboxMode: "danger-full-access",
        model: CODEX_MODEL,
        workingDirectory,
        skipGitRepoCheck: true,
      });
    } else {
      log('🆕 [codex-query] Starting new thread');
      fileLog.info('Starting new Codex thread');
      thread = codex.startThread({
        sandboxMode: "danger-full-access",
        model: CODEX_MODEL,
        workingDirectory,
        skipGitRepoCheck: true,
      });
    }

    buildLogger.codexQuery.threadStarting();

    // ========================================
    // AUTONOMOUS MULTI-TURN LOOP
    // ========================================
    // Like basic_streaming.ts but with automatic continuation
    // Keep calling runStreamed() on same thread until work complete
    log("🎯 [codex-query] Starting autonomous Codex execution...");

    const MAX_TURNS = 50;
    let turnCount = 0;
    let capturedThreadId: string | null = null;
    let lastTurnText = '';
    let allTodosDone = false;

    while (turnCount < MAX_TURNS) {
      turnCount++;

      // Capture thread ID
      if (!capturedThreadId && thread.id) {
        capturedThreadId = thread.id;
        fileLog.info('Codex thread ID captured:', capturedThreadId);

        // Send thread ID to frontend
        const threadIdEvent = {
          type: "assistant",
          message: {
            id: `codex-thread-${Date.now()}`,
            content: [
              {
                type: "metadata",
                metadata_type: "codex_thread_id",
                thread_id: capturedThreadId,
              }
            ],
          },
        };
        yield threadIdEvent;
        fileLog.info('Thread ID sent to frontend:', capturedThreadId);
      }

      // Determine prompt for this turn
      const turnPrompt = turnCount === 1
        ? combinedPrompt
        : "Continue working on the next step. Call todo-update-tool to track your progress.";

      log(`🚀 [codex-query] Turn ${turnCount}: ${turnCount === 1 ? 'Initial request' : 'Continuing work'}...`);

      // Log full prompt being sent to Codex
      if (turnCount === 1) {
        Sentry.logger.info(
          Sentry.logger.fmt`Full Codex prompt (Turn 1) ${{
            prompt: turnPrompt,
            promptLength: turnPrompt.length,
            promptPreview: turnPrompt.substring(0, 200),
            operation: 'codex_query',
            turnCount: 1,
          }}`
        );

        // Also log to file
        fileLog.info('━━━ FULL CODEX PROMPT ━━━');
        fileLog.info(turnPrompt);
        fileLog.info(`━━━ END PROMPT (${turnPrompt.length} chars) ━━━`);
      } else {
        fileLog.info(`Turn ${turnCount} prompt:`, turnPrompt);
      }

      // Execute turn (like basic_streaming.ts but automated)
      const { events } = await thread.runStreamed(turnPrompt);

      // Stream events from this turn through adapter
      // transformCodexStream expects the full event stream
      let turnHadContent = false;
      for await (const message of transformCodexStream(events)) {
        turnHadContent = true;

        // Track text for completion detection
        if (message.type === 'assistant' && message.message.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text) {
              lastTurnText = block.text.toLowerCase();
            }
          }
        }

        yield message;
      }

      // Check for completion signals
      const hasCompletionSignal = lastTurnText.includes('implementation complete') ||
                                   lastTurnText.includes('build complete') ||
                                   lastTurnText.includes('all steps verified');

      if (hasCompletionSignal) {
        log("✅ [codex-query] Codex signaled completion");
        allTodosDone = true;
        break;
      }

      // Safety: Stop if turn produced no content
      if (!turnHadContent) {
        log("⚠️  [codex-query] Turn produced no content, stopping");
        break;
      }

      // Log turn completion
      fileLog.info(`Turn ${turnCount} complete, checking if more work needed...`);
    }

    buildLogger.codexQuery.sessionComplete(turnCount);
    fileLog.info("━━━ CODEX QUERY COMPLETE ━━━");
    fileLog.info(`Total turns: ${turnCount}`);
  };
}

/**
 * SDK Feature Flags (environment variables)
 * 
 * - USE_OPENCODE_SDK: Imported from opencode-sdk.ts, enables OpenCode multi-provider routing
 * - ENABLE_FACTORY_SDK: Enables Factory Droid SDK for builds
 * 
 * By default (no flags set), only Agent SDK (Claude + Codex) is available.
 */
const ENABLE_FACTORY_SDK = process.env.ENABLE_FACTORY_SDK === 'true';

function createBuildQuery(
  agent: AgentId,
  modelId?: ClaudeModelId | OpenCodeModelId,
  abortController?: AbortController
): BuildQueryFn {
  // When OpenCode SDK is enabled, route ALL requests through it (including Codex)
  if (USE_OPENCODE_SDK) {
    // Map openai-codex agent to the correct OpenCode model
    const normalizedModel = agent === "openai-codex"
      ? "openai/gpt-5.2-codex"
      : modelId ? normalizeModelId(modelId) : DEFAULT_OPENCODE_MODEL_ID;
    
    console.log(`[runner] 🔄 Using OpenCode SDK (multi-provider) - Model: ${normalizedModel}`);
    return createOpenCodeQuery(normalizedModel);
  }

  // Fallback: Direct Codex SDK with thread resumption (when OpenCode is disabled)
  if (agent === "openai-codex") {
    console.log('[runner] 🔄 Using direct Codex SDK (fallback mode)');
    return createCodexQuery();
  }

  // Factory Droid SDK - uses the droid CLI for builds (only if enabled)
  if (agent === "factory-droid") {
    if (!ENABLE_FACTORY_SDK) {
      console.warn('[runner] ⚠️ Factory Droid requested but ENABLE_FACTORY_SDK is not set');
      console.warn('[runner] ⚠️ Falling back to native Claude Agent SDK');
      return createNativeClaudeQuery(DEFAULT_CLAUDE_MODEL_ID, abortController);
    }
    console.log('[runner] 🔄 Using Factory Droid SDK');
    return createDroidQuery(modelId as string);
  }

  // Default: Use native Claude Agent SDK (direct integration)
  console.log('[runner] 🔄 Using NATIVE Claude Agent SDK');
  return createNativeClaudeQuery((modelId as ClaudeModelId) ?? DEFAULT_CLAUDE_MODEL_ID, abortController);
}

/**
 * Retry a fetch call with exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        const delay = 1000 * attempt; // 1s, 2s, 3s
        console.log(
          `   ⏳ Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Cleanup orphaned processes on startup
 */
async function cleanupOrphanedProcesses(
  apiBaseUrl: string,
  runnerSharedSecret: string,
  runnerId: string
) {
  if (!isSilentMode) {
    console.log("🧹 Cleaning up orphaned processes from previous runs...");
  }

  try {
    // Get list of processes from API (filtered by this runner's ID)
    const response = await fetchWithRetry(
      `${apiBaseUrl}/api/runner/process/list?runnerId=${encodeURIComponent(
        runnerId
      )}`,
      {
        headers: {
          Authorization: `Bearer ${runnerSharedSecret}`,
        },
      },
      3
    );

    if (!response.ok) {
      console.error("❌ Failed to fetch process list for cleanup");
      return;
    }

    const { processes } = await response.json();
    if (!isSilentMode) {
      console.log(
        `   Found ${processes.length} processes to check for this runner`
      );
    }

    for (const row of processes) {
      try {
        // Check if process still exists locally (signal 0 = check existence, doesn't kill)
        process.kill(row.pid, 0);
        if (!isSilentMode && DEBUG_BUILD)
          console.log(
            `   ✅ Process ${row.pid} (project ${row.projectId.slice(
              0,
              8
            )}) still running`
          );
      } catch (err) {
        // Process doesn't exist - orphaned, unregister via API
        console.log(
          `   ❌ Orphaned process ${row.pid} (project ${row.projectId.slice(
            0,
            8
          )}), cleaning up`
        );

        await fetchWithRetry(
          `${apiBaseUrl}/api/runner/process/${row.projectId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${runnerSharedSecret}`,
            },
          },
          3
        );
      }
    }

    if (!isSilentMode) {
      if (!isSilentMode && DEBUG_BUILD)
        console.log("✅ Orphaned process cleanup complete");
    }
  } catch (error) {
    console.error("❌ Error during cleanup:", error);
    throw error;
  }
}

/**
 * Start periodic health checks for running processes
 */
function startPeriodicHealthChecks(
  apiBaseUrl: string,
  runnerSharedSecret: string,
  runnerId: string
) {
  if (!isSilentMode) {
    console.log("🏥 Starting periodic port health checks (every 30s)...");
  }

  const doHealthCheck = async () => {
    try {
      // Get list of processes to health check from API (filtered by this runner's ID)
      const response = await fetchWithRetry(
        `${apiBaseUrl}/api/runner/process/list?runnerId=${encodeURIComponent(
          runnerId
        )}`,
        {
          headers: {
            Authorization: `Bearer ${runnerSharedSecret}`,
          },
        },
        3
      );

      if (!response.ok) {
        console.error("❌ Failed to fetch process list for health check");
        return;
      }

      const { processes } = await response.json();

      for (const row of processes) {
        if (!row.port) continue; // Skip if no port detected yet

        // Check port locally (runner can access localhost)
        const isListening = await checkPortInUse(row.port);

        if (!isSilentMode && DEBUG_BUILD)
          console.log(
            `   🔍 Health check for port ${row.port}: ${
              isListening ? "HEALTHY ✅" : "UNHEALTHY ❌"
            }`
          );

        const newFailCount = isListening
          ? 0
          : (row.healthCheckFailCount || 0) + 1;

        if (!isListening && newFailCount >= 3) {
          // Failed 3 times - kill the process locally and report to API
          console.log(
            `   ❌ Port ${
              row.port
            } not in use after 3 checks, killing process for project ${row.projectId.slice(
              0,
              8
            )}`
          );

          // Stop the process if it still exists
          try {
            process.kill(row.pid, "SIGTERM");
            console.log(`      Sent SIGTERM to PID ${row.pid}`);
          } catch (err) {
            // Process already dead
          }
        }

        // Report health status to API
        await fetchWithRetry(
          `${apiBaseUrl}/api/runner/process/${row.projectId}/health`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${runnerSharedSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              port: row.port,
              status: isListening ? "healthy" : "unhealthy",
              failCount: newFailCount,
            }),
          },
          3
        );

        if (!isListening) {
          console.log(
            `   ⚠️  Port ${
              row.port
            } not in use (fail ${newFailCount}/3) for project ${row.projectId.slice(
              0,
              8
            )}`
          );
        }
      }
    } catch (error) {
      console.error("❌ Error during health check:", error);
    }
  };

  // Run health check every 30 seconds
  setInterval(doHealthCheck, 30000);
}

/**
 * Start the runner with the given options
 */
export async function startRunner(options: RunnerOptions = {}) {
  // Set mode flags
  isSilentMode = options.silent || false;
  isVerboseMode = options.verbose || process.env.VERBOSE === '1' || false;
  isTuiMode = options.tuiMode !== false; // Default to true

  // Initialize the unified logger
  const loggerOptions: RunnerLoggerOptions = {
    verbose: isVerboseMode,
    tuiMode: isTuiMode && !isSilentMode,
  };
  const logger = initRunnerLogger(loggerOptions);

  // Enable TUI mode in file-logger to suppress terminal output
  if (isTuiMode && !isSilentMode) {
    setFileLoggerTuiMode(true);
  }

  // Also set silent mode for all modules
  if (isSilentMode) {
    const { setSilentMode: setProcessManagerSilent } = await import(
      "./lib/process-manager.js"
    );
    setProcessManagerSilent(true);

    const { setSilentMode: setPortCheckerSilent } = await import(
      "./lib/port-checker.js"
    );
    setPortCheckerSilent(true);

    // Set silent mode on tunnel manager globally
    tunnelManager.setSilent(true);
  }

  // Note: Port cleanup is handled by the web app, not the runner
  // The runner is stateless and doesn't manage database operations directly

  const WORKSPACE_ROOT = options.workspace || getWorkspaceRoot();
  log("workspace root:", WORKSPACE_ROOT);

  // Railway-aware RUNNER_ID: Prefer explicit config, then Railway replica ID, fallback to hostname
  const RUNNER_ID = options.runnerId ||
    process.env.RUNNER_ID ||
    process.env.RAILWAY_REPLICA_ID ||
    `runner-${os.hostname()}`;
  
  // WebSocket URL for direct connection to Next.js server
  // Supports both new RUNNER_WS_URL and legacy RUNNER_BROKER_URL for backward compatibility
  const WS_URL =
    options.wsUrl ||
    process.env.RUNNER_WS_URL ||
    process.env.RUNNER_BROKER_URL || // Legacy fallback
    "ws://localhost:3000/ws/runner";
  
  const SHARED_SECRET =
    options.sharedSecret || process.env.RUNNER_SHARED_SECRET;
  const HEARTBEAT_INTERVAL_MS = options.heartbeatInterval || 15_000;

  // Get API URL from options, env, or fallback to deriving from WebSocket URL
  const apiBaseUrl =
    options.apiUrl ||
    process.env.API_BASE_URL ||
    (() => {
      // Fallback: derive from WebSocket URL (same host, http/https protocol)
      const wsUrl = new URL(WS_URL);
      const protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
      return `${protocol}//${wsUrl.host}`;
    })();

  // Startup validation - fail fast if required config missing
  const missingConfig: string[] = [];
  if (!SHARED_SECRET) missingConfig.push('RUNNER_SHARED_SECRET');
  if (!WS_URL) missingConfig.push('RUNNER_WS_URL');
  if (!WORKSPACE_ROOT) missingConfig.push('WORKSPACE_ROOT');

  if (missingConfig.length > 0) {
    console.error("❌ Missing required configuration:");
    missingConfig.forEach(cfg => console.error(`   - ${cfg}`));
    process.exit(1);
  }

  const runnerSharedSecret = SHARED_SECRET!; // Guaranteed to be string after validation check

  // Ensure workspace directory exists
  if (!existsSync(WORKSPACE_ROOT)) {
    console.log(`📁 Creating workspace directory: ${WORKSPACE_ROOT}`);
    mkdirSync(WORKSPACE_ROOT, { recursive: true });
  }

  // Set environment variables for process-manager and other modules
  process.env.API_BASE_URL = apiBaseUrl;
  process.env.RUNNER_SHARED_SECRET = runnerSharedSecret;
  process.env.RUNNER_ID = RUNNER_ID;

  // Log startup configuration using the unified logger
  logger.header({
    runnerId: RUNNER_ID,
    serverUrl: WS_URL,
    workspace: WORKSPACE_ROOT,
    apiUrl: apiBaseUrl,
  });

  debugLog("api base url:", apiBaseUrl);
  debugLog("runner id:", RUNNER_ID);
  debugLog("workspace root:", WORKSPACE_ROOT);

  // Start HTTP health endpoint for Railway health checks
  const isServiceMode = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
  let healthServer: Server | null = null;

  if (isServiceMode) {
    const healthApp = express();
    const healthPort = process.env.HEALTH_PORT || 8080;

    healthApp.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        runner: {
          id: RUNNER_ID,
          connected: socket?.readyState === WebSocket.OPEN,
          workspace: WORKSPACE_ROOT,
          workspaceExists: existsSync(WORKSPACE_ROOT),
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    });

    healthApp.get('/ready', (req, res) => {
      const isReady = socket?.readyState === WebSocket.OPEN && existsSync(WORKSPACE_ROOT);
      res.status(isReady ? 200 : 503).json({
        ready: isReady,
        runnerId: RUNNER_ID,
      });
    });

    const portNumber = typeof healthPort === 'string' ? parseInt(healthPort, 10) : healthPort;
    healthServer = healthApp.listen(portNumber, () => {
      console.log(`✅ Health endpoint listening on port ${portNumber}`);
    });
  }

  // Cleanup orphaned processes on startup
  cleanupOrphanedProcesses(apiBaseUrl, runnerSharedSecret, RUNNER_ID).catch(
    (err) => {
      console.error("❌ Failed to cleanup orphaned processes on startup:", err);
    }
  );

  // Start periodic health checks
  startPeriodicHealthChecks(apiBaseUrl, runnerSharedSecret, RUNNER_ID);

  let socket: WebSocket | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let loggedFirstChunk = false;
  let reconnectAttempts = 0;
  let isShuttingDown = false; // Prevent reconnection during shutdown
  const MAX_RECONNECT_DELAY = 30000; // 30 seconds max
  const MAX_RECONNECT_ATTEMPTS = 50; // ~30 minutes of reconnection attempts
  const PING_INTERVAL = 30000; // Ping every 30 seconds
  const PONG_TIMEOUT = 45000; // 45 seconds (1.5x ping interval)
  const CONNECTION_HANDSHAKE_TIMEOUT = 10000; // 10 second connection timeout
  const COMMAND_RECEIVE_TIMEOUT = 1800000; // 30 minutes - force reconnect if no commands received (was 5 min, too aggressive for idle sessions)
  const INITIAL_CONNECTION_DELAY = 5000; // Wait 5 seconds before first connection (allows server to start)
  const SUPPRESS_ERRORS_UNTIL_ATTEMPT = 3; // Don't log ECONNREFUSED for first N attempts (expected during startup)
  let lastPongReceived = Date.now();
  let lastCommandReceived = Date.now(); // BUG FIX: Track when we last received a command

  // ============================================================
  // HTTP PERSISTENCE FOR PROPER DISTRIBUTED TRACE CONTEXT
  // DB writes now go via HTTP to ensure traces are properly linked
  // ============================================================

  interface BuildContext {
    commandId: string;
    sessionId: string;
    projectId: string;
    buildId: string;
    agentId: string;
    claudeModelId?: string;
    // For auto-start dev server after build
    projectDirectory?: string;
    projectSlug?: string;
    detectedFramework?: string;
    // For cancellation support
    abortController?: AbortController;
  }

  const activeBuildContexts = new Map<string, BuildContext>();

  /**
   * Direct persistence for special events (TodoWrite, start)
   * These bypass the buffer and go directly to the original endpoint.
   * Includes Sentry trace headers for distributed tracing.
   */
  /**
   * Helper function to retry HTTP requests
   */
  async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 1
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Retry on 5xx errors
        if (!response.ok && response.status >= 500 && attempt < maxRetries) {
          console.warn(`[runner] Persist failed (${response.status}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          console.warn(`[runner] Persist error, retrying:`, error);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    throw lastError || new Error('Persistence failed after retries');
  }

  async function persistBuildEventDirect(
    context: BuildContext,
    event: Record<string, unknown>
  ): Promise<void> {
    return Sentry.startSpan(
      {
        name: `persist.build-event.${event.type}`,
        op: 'http.client',
        attributes: {
          'http.method': 'POST',
          'http.url': `${apiBaseUrl}/api/build-events`,
          'event.type': event.type as string,
          'event.tool_name': event.toolName as string || undefined,
        },
      },
      async () => {
        // Get trace context for propagation
        const traceData = Sentry.getTraceData();
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${runnerSharedSecret}`,
          'Content-Type': 'application/json',
        };

        // Add Sentry trace headers for distributed tracing
        if (traceData['sentry-trace']) {
          headers['sentry-trace'] = traceData['sentry-trace'];
        }
        if (traceData.baggage) {
          headers['baggage'] = traceData.baggage;
        }

        const response = await fetchWithRetry(
          `${apiBaseUrl}/api/build-events`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              commandId: context.commandId,
              sessionId: context.sessionId,
              projectId: context.projectId,
              buildId: context.buildId,
              agentId: context.agentId,
              claudeModelId: context.claudeModelId,
              event,
            }),
          },
          1 // Max 1 retry
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
    );
  }

  /**
   * Send a build event to the HTTP persistence endpoint.
   * This ensures DB writes are properly linked in distributed traces.
   *
   * SIMPLIFIED: Only persists meaningful events:
   * - start: Session status update
   * - tool-input-available: Tool calls and TodoWrite
   * - tool-output-available: Tool completion
   *
   * SKIPPED (no DB persistence needed):
   * - text-delta: Streaming text (handled via WebSocket for UI only)
   * - reasoning/data-reasoning: Claude's thinking (not persisted)
   * - finish: Message completion (no longer needed)
   */
  // Track event counts for debugging
  const eventCounts = new Map<string, number>();

  // Track which sessions have had their start event sent to avoid duplicates
  const startedSessions = new Set<string>();

  async function persistBuildEvent(
    context: BuildContext,
    event: Record<string, unknown>
  ): Promise<void> {
    const eventType = event.type as string;

    // SKIPPED EVENTS - don't send to server at all
    // These are handled via WebSocket for real-time UI, no DB persistence needed
    const SKIPPED_EVENTS = [
      'text-delta',           // Streaming text (UI only via WebSocket)
      'reasoning',            // Claude's thinking (UI only)
      'data-reasoning',       // Structured reasoning (UI only)
      'finish',               // Message completion marker (not needed)
      'text-start',           // Text block start (UI only)
      'text-end',             // Text block end (UI only)
      'tool-input-start',     // Tool streaming start (UI only)
      'tool-input-delta',     // Tool streaming chunks (UI only)
      'tool-input-end',       // Tool streaming end (UI only)
    ];

    if (SKIPPED_EVENTS.includes(eventType)) {
      return; // Skip entirely - no network call
    }

    // Skip duplicate 'start' events - only send the first one per session
    if (eventType === 'start') {
      if (startedSessions.has(context.sessionId)) {
        // Silently skip - this is expected and not worth logging
        return;
      }
      debugLog(`Sending first start event for session=${context.sessionId}`);
      startedSessions.add(context.sessionId);
    }

    // Track event counts
    const count = eventCounts.get(eventType || 'undefined') || 0;
    eventCounts.set(eventType || 'undefined', count + 1);

    // All non-skipped events sent immediately to /api/build-events
    // ONLY persist these build events:
    // - start: Build session begins (first one only)
    // - tool-input-available: Tool calls (including TodoWrite for todos)
    // - tool-output-available: Tool completions
    // - tool-error: Tool errors
    try {
      await persistBuildEventDirect(context, event);
    } catch (error) {
      console.error(`[runner] ⚠️  Failed to persist ${eventType} event:`, error);
      // Don't throw - persistence failure shouldn't crash the build
    }
  }

  function printEventSummary() {
    console.log('\n[runner] 📊 Event Persistence Summary:');
    let total = 0;
    for (const [eventType, count] of eventCounts.entries()) {
      console.log(`  ${eventType}: ${count}`);
      total += count;
    }
    console.log(`  TOTAL HTTP CALLS: ${total}\n`);
    eventCounts.clear();
  }

  /**
   * Send a runner lifecycle event to the HTTP persistence endpoint.
   */
  async function persistRunnerEvent(
    event: Record<string, unknown>
  ): Promise<void> {
    // Wrap in Sentry span to create proper trace hierarchy
    return Sentry.startSpan(
      {
        name: `persist.runner-event.${event.type}`,
        op: 'http.client',
        attributes: {
          'http.method': 'POST',
          'http.url': `${apiBaseUrl}/api/runner/events`,
          'event.type': event.type as string,
        },
      },
      async () => {
        try {
          const response = await fetch(`${apiBaseUrl}/api/runner/events`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${runnerSharedSecret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
          });

          if (!response.ok) {
            console.error(`[runner] Failed to persist runner event: ${response.status}`);
          }
        } catch (error) {
          console.error('[runner] Error persisting runner event:', error);
          throw error; // Re-throw so Sentry span records the error
        }
      }
    );
  }

  // Event types that trigger DB writes and should be persisted via HTTP
  const DB_WORTHY_RUNNER_EVENTS = [
    'project-metadata',
    'build-completed',
    'build-summary',
    'build-failed',
    'tunnel-created',
    'tunnel-closed',
    'port-conflict',
    'process-exited',
    'error',
    'ack',
  ];


  // ============================================================

  function assertNever(value: never): never {
    throw new Error(`Unhandled runner command: ${JSON.stringify(value)}`);
  }

  function sendEvent(event: RunnerEvent) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      log(
        `[runner] Cannot send event ${event.type}: WebSocket not connected (state: ${socket?.readyState})`
      );
      return;
    }
    

    const sendOperation = () => {
      try {
        // Attach trace context to ALL events for distributed tracing
        // This allows events to be linked back to the originating frontend request
        const span = Sentry.getActiveSpan();
        if (span) {
          const traceData = Sentry.getTraceData();
          event._sentry = {
            trace: traceData['sentry-trace'],
            baggage: traceData.baggage,
          };
        }

        const eventJson = JSON.stringify(event);

        // Only log important events
        if (event.type === "error") {
          log(`❌ Error: ${event.error}`);
          if (event.stack) {
            log(`Stack: ${event.stack.substring(0, 500)}`);
          }
        } else if (event.type === "port-detected") {
          log(`🔌 Port detected: ${event.port}`);
        } else if (event.type === "tunnel-created") {
          log(`🔗 Tunnel created: ${event.tunnelUrl} -> localhost:${event.port}`);
        } else if (event.type === "build-completed") {
          log(`✅ Build completed for project: ${event.projectId}`);
        } else if (event.type === "build-failed") {
          log(`❌ Build failed: ${event.error}`);
          // Debug: log stack trace to see where this was triggered from
          process.stderr.write(`[runner] BUILD-FAILED triggered. Error: ${event.error}\n`);
          process.stderr.write(`[runner] Stack trace at send time:\n${new Error().stack}\n`);
        }
        // Suppress: build-stream, runner-status, ack, etc.

        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(eventJson);
        }
      } catch (error) {
        log(`❌ Failed to send event ${event.type}:`, error);
      }
    };

    // REMOVED: Manual Sentry span creation - rely on automatic instrumentation
    sendOperation();

    // ALSO persist DB-worthy events via HTTP for proper trace linking
    if (DB_WORTHY_RUNNER_EVENTS.includes(event.type) && event.projectId) {
      // Get session ID from active build context if available
      const context = event.commandId ? activeBuildContexts.get(event.commandId) : null;
      
      const eventPayload: Record<string, unknown> = {
        type: event.type,
        projectId: event.projectId,
        commandId: event.commandId,
        sessionId: (event as { sessionId?: string }).sessionId ?? context?.sessionId,
      };
      
      // Include event-specific fields
      if ('payload' in event) eventPayload.payload = event.payload;
      if ('tunnelUrl' in event) eventPayload.tunnelUrl = event.tunnelUrl;
      if ('port' in event) eventPayload.port = event.port;
      if ('exitCode' in event) eventPayload.exitCode = event.exitCode;
      if ('signal' in event) eventPayload.signal = event.signal;
      if ('error' in event) eventPayload.error = event.error;
      if ('message' in event) eventPayload.message = event.message;
      if ('failureReason' in event) eventPayload.failureReason = event.failureReason;
      if ('stderr' in event) eventPayload.stderr = event.stderr;
      
      // Fire and forget - don't await to avoid blocking
      persistRunnerEvent(eventPayload);
    }
  }

  function buildEventBase(projectId?: string, commandId?: string) {
    return {
      projectId,
      commandId,
      timestamp: new Date().toISOString(),
    } as const;
  }

  async function handleCommand(command: RunnerCommand) {
    // Handle analyze-project specially - no projectId yet
    if (command.type === 'analyze-project') {
      debugLog(`Received command: analyze-project`);
      debugLog(`Command ID: ${command.id}`);
      debugLog(`Timestamp: ${command.timestamp}`);
      
      // Send ack without projectId
      sendEvent({
        type: "ack",
        commandId: command.id,
        timestamp: new Date().toISOString(),
        message: `Command analyze-project accepted`,
      });
      
      // Handle the analyze-project command
      try {
        log('🔍 Starting project analysis...');
        await analyzeProject(
          {
            prompt: command.payload.prompt,
            agent: command.payload.agent,
            claudeModel: command.payload.claudeModel,
            tags: command.payload.tags,
          },
          sendEvent,
          command.id
        );
        log('✅ Project analysis complete');
      } catch (error) {
        log('❌ Project analysis failed:', error);
        sendEvent({
          type: 'error',
          commandId: command.id,
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Analysis failed',
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      return;
    }

    // All other commands have projectId
    const projectId = command.projectId;
    
    // Log command receipt - only verbose details in debug mode
    debugLog(`Received command: ${command.type} for project: ${projectId}`);
    debugLog(`Command ID: ${command.id}`);
    debugLog(`Timestamp: ${command.timestamp}`);

    // Log command-specific details (verbose only)
    if (command.type === "start-build") {
      debugLog(`Build operation: ${command.payload.operationType}`);
      debugLog(`Project slug: ${command.payload.projectSlug}`);
      debugLog(`Prompt length: ${command.payload.prompt?.length || 0} chars`);
    } else if (command.type === "start-dev-server") {
      logger.devServer({ port: command.payload.preferredPort || 3000, status: 'starting' });
      debugLog(`Working directory: ${command.payload.workingDirectory}`);
      debugLog(`Run command: ${command.payload.runCommand}`);
    } else if (
      command.type === "start-tunnel" ||
      command.type === "stop-tunnel"
    ) {
      debugLog(`Port: ${command.payload.port}`);
    }

    sendEvent({
      type: "ack",
      ...buildEventBase(projectId, command.id),
      message: `Command ${command.type} accepted`,
    });

    switch (command.type) {
      case "runner-health-check": {
        publishStatus(command.projectId, command.id);
        break;
      }
      case "start-dev-server": {
        try {
          const {
            runCommand: runCmd,
            workingDirectory,
            env = {},
            preferredPort,
          } = command.payload;

          // Port is pre-allocated in the database by the API route
          // We use the port from the payload (which includes env vars with PORT set)
          const allocatedPort = preferredPort ?? null;
          
          // Track the final port to use (may be reallocated if original is in use)
          let finalPort: number | null = allocatedPort;
          
          if (allocatedPort) {
            log(`🔌 Using pre-allocated port ${allocatedPort} for project ${command.projectId}`);

            // IMPORTANT: First, stop any existing process for this project
            // This handles the case where the UI was reset but the process is still running
            log(`🧹 Stopping any existing process for project ${command.projectId}...`);
            const { stopDevServer } = await import('./lib/process-manager.js');
            const wasStopped = await stopDevServer(command.projectId, {
              tunnelManager,
              reason: 'restart',
              port: allocatedPort,
            });
            
            if (wasStopped) {
              log(`✅ Stopped existing process for project ${command.projectId}`);
              // Wait a bit for the port to be released by the OS
              await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Now check if port is in use (might be another unrelated process)
            const portInUse = await checkPortInUse(allocatedPort);
            if (portInUse) {
              log(`⚠️  Port ${allocatedPort} is in use, searching for available port...`);
              
              // Find an available port starting from the allocated port
              const availablePort = await findAvailablePort(allocatedPort);
              
              if (!availablePort) {
                const conflictMessage = `Port ${allocatedPort} is in use and no available port found in range ${allocatedPort}-${allocatedPort + 99}`;
                log(`❌ ${conflictMessage}`);

                sendEvent({
                  type: "port-conflict",
                  ...buildEventBase(command.projectId, command.id),
                  port: allocatedPort,
                  message: conflictMessage,
                });

                sendEvent({
                  type: "error",
                  ...buildEventBase(command.projectId, command.id),
                  error: conflictMessage,
                });

                return;
              }
              
              // Use the available port instead
              log(`✅ Found available port ${availablePort} (originally tried ${allocatedPort})`);
              finalPort = availablePort;
              
              // Notify frontend about the port change so it can update the database
              sendEvent({
                type: "port-reallocated",
                ...buildEventBase(command.projectId, command.id),
                originalPort: allocatedPort,
                newPort: availablePort,
                message: `Port ${allocatedPort} was in use, using ${availablePort} instead`,
              });
            }
          } else {
            // No pre-allocated port - we need to find one
            log(`⚠️  No port pre-allocated, searching for available port...`);
            const availablePort = await findAvailablePort(3000); // Start from common dev port
            
            if (!availablePort) {
              const conflictMessage = `No available port found in range 3000-3099`;
              log(`❌ ${conflictMessage}`);

              sendEvent({
                type: "error",
                ...buildEventBase(command.projectId, command.id),
                error: conflictMessage,
              });

              return;
            }
            
            log(`✅ Found available port ${availablePort}`);
            finalPort = availablePort;
          }

          // Merge port enforcement environment variables
          const envVars: Record<string, string> = {};
          for (const [key, value] of Object.entries({
            ...process.env,
            ...env,
          })) {
            if (value !== undefined) {
              envVars[key] = String(value);
            }
          }

          const startTime = Date.now();

          // Use async version with port availability check
          const devProcess = await startDevServerAsync({
            projectId: command.projectId,
            command: runCmd,
            cwd: workingDirectory,
            env: envVars,
            port: finalPort ?? undefined,
          });

          // Track errors for potential auto-fix
          let errorBuffer: string[] = [];
          let lastErrorTime = 0;
          let serverStarted = false;
          const ERROR_DEBOUNCE_MS = 3000; // Wait 3s after last error before triggering fix
          const ERROR_COOLDOWN_MS = 10000; // Don't report errors in first 10s (startup noise)
          const serverStartTimestamp = Date.now();

          // Error patterns that indicate real problems (not just warnings or info)
          const REAL_ERROR_PATTERNS = [
            /Error: Cannot find module/i,
            /Module not found/i,
            /SyntaxError:/i,
            /TypeError:/i,
            /ReferenceError:/i,
            /failed to compile/i,
            /Build error occurred/i,
            /Unhandled Runtime Error/i,
            /ENOENT:/i,
            /EACCES:/i,
          ];

          // Patterns to ignore (common in dev server output but not errors)
          const IGNORE_PATTERNS = [
            /Compiling/i,
            /compiled.*successfully/i,
            /Fast Refresh/i,
            /waiting.*changes/i,
            /ready.*http/i,
            /warn.*experimental/i,
          ];

          // Forward logs to API
          devProcess.emitter.on("log", (logEvent) => {
            sendEvent({
              type: "log-chunk",
              ...buildEventBase(command.projectId, command.id),
              stream: logEvent.type,
              data: logEvent.data,
              cursor: randomUUID(),
            });

            // Track when server has successfully started
            if (/ready|compiled.*successfully|listening/i.test(logEvent.data)) {
              serverStarted = true;
            }

            // Only check for errors after cooldown period and if server started
            const timeSinceStart = Date.now() - serverStartTimestamp;
            if (timeSinceStart < ERROR_COOLDOWN_MS) {
              return; // Skip error detection during startup
            }

            // Check if this is a real error (not just stderr or warning)
            const shouldIgnore = IGNORE_PATTERNS.some(pattern => pattern.test(logEvent.data));
            if (shouldIgnore) {
              return;
            }

            const isRealError = REAL_ERROR_PATTERNS.some(pattern => pattern.test(logEvent.data));
            if (isRealError && logEvent.data.trim().length > 10) {
              errorBuffer.push(logEvent.data);
              lastErrorTime = Date.now();

              // Debounce: wait for errors to settle, then send for auto-fix
              setTimeout(() => {
                if (Date.now() - lastErrorTime >= ERROR_DEBOUNCE_MS && errorBuffer.length > 0) {
                  const collectedErrors = errorBuffer.join('\n');
                  errorBuffer = []; // Reset buffer

                  log(`🔧 Real dev server error detected, sending for auto-fix...`);
                  sendEvent({
                    type: "dev-server-error",
                    ...buildEventBase(command.projectId, command.id),
                    error: collectedErrors,
                    message: "Dev server error detected - auto-fix triggered",
                  } as RunnerEvent);
                }
              }, ERROR_DEBOUNCE_MS + 100);
            }
          });

          // Handle process exit
          devProcess.emitter.on("exit", async ({ code, signal, state, failureReason, stderr }) => {
            // Close tunnel if one exists for this port
            if (allocatedPort) {
              log(`🔗 Closing tunnel for port ${allocatedPort}`);
              await tunnelManager.closeTunnel(allocatedPort);
            }

            sendEvent({
              type: "process-exited",
              ...buildEventBase(command.projectId, command.id),
              exitCode: code ?? null,
              signal: signal ?? null,
              durationMs: Date.now() - startTime,
              state,
              failureReason,
              stderr, // Pass stderr for immediate crashes to enable auto-fix
            });
          });

          // Handle process errors
          devProcess.emitter.on("error", (error: unknown) => {
            sendEvent({
              type: "error",
              ...buildEventBase(command.projectId, command.id),
              error:
                error instanceof Error ? error.message : "Unknown runner error",
              stack: error instanceof Error ? error.stack : undefined,
            });
          });

          // Run health check if port is allocated
          if (allocatedPort) {
            log(`🔍 Running health check for port ${allocatedPort}...`);
            
            const { runHealthCheck, startDevServerAsync } = await import('./lib/process-manager.js');
            const healthResult = await runHealthCheck(command.projectId, allocatedPort);
            
            if (healthResult.healthy) {
              log(`✅ Dev server started and healthy for project ${command.projectId} on port ${allocatedPort}`);
              
              sendEvent({
                type: "ack",
                ...buildEventBase(command.projectId, command.id),
                message: `Dev server is running and healthy on port ${allocatedPort}`,
              });
            } else if (healthResult.portFixed) {
              // Port was fixed in package.json - wait for process to exit, then retry
              log(`🔧 Port configuration fixed, waiting for process cleanup before retry...`);
              
              // Send a status update that we're fixing and retrying (keeps status as 'starting')
              sendEvent({
                type: "ack",
                ...buildEventBase(command.projectId, command.id),
                message: `Port configuration fixed, cleaning up and retrying...`,
              });
              
              // Wait 3 seconds for the process to fully exit and cleanup
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              log(`🔄 Retrying dev server start with fixed port configuration...`);
              
              // Send another status update for retry
              sendEvent({
                type: "ack",
                ...buildEventBase(command.projectId, command.id),
                message: `Retrying server start with corrected port configuration...`,
              });
              
              // Retry starting the dev server with port check
              const retryProcess = await startDevServerAsync({
                projectId: command.projectId,
                command: command.payload.runCommand,
                cwd: command.payload.workingDirectory,
                env: command.payload.env || {},
                port: allocatedPort,
              });

              // Set up event handlers for the retry
              retryProcess.emitter.on("log", ({ type, data }) => {
                sendEvent({
                  type: "log-chunk",
                  ...buildEventBase(command.projectId, command.id),
                  data,
                  stream: type,
                } as RunnerEvent);
              });

              retryProcess.emitter.on("exit", async ({ code, signal, state, failureReason }) => {
                if (allocatedPort) {
                  log(`🔗 Closing tunnel for port ${allocatedPort}`);
                  await tunnelManager.closeTunnel(allocatedPort);
                }

                sendEvent({
                  type: "process-exited",
                  ...buildEventBase(command.projectId, command.id),
                  exitCode: code ?? null,
                  signal: signal ?? null,
                  durationMs: Date.now() - startTime,
                  state,
                  failureReason,
                });
              });

              retryProcess.emitter.on("error", (error: unknown) => {
                sendEvent({
                  type: "error",
                  ...buildEventBase(command.projectId, command.id),
                  error: error instanceof Error ? error.message : "Unknown runner error",
                  stack: error instanceof Error ? error.stack : undefined,
                });
              });

              // Run health check on the retry
              log(`🔍 Running health check for retry on port ${allocatedPort}...`);
              const retryHealthResult = await runHealthCheck(command.projectId, allocatedPort);
              
              if (retryHealthResult.healthy) {
                log(`✅ Dev server retry successful and healthy on port ${allocatedPort}`);
                sendEvent({
                  type: "ack",
                  ...buildEventBase(command.projectId, command.id),
                  message: `Dev server is running and healthy on port ${allocatedPort}`,
                });
              } else {
                log(`❌ Dev server retry failed: ${retryHealthResult.error}`);
                sendEvent({
                  type: "error",
                  ...buildEventBase(command.projectId, command.id),
                  error: `Health check failed after port fix: ${retryHealthResult.error}`,
                });
              }
            } else {
              log(`⚠️  Dev server started but health check failed: ${healthResult.error}`);
              
              sendEvent({
                type: "error",
                ...buildEventBase(command.projectId, command.id),
                error: `Health check failed: ${healthResult.error}`,
              });
            }
          } else {
            // No port allocated - just log spawn
            log(`✅ Dev server process spawned for project ${command.projectId}`);
          }

        } catch (error) {
          console.error("Failed to start dev server", error);
          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error:
              error instanceof Error
                ? error.message
                : "Failed to start dev server",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        break;
      }
      case "stop-dev-server": {
        try {
          const stopped = await stopDevServer(command.projectId, {
            tunnelManager,
            reason: 'manual'
          });
          
          if (!stopped) {
            sendEvent({
              type: "error",
              ...buildEventBase(command.projectId, command.id),
              error: "No running dev server found for project",
            });
          } else {
            // Successfully stopped - send ack
            sendEvent({
              type: "ack",
              ...buildEventBase(command.projectId, command.id),
              message: "Dev server stopped successfully",
            });
          }
        } catch (error) {
          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error: error instanceof Error ? error.message : "Failed to stop dev server",
          });
        }
        break;
      }
      case "start-tunnel": {
        const tunnelStartTime = Date.now();
        try {
          const { port } = command.payload;
          log(`🔗 Starting tunnel for port ${port}...`);

          // Wait for the port to be ready before creating tunnel
          log(`⏳ Waiting for port ${port} to be ready...`);
          const isReady = await waitForPort(port, 15, 1000); // 15 retries, 1s apart = max 15s

          if (!isReady) {
            throw new Error(`Port ${port} is not ready or not accessible`);
          }

          // Ensure tunnel manager is in silent mode
          tunnelManager.setSilent(isSilentMode);

          // Create tunnel
          const tunnelUrl = await tunnelManager.createTunnel(port);
          logger.tunnel({ port, url: tunnelUrl, status: 'created' });

          // Instrument tunnel startup timing
          const tunnelDuration = Date.now() - tunnelStartTime;

          Sentry.metrics.distribution('tunnel_startup_duration', tunnelDuration, {
            unit: 'millisecond',
            attributes: {
              port: port.toString(),
              success: 'true'
            }
          });

          sendEvent({
            type: "tunnel-created",
            ...buildEventBase(command.projectId, command.id),
            port,
            tunnelUrl,
          });
        } catch (error) {
          console.error("Failed to create tunnel:", error);

          // Instrument failed tunnel startup timing
          const tunnelDuration = Date.now() - tunnelStartTime;
          Sentry.metrics.distribution('tunnel_startup_duration', tunnelDuration, {
            unit: 'millisecond',
            attributes: {
              port: command.payload.port.toString(),
              success: 'false',
              error_type: error instanceof Error ? error.constructor.name : 'unknown'
            }
          });

          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error:
              error instanceof Error
                ? error.message
                : "Failed to create tunnel",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        break;
      }
      case "stop-tunnel": {
        try {
          const { port } = command.payload;
          debugLog(`Stopping tunnel for port ${port}...`);

          // Ensure tunnel manager is in silent mode
          tunnelManager.setSilent(isSilentMode);

          await tunnelManager.closeTunnel(port);
          logger.tunnel({ port, status: 'closed' });

          sendEvent({
            type: "tunnel-closed",
            ...buildEventBase(command.projectId, command.id),
            port,
          });
        } catch (error) {
          console.error("Failed to close tunnel:", error);
          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error:
              error instanceof Error ? error.message : "Failed to close tunnel",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        break;
      }
      case "fetch-logs": {
        log("fetch-logs not yet implemented");
        sendEvent({
          type: "error",
          ...buildEventBase(command.projectId, command.id),
          error: "fetch-logs not yet implemented in prototype",
        });
        break;
      }
      case "delete-project-files": {
        try {
          const { slug } = command.payload;
          const projectPath = join(WORKSPACE_ROOT, slug);

          console.log(`[runner] 🗑️  Deleting project files for slug: ${slug}`);
          console.log(`[runner]   Path: ${projectPath}`);

          // First, stop any running dev server for this project to release file locks
          const wasStopped = await stopDevServer(command.projectId, {
            tunnelManager,
            reason: 'deletion'
          });
          if (wasStopped) {
            console.log(`[runner]   Stopped dev server before deletion`);
            // Wait a bit for processes to fully exit and release file locks
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          // Use multiple strategies for robust deletion
          const { spawn } = await import("child_process");

          // Strategy 1: Try using /bin/rm -rf with full path to rm binary
          try {
            await new Promise<void>((resolve, reject) => {
              const proc = spawn("/bin/rm", ["-rf", projectPath], {
                stdio: "pipe",
              });

              let stderr = "";
              proc.stderr?.on("data", (data) => {
                stderr += data.toString();
              });

              proc.on("exit", (code) => {
                if (code === 0) {
                  resolve();
                } else {
                  reject(new Error(`rm exited with code ${code}: ${stderr}`));
                }
              });

              proc.on("error", reject);
            });

            console.log(
              `[runner] ✅ Successfully deleted project files: ${projectPath}`
            );
          } catch (rmError) {
            log(`[runner] ⚠️  rm -rf failed, trying fs.rm with maxRetries...`);
            log(
              `[runner]   Error:`,
              rmError instanceof Error ? rmError.message : String(rmError)
            );

            // Strategy 2: Fall back to fs.rm with maxRetries option
            const { rm } = await import("node:fs/promises");
            await rm(projectPath, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 500,
            });

            console.log(
              `[runner] ✅ Successfully deleted project files with fs.rm`
            );
          }

          sendEvent({
            type: "files-deleted",
            ...buildEventBase(command.projectId, command.id),
            slug,
          });
        } catch (error) {
          console.error("[runner] ❌ Failed to delete project files:", error);
          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error:
              error instanceof Error
                ? error.message
                : "Failed to delete project files",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        break;
      }
      case "read-file": {
        try {
          const { slug, filePath } = command.payload;
          const projectPath = join(WORKSPACE_ROOT, slug);
          const fullPath = join(projectPath, filePath);

          console.log(
            `[runner] 📖 Reading file: ${filePath} from project: ${slug}`
          );

          // Security: Ensure path is within project directory
          if (!fullPath.startsWith(projectPath)) {
            throw new Error("Invalid file path - outside project directory");
          }

          const { readFile, stat } = await import("node:fs/promises");
          const stats = await stat(fullPath);
          const content = await readFile(fullPath, "utf-8");

          console.log(
            `[runner] ✅ File read successfully (${stats.size} bytes)`
          );

          sendEvent({
            type: "file-content",
            ...buildEventBase(command.projectId, command.id),
            slug,
            filePath,
            content,
            size: stats.size,
          });
        } catch (error) {
          console.error("[runner] ❌ Failed to read file:", error);
          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error:
              error instanceof Error ? error.message : "Failed to read file",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        break;
      }
      case "write-file": {
        try {
          const { slug, filePath, content } = command.payload;
          const projectPath = join(WORKSPACE_ROOT, slug);
          const fullPath = join(projectPath, filePath);

          console.log(
            `[runner] 💾 Writing file: ${filePath} to project: ${slug}`
          );

          // Security: Ensure path is within project directory
          if (!fullPath.startsWith(projectPath)) {
            throw new Error("Invalid file path - outside project directory");
          }

          const { writeFile } = await import("node:fs/promises");
          await writeFile(fullPath, content, "utf-8");

          console.log(
            `[runner] ✅ File written successfully (${content.length} bytes)`
          );

          sendEvent({
            type: "file-written",
            ...buildEventBase(command.projectId, command.id),
            slug,
            filePath,
          });
        } catch (error) {
          console.error("[runner] ❌ Failed to write file:", error);
          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error:
              error instanceof Error ? error.message : "Failed to write file",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        break;
      }
      case "list-files": {
        try {
          const { slug, path: subPath } = command.payload;
          const projectPath = join(WORKSPACE_ROOT, slug);
          const targetPath = subPath ? join(projectPath, subPath) : projectPath;

          console.log(`[runner] 📁 Listing files for project: ${slug}`);
          console.log(`[runner]   Path: ${targetPath}`);

          // Security: Ensure path is within project directory
          if (!targetPath.startsWith(projectPath)) {
            throw new Error("Invalid path - outside project directory");
          }

          const { readdir, stat } = await import("node:fs/promises");
          const entries = await readdir(targetPath);

          const files = await Promise.all(
            entries.map(async (name) => {
              const entryPath = join(targetPath, name);
              const relativePath = subPath ? join(subPath, name) : name;
              const stats = await stat(entryPath);

              return {
                name,
                type: stats.isDirectory()
                  ? ("directory" as const)
                  : ("file" as const),
                path: relativePath,
                size: stats.isFile() ? stats.size : undefined,
              };
            })
          );

          if (!isSilentMode && DEBUG_BUILD)
            console.log(`[runner] ✅ Found ${files.length} entries`);

          sendEvent({
            type: "file-list",
            ...buildEventBase(command.projectId, command.id),
            slug,
            files,
          });
        } catch (error) {
          console.error("[runner] ❌ Failed to list files:", error);
          sendEvent({
            type: "error",
            ...buildEventBase(command.projectId, command.id),
            error:
              error instanceof Error ? error.message : "Failed to list files",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        break;
      }
      case "start-build": {
        // Use unified logger for build received
        const agent = (command.payload?.agent as string) || DEFAULT_AGENT;
        const claudeModelFromPayload = command.payload?.claudeModel;
        const model = agent === 'claude-code' && 
          (claudeModelFromPayload === 'claude-haiku-4-5' || 
           claudeModelFromPayload === 'claude-sonnet-4-5' || 
           claudeModelFromPayload === 'claude-opus-4-5')
          ? claudeModelFromPayload
          : DEFAULT_CLAUDE_MODEL_ID;

        logger.buildReceived({
          commandId: command.id,
          projectId: command.projectId,
          projectSlug: command.payload?.projectSlug || command.projectId,
          projectName: command.payload?.projectName,
          prompt: command.payload?.prompt || '',
          operation: command.payload?.operationType || 'initial-build',
          agent,
          model,
        });

        fileLog.info("━━━ START-BUILD COMMAND RECEIVED ━━━");
        fileLog.info("Project ID:", command.projectId);
        fileLog.info("Command ID:", command.id);
        fileLog.info("Prompt:", command.payload?.prompt);
        fileLog.info("Operation:", command.payload?.operationType);
        fileLog.info("Agent:", command.payload?.agent);
        fileLog.info("Template:", command.payload?.template);

        // REMOVED: Manual Sentry span creation - rely on automatic instrumentation
        // await Sentry.startSpan({ name: "runner.build", op: "ai.build", ... }, async () => {
        // Build operation (previously wrapped in Sentry span)
        try {
          loggedFirstChunk = false;
          if (!command.payload?.prompt || !command.payload?.operationType) {
            throw new Error("Invalid build payload");
          }

          // Calculate the project directory using slug
          const projectSlug =
            command.payload.projectSlug || command.projectId;
          const projectName = command.payload.projectName || projectSlug;
          const projectDirectory = resolve(WORKSPACE_ROOT, projectSlug);

          log("project directory:", projectDirectory);
          log("project slug:", projectSlug);
          log("project name:", projectName);

          // Determine agent to use for this build
          const agent =
            (command.payload.agent as AgentId | undefined) ?? DEFAULT_AGENT;
          const agentLabel = agent === "openai-codex" ? "Codex" : (agent === "factory-droid" ? "Droid" : "Claude");
          log("selected agent:", agent);
          const claudeModel: ClaudeModelId =
            agent === "claude-code" &&
            (command.payload.claudeModel === "claude-haiku-4-5" ||
              command.payload.claudeModel === "claude-sonnet-4-5" ||
              command.payload.claudeModel === "claude-opus-4-5")
              ? command.payload.claudeModel
              : DEFAULT_CLAUDE_MODEL_ID;
          
          // For factory-droid, use the droidModel from payload
          const droidModel: string | undefined = 
            agent === "factory-droid" ? command.payload.droidModel : undefined;

          // Create AbortController for cancellation support
          const buildAbortController = new AbortController();

          // Register build context for HTTP persistence
          // Using commandId as correlation key (server will look up sessionId)
          const buildContextId = command.id;
          activeBuildContexts.set(buildContextId, {
            commandId: command.id,
            sessionId: command.payload.sessionId || '', // Use sessionId from command if provided
            projectId: command.projectId,
            buildId: `build-${command.id}`, // Correlation ID for session lookup
            agentId: agent,
            claudeModelId: agent === 'claude-code' ? claudeModel : undefined,
            // Store for auto-start after build completion
            projectDirectory,
            projectSlug,
            // Store abort controller for cancellation
            abortController: buildAbortController,
          });

          if (agent === "claude-code") {
            log("claude model:", claudeModel);
          } else if (agent === "factory-droid") {
            log("droid model:", droidModel || "default");
          }

          // Select the appropriate model for the agent
          const modelId = agent === "factory-droid" ? droidModel : claudeModel;
          const agentQuery = createBuildQuery(agent, modelId as ClaudeModelId, buildAbortController);

          // Reset transformer state for new build
          resetTransformerState();
          setExpectedCwd(projectDirectory);

          // Orchestrate the build - handle templates, generate dynamic prompt
          log("orchestrating build...");

          // Log template if provided
          if (command.payload.templateId) {
            log(
              "template provided by frontend:",
              command.payload.templateId
            );
          }

          const orchestration = await orchestrateBuild({
            projectId: command.projectId,
            projectName: projectSlug,
            prompt: command.payload.prompt,
            messageParts: (command.payload as unknown as { messageParts: MessagePart[] }).messageParts, // Multi-modal content (images, etc.)
            operationType: command.payload.operationType,
            workingDirectory: projectDirectory,
            agent,
            template: command.payload.template, // NEW: Pass template from frontend
            designPreferences: command.payload.designPreferences, // User-specified design constraints (deprecated - use tags)
            tags: command.payload.tags, // Tag-based configuration
            conversationHistory: (command.payload as unknown as { conversationHistory: Array<{ role: string; content: string; timestamp: Date }> }).conversationHistory, // Pass conversation context (type will be updated after rebuild)
          });

          // Log template selection
          if (orchestration.template) {
            logger.template({
              name: orchestration.template.name,
              id: orchestration.template.id,
              fileCount: orchestration.fileTree?.length,
              status: 'selected',
            });
          }

          debugLog("orchestration complete:", {
            isNewProject: orchestration.isNewProject,
            hasTemplate: !!orchestration.template,
            templateEventsCount: orchestration.templateEvents.length,
            hasMetadata: !!orchestration.projectMetadata,
          });

          // Send project metadata if available (template download sets path, runCommand, etc.)
          if (orchestration.projectMetadata) {
            sendEvent({
              type: "project-metadata",
              ...buildEventBase(command.projectId, command.id),
              payload: orchestration.projectMetadata,
            } as RunnerEvent);
          }

          // Send template events (TodoWrite for template selection/download)
          const buildContextForTemplates = activeBuildContexts.get(command.id);
          for (const templateEvent of orchestration.templateEvents) {
            // Persist template events via HTTP (filtering happens in persistBuildEvent)
            if (buildContextForTemplates && templateEvent.type && templateEvent.data) {
              // Merge type into event data for persistence
              const fullEvent = {
                type: templateEvent.type,
                ...(templateEvent.data as Record<string, unknown>),
              };
              persistBuildEvent(buildContextForTemplates, fullEvent);
            }

            const payload = `data: ${JSON.stringify(
              templateEvent.data
            )}\n\n`;
            sendEvent({
              type: "build-stream",
              ...buildEventBase(command.projectId, command.id),
              data: payload,
            });
          }

          buildLog(
            ` 🚀 Starting build stream for project: ${command.projectId}`
          );
          buildLog(`   Directory: ${projectDirectory}`);
          buildLog(`   Is new project: ${orchestration.isNewProject}`);
          buildLog(
            `   Template: ${orchestration.template?.name || "none"}`
          );

          const stream = await createBuildStream({
            projectId: command.projectId,
            projectName,
            prompt: orchestration.fullPrompt,
            messageParts: (command.payload as unknown as { messageParts: MessagePart[] }).messageParts,
            operationType: command.payload.operationType,
            context: command.payload.context,
            query: agentQuery,
            workingDirectory: projectDirectory,
            systemPrompt: orchestration.systemPrompt,
            agent,
            claudeModel: agent === "claude-code" ? claudeModel : undefined,
            isNewProject: orchestration.isNewProject,
          });

          buildLog(
            ` 📡 Build stream created, starting to process chunks...`
          );

          const reader = stream.getReader();
          const decoder = new TextDecoder();

          let chunkCount = 0;
          
          // Track files modified and todos for build summary
          const filesModified = new Set<string>();
          const completedTodos: string[] = [];
          
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              buildLog(
                ` Stream reader reports DONE after ${chunkCount} chunks`
              );
              break;
            }
            if (value === undefined || value === null) continue;
            chunkCount++;

            // Decode the chunk to get the agent message object
            let agentMessage: unknown;
            if (typeof value === "string") {
              try {
                agentMessage = JSON.parse(value);
              } catch {
                agentMessage = { raw: value };
              }
            } else if (value instanceof Uint8Array) {
              const text = decoder.decode(value, { stream: true });
              try {
                agentMessage = JSON.parse(text);
              } catch {
                agentMessage = { raw: text };
              }
            } else if (ArrayBuffer.isView(value)) {
              const view = value as ArrayBufferView;
              const text = decoder.decode(
                new Uint8Array(
                  view.buffer,
                  view.byteOffset,
                  view.byteLength
                ),
                { stream: true }
              );
              try {
                agentMessage = JSON.parse(text);
              } catch {
                agentMessage = { raw: text };
              }
            } else if (value instanceof ArrayBuffer) {
              const text = decoder.decode(new Uint8Array(value), {
                stream: true,
              });
              try {
                agentMessage = JSON.parse(text);
              } catch {
                agentMessage = { raw: text };
              }
            } else if (typeof value === "object") {
              agentMessage = value;
            } else {
              log(
                "Unsupported chunk type from build stream:",
                typeof value
              );
              continue;
            }

            if (!loggedFirstChunk) {
              buildLog(` 📨 First chunk received from ${agentLabel}`);
              loggedFirstChunk = true;
            }

            // Log generation and tool usage
            if (typeof agentMessage === "object" && agentMessage !== null) {
              const msg = agentMessage as Record<string, unknown>;

              // The actual message is nested in a 'message' property
              const actualMessage =
                (msg.message as Record<string, unknown>) || msg;

              // Handle assistant messages (conversation turn format)
              if (
                msg.type === "assistant" &&
                actualMessage.content &&
                Array.isArray(actualMessage.content)
              ) {
                for (const block of actualMessage.content) {
                  // Log text content
                  if (block.type === "text" && block.text) {
                    buildLog(
                      ` 💭 ${agentLabel}: ${block.text.slice(0, 200)}${
                        block.text.length > 200 ? "..." : ""
                      }`
                    );
                  }

                  // Log thinking blocks
                  if (block.type === "thinking" && block.thinking) {
                    buildLog(
                      ` 🤔 Thinking: ${block.thinking.slice(0, 300)}${
                        block.thinking.length > 300 ? "..." : ""
                      }`
                    );
                  }

                  // Log tool use via unified logger
                  if (block.type === "tool_use") {
                    const toolName = block.name;
                    logger.tool(toolName, block.input as Record<string, unknown>);
                    
                    if (DEBUG_BUILD) {
                      buildLog(`    Input: ${truncateJSON(block.input, 200)}`);
                    }
                  }
                }
              }

              // Handle user messages (tool results)
              if (
                msg.type === "user" &&
                actualMessage.content &&
                Array.isArray(actualMessage.content)
              ) {
                for (const block of actualMessage.content) {
                  if (block.type === "tool_result") {
                    const toolId = block.tool_use_id;
                    const isError = block.is_error;

                    // Handle different content formats
                    let content = "";
                    if (typeof block.content === "string") {
                      content = block.content;
                    } else if (Array.isArray(block.content)) {
                      // Content might be an array of content blocks
                      content = (
                        block.content as Array<{
                          type: string;
                          text?: string;
                        }>
                      )
                        .map((c) => {
                          if (c.type === "text" && c.text) return c.text;
                          return JSON.stringify(c);
                        })
                        .join("\n");
                    } else {
                      content = JSON.stringify(block.content);
                    }

                    // DEBUG: Log tool results (adapter already logs this)
                    if (DEBUG_BUILD) {
                      if (isError) {
                        buildLog(` ❌ Tool error (${toolId}):`);
                        buildLog(`    ${truncate(content, 200)}`);
                      } else {
                        buildLog(` ✅ Tool result (${toolId}):`);
                        buildLog(`    ${truncate(content, 200)}`);
                      }
                    }
                  }
                }
              }
            }

            // Transform agent message to SSE events
            const sseEvents = transformAgentMessageToSSE(agentMessage);

            // Filter and send events - exclude high-volume events that don't affect UI
            const IMPORTANT_EVENT_TYPES = [
              'start',
              'finish',
              'tool-input-available',
              'tool-output-available',
              'text-start',
              'text-delta',  // Needed for streaming text content (e.g., GITHUB_RESULT parsing)
              'text-end',
              'error',
              // NOT reasoning (high volume, only for DB persistence if needed)
            ];

            // Get build context for HTTP persistence
            const buildContext = activeBuildContexts.get(command.id);

            for (const event of sseEvents) {
              // Track files modified via Edit/Write tools for summary context
              if (event.type === 'tool-input-available') {
                const toolEvent = event as { toolName?: string; input?: unknown };
                if ((toolEvent.toolName === 'Edit' || toolEvent.toolName === 'Write') && toolEvent.input) {
                  const input = toolEvent.input as { file_path?: string; filePath?: string };
                  const filePath = input.file_path || input.filePath;
                  if (filePath) {
                    // Extract just the filename/relative path for cleaner summary
                    const relativePath = filePath.includes('/') 
                      ? filePath.split('/').slice(-2).join('/')
                      : filePath;
                    filesModified.add(relativePath);
                  }
                }
                // Track completed todos for summary context
                if (toolEvent.toolName === 'TodoWrite' && toolEvent.input) {
                  const rawInput = toolEvent.input as { todos?: string | Array<{ id?: string; content: string; status: string; priority?: string }> };
                  
                  // Handle both formats:
                  // 1. Droid CLI format: string with numbered list like "1. [completed] Task"
                  // 2. Claude format: array of objects with content, status, etc.
                  let todoItems: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; priority?: 'high' | 'medium' | 'low' }> = [];
                  
                  if (typeof rawInput.todos === 'string') {
                    // Parse droid CLI string format: "1. [completed] First task\n2. [in_progress] Second task"
                    const lines = rawInput.todos.split('\n').filter(l => l.trim());
                    todoItems = lines.map((line, idx) => {
                      // Match patterns like "1. [completed] Task content" or "1. [in_progress] Task"
                      const match = line.match(/^\d+\.\s*\[(\w+)\]\s*(.+)$/);
                      if (match) {
                        const [, statusStr, content] = match;
                        const status = statusStr as 'pending' | 'in_progress' | 'completed' | 'cancelled';
                        return {
                          id: `todo-${Date.now()}-${idx}`,
                          content: content.trim(),
                          status,
                        };
                      }
                      // Fallback: treat line as pending task
                      return {
                        id: `todo-${Date.now()}-${idx}`,
                        content: line.replace(/^\d+\.\s*/, '').trim(),
                        status: 'pending' as const,
                      };
                    });
                  } else if (Array.isArray(rawInput.todos)) {
                    // Claude format: array of objects
                    todoItems = rawInput.todos.map(t => ({
                      id: t.id || `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      content: t.content,
                      status: t.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
                      priority: t.priority as 'high' | 'medium' | 'low' | undefined,
                    }));
                  }
                  
                  if (todoItems.length > 0) {
                    // Update the logger's todo list for the build panel
                    logger.updateTodos(todoItems);
                    
                    // Get completed todos (excluding any "summarize" todos from old prompts)
                    const completed = todoItems
                      .filter(t => t.status === 'completed' && !t.content.toLowerCase().includes('summarize'))
                      .map(t => t.content);
                    // Update our list with the latest completed todos
                    completedTodos.length = 0;
                    completedTodos.push(...completed);
                  }
                }
              }
              
              // Persist events via HTTP (filtering happens in persistBuildEvent)
              // AWAIT to ensure input writes before output arrives (prevents race condition)
              if (buildContext) {
                await persistBuildEvent(buildContext, event);
              }

              // Only send important events via WebSocket for frontend UI
              if (!IMPORTANT_EVENT_TYPES.includes(event.type)) {
                continue;
              }

              const payload = `data: ${JSON.stringify(event)}\n\n`;
              sendEvent({
                type: "build-stream",
                ...buildEventBase(command.projectId, command.id),
                data: payload,
              });
            }
          }

          buildLog(` ═══════════════════════════════════════════════`);
          buildLog(` STREAM ENDED - Processing final chunks`);
          buildLog(` ═══════════════════════════════════════════════`);

          const finalChunk = decoder.decode();
          if (finalChunk) {
            buildLog(` Final chunk decoded: ${finalChunk.length} chars`);
            let payload = finalChunk.startsWith("data:")
              ? finalChunk
              : `data: ${finalChunk}`;
            if (!payload.endsWith("\n\n")) {
              payload = `${payload}\n\n`;
            }
            sendEvent({
              type: "build-stream",
              ...buildEventBase(command.projectId, command.id),
              data: payload,
            });
          }

          buildLog(` Sending [DONE] signal to client`);
          sendEvent({
            type: "build-stream",
            ...buildEventBase(command.projectId, command.id),
            data: "data: [DONE]\n\n",
          });

          // Detect runCommand from built project's package.json
          try {
            const { readFileSync, existsSync } = await import("fs");
            const packageJsonPath = join(projectDirectory, "package.json");

            if (existsSync(packageJsonPath)) {
              const packageJson = JSON.parse(
                readFileSync(packageJsonPath, "utf-8")
              );
              let runCommand = null;

              if (packageJson.scripts?.dev) {
                runCommand = "npm run dev";
              } else if (packageJson.scripts?.start) {
                runCommand = "npm start";
              }

              if (runCommand) {
                // Send project-metadata event with detected runCommand
                sendEvent({
                  type: "project-metadata",
                  ...buildEventBase(command.projectId, command.id),
                  payload: {
                    path: projectDirectory,
                    projectType: "unknown",
                    runCommand,
                    port: 3000,
                  },
                } as RunnerEvent);

                if (!isSilentMode && DEBUG_BUILD)
                  console.log(`✅ Detected runCommand: ${runCommand}`);
              }
            }
          } catch (error) {
            log("Failed to detect runCommand:", error);
          }

          // Calculate build statistics
          const buildEndTime = Date.now();
          const completedBuildContext = activeBuildContexts.get(command.id);
          const elapsedSeconds = completedBuildContext 
            ? (buildEndTime - (completedBuildContext as any).startTime || buildEndTime) / 1000 
            : 0;
          
          // TODO: Get actual token usage from build stream when available
          const totalTokens = 0; // Will be populated from usage events
          
          logger.buildComplete({
            elapsedTime: elapsedSeconds,
            toolCallCount: filesModified.size + completedTodos.length, // Approximate from tracked data
            totalTokens,
            directory: projectDirectory,
          });

          debugLog(`Total chunks processed: (stream ended)`);

          // Detect framework from generated files
          let detectedFramework: string | null = null;
          try {
            const { detectFrameworkFromFilesystem } = await import('@openbuilder/agent-core/lib/port-allocator');
            const framework = await detectFrameworkFromFilesystem(projectDirectory);
            detectedFramework = framework;
            
            if (framework) {
              buildLog(`   🔍 Detected framework: ${framework}`);
              log(`[build] Detected framework for ${command.projectId}: ${framework}`);
            }
          } catch (error) {
            log(`[build] Failed to detect framework:`, error);
          }

          const completedContext = activeBuildContexts.get(command.id);
          const sessionId = completedContext?.sessionId;

          sendEvent({
            type: "build-completed",
            ...buildEventBase(command.projectId, command.id),
            payload: {
              todos: [],
              detectedFramework,
            },
          });

          const filesArray = Array.from(filesModified);
          const completedTodoSnapshot = [...completedTodos];
          const hasChanges = filesArray.length > 0 || completedTodoSnapshot.length > 0;

          if (hasChanges) {
            void (async () => {
              try {
                buildLog(` 📝 Generating build summary via AI...`);
                buildLog(`    Files modified: ${filesArray.length}`);
                buildLog(`    Tasks completed: ${completedTodoSnapshot.length}`);

                const summaryPrompt = `You are a build summary generator. Generate a concise 1-3 sentence summary of what was built or changed.

Original request: "${command.payload.prompt}"

${filesArray.length > 0 ? `Files modified:\n${filesArray.map(f => `- ${f}`).join('\n')}` : 'No files were modified.'}

${completedTodoSnapshot.length > 0 ? `Tasks completed:\n${completedTodoSnapshot.map(t => `- ${t}`).join('\n')}` : ''}

Write a brief, professional summary (1-3 sentences) describing what was accomplished. Focus on the outcome, not the process. Do not use phrases like "I did" or "The assistant". Just describe what was built or changed.`;

                // Use native Claude Agent SDK for summary generation
                let summaryText = '';
                for await (const msg of query({
                  prompt: summaryPrompt,
                  options: {
                    model: 'claude-haiku-4-5',
                    maxTurns: 1,
                    permissionMode: 'default',
                  },
                })) {
                  if (msg.type === 'assistant' && msg.message?.content) {
                    for (const block of msg.message.content) {
                      if (block.type === 'text') {
                        summaryText += block.text;
                      }
                    }
                  }
                }

                summaryText = summaryText.trim();
                if (summaryText) {
                  buildLog(` ✅ AI summary generated (${summaryText.length} chars)`);
                  sendEvent({
                    type: "build-summary",
                    sessionId,
                    ...buildEventBase(command.projectId, command.id),
                    payload: {
                      summary: summaryText,
                    },
                  });
                }
              } catch (summaryError) {
                log(`[build] Failed to generate AI summary:`, summaryError);
                buildLog(` ⚠️ AI summary failed`);
              }
            })();
          }

          // Print event summary
          printEventSummary();

          // ============================================================
          // AUTO-START DEV SERVER AFTER BUILD COMPLETION
          // ============================================================
          // Note: The dev server will be started by the API via the start route
          // which handles proper port allocation. We just send an event to trigger it.
          if (completedContext?.projectDirectory && detectedFramework) {
            log(`🚀 Build complete - dev server will be started via API with proper port allocation`);

            // Send an event to signal the frontend/API to start the dev server
            // The API's start route handles port allocation correctly
            sendEvent({
              type: "ack",
              ...buildEventBase(command.projectId, command.id),
              message: "build-complete-ready-for-dev-server",
            });
          }

          // Clean up build context and session tracking
          if (completedContext) {
            startedSessions.delete(completedContext.sessionId);
          }
          activeBuildContexts.delete(command.id);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to run build";
          logger.buildFailed(errorMessage);
          
          Sentry.getActiveSpan()?.setStatus({
            code: 2, // SPAN_STATUS_ERROR
            message: "Build failed",
          });
          sendEvent({
            type: "build-failed",
            ...buildEventBase(command.projectId, command.id),
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
          });

          // Print event summary
          printEventSummary();

          // Clean up build context and session tracking on failure
          const failedContext = activeBuildContexts.get(command.id);
          if (failedContext) {
            startedSessions.delete(failedContext.sessionId);
          }
          activeBuildContexts.delete(command.id);
          throw error;
        }
        break;
      }
      case "http-proxy-request": {
        // HTTP proxy request - fetch from local dev server and return response
        try {
          const { requestId, method, path: reqPath, headers, body, port } = command.payload;
          
          debugLog(`🔀 HTTP proxy request: ${method} ${reqPath} → localhost:${port}`);
          
          // Build the target URL
          const targetUrl = `http://localhost:${port}${reqPath}`;
          
          // Decode body if present
          const requestBody = body ? Buffer.from(body, 'base64') : undefined;
          
          // Fetch from dev server
          const response = await fetch(targetUrl, {
            method,
            headers: {
              ...headers,
              // Remove hop-by-hop headers
              'host': `localhost:${port}`,
            },
            body: requestBody,
            // Don't follow redirects - let the client handle them
            redirect: 'manual',
          });
          
          // Get response headers
          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            // Skip hop-by-hop headers
            if (!['transfer-encoding', 'connection', 'keep-alive'].includes(key.toLowerCase())) {
              responseHeaders[key] = value;
            }
          });
          
          // Get response body
          const responseBody = Buffer.from(await response.arrayBuffer());
          
          // Determine if we need to chunk the response
          const shouldChunk = responseBody.length > 1024 * 1024; // 1MB threshold
          
          if (shouldChunk) {
            // Send initial response with headers only
            sendEvent({
              type: "http-proxy-response",
              ...buildEventBase(command.projectId, command.id),
              requestId,
              statusCode: response.status,
              headers: responseHeaders,
              isChunked: true,
            });
            
            // Send body in chunks
            const chunkSize = 64 * 1024; // 64KB chunks
            for (let i = 0; i < responseBody.length; i += chunkSize) {
              const chunk = responseBody.slice(i, i + chunkSize);
              const isFinal = i + chunkSize >= responseBody.length;
              
              sendEvent({
                type: "http-proxy-chunk",
                ...buildEventBase(command.projectId, command.id),
                requestId,
                chunk: chunk.toString('base64'),
                isFinal,
              });
            }
          } else {
            // Send complete response in one message
            sendEvent({
              type: "http-proxy-response",
              ...buildEventBase(command.projectId, command.id),
              requestId,
              statusCode: response.status,
              headers: responseHeaders,
              body: responseBody.toString('base64'),
              isChunked: false,
            });
          }
          
          debugLog(`✅ HTTP proxy response: ${response.status} (${responseBody.length} bytes)`);
          
        } catch (error) {
          console.error("[runner] ❌ HTTP proxy request failed:", error);
          sendEvent({
            type: "http-proxy-error",
            ...buildEventBase(command.projectId, command.id),
            requestId: command.payload.requestId,
            error: error instanceof Error ? error.message : "HTTP proxy request failed",
            statusCode: 502, // Bad Gateway
          });
        }
        break;
      }
      case "hmr-connect": {
        // Connect to local HMR WebSocket server
        const { connectionId, port, protocol } = command.payload;
        hmrProxyManager.connect(connectionId, port, command.projectId, protocol);
        break;
      }
      case "hmr-message": {
        // Forward message to HMR server
        const { connectionId, message } = command.payload;
        hmrProxyManager.send(connectionId, message);
        break;
      }
      case "hmr-disconnect": {
        // Disconnect from HMR server
        const { connectionId } = command.payload;
        hmrProxyManager.disconnect(connectionId);
        break;
      }
      case "github-sync": {
        // Sync GitHub repository information (not yet implemented)
        console.log('[github] GitHub sync command received (not yet implemented)');
        sendEvent({
          type: "ack",
          commandId: command.id,
          projectId: command.projectId,
          timestamp: new Date().toISOString(),
          message: 'GitHub sync command received (not yet implemented)',
        });
        break;
      }
      case "github-push": {
        // Push to GitHub repository (not yet implemented)
        console.log('[github] GitHub push command received (not yet implemented)');
        sendEvent({
          type: "ack",
          commandId: command.id,
          projectId: command.projectId,
          timestamp: new Date().toISOString(),
          message: 'GitHub push command received (not yet implemented)',
        });
        break;
      }
      case "cancel-build": {
        // Cancel an active build by aborting the Claude Agent SDK query
        const { reason } = command.payload;
        const projectId = command.projectId;
        console.log(`[runner] Cancel build requested for project: ${projectId}`);
        
        // Find the build context by project ID (there can only be one active build per project)
        let buildContext: BuildContext | undefined;
        let buildContextId: string | undefined;
        
        for (const [id, ctx] of activeBuildContexts) {
          if (ctx.projectId === projectId) {
            buildContext = ctx;
            buildContextId = id;
            break;
          }
        }
        
        if (!buildContext || !buildContextId) {
          console.log(`[runner] No active build found for project: ${projectId}`);
          sendEvent({
            type: "build-cancelled",
            commandId: command.id,
            projectId: command.projectId,
            timestamp: new Date().toISOString(),
            payload: {
              buildCommandId: '',
              success: false,
              reason: 'Build not found or already completed',
            },
          } as RunnerEvent);
          break;
        }
        
        // Abort the build using the stored AbortController
        if (buildContext.abortController) {
          console.log(`[runner] Aborting build ${buildContextId} via AbortController`);
          buildContext.abortController.abort();
          
          // Clean up the build context
          activeBuildContexts.delete(buildContextId);
          
          sendEvent({
            type: "build-cancelled",
            commandId: command.id,
            projectId: command.projectId,
            timestamp: new Date().toISOString(),
            payload: {
              buildCommandId: buildContextId,
              success: true,
              reason: reason || 'Build cancelled by user',
            },
          } as RunnerEvent);
        } else {
          console.log(`[runner] Build ${buildContextId} has no AbortController (may be using legacy SDK)`);
          sendEvent({
            type: "build-cancelled",
            commandId: command.id,
            projectId: command.projectId,
            timestamp: new Date().toISOString(),
            payload: {
              buildCommandId: buildContextId,
              success: false,
              reason: 'Build cannot be cancelled (no abort controller)',
            },
          } as RunnerEvent);
        }
        break;
      }
      default:
        assertNever(command as never);
    }
  }

  function publishStatus(projectId?: string, commandId?: string) {
    const uptimeSeconds = Math.round(process.uptime());
    const load = os.loadavg?.()[0];

    sendEvent({
      type: "runner-status",
      ...buildEventBase(projectId, commandId),
      payload: {
        status: "online",
        version: "prototype",
        hostname: os.hostname(),
        platform: os.platform(),
        uptimeSeconds,
        load,
      },
    });
  }

  function scheduleHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    heartbeatTimer = setInterval(() => publishStatus(), HEARTBEAT_INTERVAL_MS);
  }

  // Set up HMR proxy callbacks to forward HMR events through the main WebSocket
  hmrProxyManager.setCallbacks({
    onConnected: (connectionId) => {
      sendEvent({
        type: "hmr-connected",
        ...buildEventBase(),
        connectionId,
      });
    },
    onMessage: (connectionId, message) => {
      sendEvent({
        type: "hmr-message",
        ...buildEventBase(),
        connectionId,
        message,
      });
    },
    onDisconnected: (connectionId, code, reason) => {
      sendEvent({
        type: "hmr-disconnected",
        ...buildEventBase(),
        connectionId,
        code,
        reason,
      });
    },
    onError: (connectionId, error) => {
      console.warn(`[hmr-proxy] HMR error: ${connectionId} - ${error}`);
      sendEvent({
        type: "hmr-error",
        ...buildEventBase(),
        connectionId,
        error,
      });
    },
  });

  function cleanupSocket() {
    if (socket) {
      socket.removeAllListeners();
      socket.terminate();
      socket = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function connect() {
    // Clean up old socket and listeners to prevent memory leaks
    cleanupSocket();
    const url = new URL(WS_URL);
    url.searchParams.set("runnerId", RUNNER_ID);

    socket = new WebSocket(url.toString(), {
      headers: {
        Authorization: `Bearer ${SHARED_SECRET}`,
      },
      handshakeTimeout: CONNECTION_HANDSHAKE_TIMEOUT,
    });

    socket.on("open", () => {
      reconnectAttempts = 0; // Reset on successful connection
      lastPongReceived = Date.now(); // Reset pong timer on new connection
      lastCommandReceived = Date.now(); // Reset command timer on new connection
      
      // Update logger connection status
      logger.setConnected(true);
      debugLog("Health check: ping/pong enabled, command timeout: 5 minutes");
      publishStatus();
      scheduleHeartbeat();

      // Start ping/pong to keep connection alive
      if (pingTimer) clearInterval(pingTimer);
      let pingCount = 0; // Track ping count for periodic health logging
      pingTimer = setInterval(() => {
        const now = Date.now();
        pingCount++;
        
        // Periodic health check logging (every 10 pings = 5 minutes)
        if (pingCount % 10 === 0) {
          const secondsSinceCommand = Math.round((now - lastCommandReceived) / 1000);
          const secondsSincePong = Math.round((now - lastPongReceived) / 1000);
          log(`💚 Connection health check: last command ${secondsSinceCommand}s ago, last pong ${secondsSincePong}s ago`);
        }
        
        // Check if pong timeout exceeded - indicates zombie connection
        if (now - lastPongReceived > PONG_TIMEOUT) {
          log("⚠️  No pong received, forcing reconnection");
          socket?.close(1002, "Pong timeout");
          return;
        }
        
        // BUG FIX: Check if we've received any commands recently
        // Even if ping/pong works, the connection might be stuck and not receiving commands
        if (now - lastCommandReceived > COMMAND_RECEIVE_TIMEOUT) {
          log("⚠️  No commands received for 30 minutes, forcing reconnection");
          log(`   Last command: ${Math.round((now - lastCommandReceived) / 1000)}s ago`);
          socket?.close(1003, "Command receive timeout");
          return;
        }
        
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.ping();
        }
      }, PING_INTERVAL);
    });

    socket.on("message", async (data: WebSocket.RawData) => {
      try {
        const command = JSON.parse(String(data)) as RunnerCommand;

        // BUG FIX: Update lastCommandReceived timestamp
        lastCommandReceived = Date.now();

        // Get projectId - analyze-project commands don't have one yet
        const projectIdForTelemetry = command.type === 'analyze-project' 
          ? 'pending-analysis' 
          : (command as { projectId: string }).projectId;

        // Continue trace from frontend - each build now starts its trace in the frontend
        // This creates a span within the continued trace for the runner's work
        if (command._sentry?.trace) {
          console.log("[runner] Continuing trace from frontend:", command._sentry.trace.substring(0, 50));
          await Sentry.continueTrace(
            {
              sentryTrace: command._sentry.trace,
              baggage: command._sentry.baggage,
            },
            async () => {
              // Create a span for this command execution within the continued trace
              await Sentry.startSpan(
                {
                  name: `runner.${command.type}`,
                  op: command.type === 'start-build' ? 'build.runner' : `runner.${command.type}`,
                  attributes: {
                    'command.type': command.type,
                    'command.id': command.id,
                    'project.id': projectIdForTelemetry,
                    'trace.continued': true,
                  },
                },
                async (span) => {
                  try {
                    Sentry.setTag("command_type", command.type);
                    Sentry.setTag("project_id", projectIdForTelemetry);
                    Sentry.setTag("command_id", command.id);

                    // Capture build metrics for start-build commands
                    if (command.type === 'start-build' && command.payload) {
                      const agent = command.payload.agent ?? 'claude-code';
                      const claudeModel = agent === 'claude-code' && 
                        (command.payload.claudeModel === 'claude-haiku-4-5' || 
                         command.payload.claudeModel === 'claude-sonnet-4-5' || 
                         command.payload.claudeModel === 'claude-opus-4-5')
                        ? command.payload.claudeModel
                        : 'claude-sonnet-4-5';
                      
                      Sentry.metrics.count('runner.build.started', 1, {
                        attributes: {
                          project_id: command.projectId,
                          model: agent === 'claude-code' ? claudeModel : agent,
                          framework: command.payload.template?.framework || 'unknown',
                          operation_type: command.payload.operationType || 'initial-build',
                        }
                      });
                    }

                    await handleCommand(command);
                  } catch (error) {
                    span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'Command failed' });
                    throw error;
                  }
                }
              );
            }
          );
        } else {
          console.log("[runner] No trace context - starting isolated span");
          // Create an isolated span when no trace context is provided
          await Sentry.startSpan(
            {
              name: `runner.${command.type}`,
              op: command.type === 'start-build' ? 'build.runner' : `runner.${command.type}`,
              attributes: {
                'command.type': command.type,
                'command.id': command.id,
                'project.id': projectIdForTelemetry,
                'trace.continued': false,
              },
            },
            async (span) => {
              try {
                Sentry.setTag("command_type", command.type);
                Sentry.setTag("project_id", projectIdForTelemetry);
                Sentry.setTag("command_id", command.id);

                // Capture build metrics for start-build commands
                if (command.type === 'start-build' && command.payload) {
                  const agent = command.payload.agent ?? 'claude-code';
                  const claudeModel = agent === 'claude-code' && 
                    (command.payload.claudeModel === 'claude-haiku-4-5' || 
                     command.payload.claudeModel === 'claude-sonnet-4-5' || 
                     command.payload.claudeModel === 'claude-opus-4-5')
                    ? command.payload.claudeModel
                    : 'claude-sonnet-4-5';
                  
                  Sentry.metrics.count('runner.build.started', 1, {
                    attributes: {
                      project_id: command.projectId,
                      model: agent === 'claude-code' ? claudeModel : agent,
                      framework: command.payload.template?.framework || 'unknown',
                      operation_type: command.payload.operationType || 'initial-build',
                    }
                  });
                }

                await handleCommand(command);
              } catch (error) {
                span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'Command failed' });
                throw error;
              }
            }
          );
        }
      } catch (error) {
        console.error("Failed to parse command", error);
        Sentry.captureException(error);
        sendEvent({
          type: "error",
          ...buildEventBase(undefined, randomUUID()),
          error: "Failed to parse command payload",
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    });

    socket.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason.toString() || "no reason provided";

      // Update logger connection status
      logger.setConnected(false);

      // Suppress close logs during startup (first few attempts) - expected as server starts
      const isEarlyAttempt = reconnectAttempts < SUPPRESS_ERRORS_UNTIL_ATTEMPT;
      if (!isEarlyAttempt) {
        debugLog(`connection closed with code ${code}, reason: ${reasonStr}`);
      }

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }

      // Don't reconnect if we're shutting down
      if (isShuttingDown) {
        log("shutdown in progress, skipping reconnection");
        return;
      }

      // Check if max reconnection attempts reached
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(
          `Max reconnection attempts reached (${MAX_RECONNECT_ATTEMPTS}). Giving up.`
        );
        return;
      }

      // Exponential backoff with max delay
      reconnectAttempts++;
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttempts - 1), // 1s, 2s, 4s, 8s, 16s...
        MAX_RECONNECT_DELAY
      );

      // Suppress reconnection logs during startup
      if (!isEarlyAttempt) {
        debugLog(`reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
      }
      setTimeout(connect, delay);
    });

    socket.on("pong", () => {
      // Update timestamp to track connection health
      lastPongReceived = Date.now();
    });

    socket.on("error", (error: Error) => {
      // Suppress expected ECONNREFUSED errors during startup (first few attempts)
      const isConnRefused = (error as { code?: string }).code === 'ECONNREFUSED';
      const isEarlyAttempt = reconnectAttempts < SUPPRESS_ERRORS_UNTIL_ATTEMPT;

      if (!isConnRefused || !isEarlyAttempt) {
        console.error("socket error", error);
      }

      // Close socket to trigger reconnection
      socket?.close(1006, "Error occurred");
    });
  }

  // Shared cleanup logic that can be called programmatically or via signals
  const performShutdown = async () => {
    // Prevent duplicate shutdown calls
    if (isShuttingDown) return;

    log("shutting down runner");
    isShuttingDown = true; // Prevent reconnection attempts

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pingTimer) clearInterval(pingTimer);

    // Close WebSocket connection gracefully
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "Shutdown requested");
    }

    // Close HTTP health server if running
    if (healthServer) {
      await new Promise<void>((resolve) => {
        healthServer.close(() => {
          log("health server closed");
          resolve();
        });
      });
    }

    // Stop all running dev servers and cleanup tunnels
    const { stopAllDevServers } = await import('./lib/process-manager.js');

    // Stop all dev server processes (this also handles tunnel cleanup per-process)
    await stopAllDevServers(tunnelManager);

    // Final cleanup of any remaining tunnels
    await tunnelManager.closeAll();

    // Flush Sentry events before exiting
    await Sentry.flush(2000);

    log("shutdown complete");
  };

  process.on("SIGINT", async () => {
    log("shutting down (Ctrl+C)");
    await performShutdown();
    // Don't call process.exit() - let the CLI's shutdown handler finish
    // If running standalone (not via CLI), the process will exit naturally
  });

  process.on("SIGTERM", async () => {
    log("shutting down (SIGTERM)");
    await performShutdown();
    // Don't call process.exit() - let the CLI's shutdown handler finish
  });

  // Wait before initial connection to allow Next.js server to start
  log(`waiting ${INITIAL_CONNECTION_DELAY / 1000}s for server to start...`);
  setTimeout(connect, INITIAL_CONNECTION_DELAY);

  // Return cleanup function for programmatic shutdown (when used via CLI)
  return performShutdown;
}

// If running this file directly, start the runner
// ESM equivalent of: if (require.main === module)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[runner] Starting runner directly...');
  console.log('[runner] RUNNER_WS_URL:', process.env.RUNNER_WS_URL);
  console.log('[runner] RUNNER_SHARED_SECRET:', process.env.RUNNER_SHARED_SECRET ? '***set***' : '***NOT SET***');
  startRunner().catch((err) => {
    console.error('[runner] Failed to start:', err);
    process.exit(1);
  });
}
