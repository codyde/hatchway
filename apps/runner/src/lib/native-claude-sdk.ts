/**
 * Native Claude Agent SDK Integration
 * 
 * This is the default SDK integration for AI-powered builds.
 * For multi-provider support, set ENABLE_OPENCODE_SDK=true to use opencode-sdk.ts instead.
 *
 * This module provides direct integration with the official @anthropic-ai/claude-agent-sdk
 * without going through the AI SDK or community provider layers.
 *
 * Benefits:
 * - Native message format (no transformation needed)
 * - Full access to SDK features (hooks, sessions, subagents)
 * - Simpler architecture with fewer dependencies
 * - Direct streaming without adaptation layer
 */

import { query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import * as Sentry from '@sentry/node';
import { existsSync, mkdirSync } from 'node:fs';
import { createProjectScopedPermissionHandler } from './permissions/project-scoped-handler.js';
import { ensureProjectSkills } from './skills.js';
import {
  CLAUDE_SYSTEM_PROMPT,
  type ClaudeModelId,
  DEFAULT_CLAUDE_MODEL_ID,
} from '@openbuilder/agent-core';

// Debug logging helper - suppressed in TUI mode (SILENT_MODE=1)
const debugLog = (message: string) => {
  if (process.env.SILENT_MODE !== '1' && process.env.DEBUG_BUILD === '1') {
    debugLog(message);
  }
};

// Message part types for multi-modal support
interface MessagePart {
  type: string;
  text?: string;
  image?: string;
  mimeType?: string;
  fileName?: string;
}

// Internal message format that matches our transformer expectations
interface TransformedMessage {
  type: 'assistant' | 'user' | 'result' | 'system';
  message?: {
    id: string;
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>;
  };
  result?: string;
  usage?: unknown;
  subtype?: string;
  session_id?: string;
}

/**
 * Transform SDK messages to our internal format
 *
 * The SDK outputs messages in a format very similar to what our message transformer expects,
 * but we need to ensure consistent structure for downstream processing.
 */
function transformSDKMessage(sdkMessage: SDKMessage): TransformedMessage | null {
  switch (sdkMessage.type) {
    case 'assistant': {
      // Assistant messages contain the Claude response with text and tool use blocks
      return {
        type: 'assistant',
        message: {
          id: sdkMessage.uuid || `msg-${Date.now()}`,
          content: sdkMessage.message.content.map((block) => {
            if (block.type === 'text') {
              return { type: 'text', text: block.text };
            } else if (block.type === 'tool_use') {
              return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
              };
            } else if (block.type === 'thinking') {
              // Extended thinking blocks - pass through
              return { type: 'thinking', text: (block as { thinking?: string }).thinking };
            }
            return block as { type: string };
          }),
        },
      };
    }

    case 'user': {
      // User messages contain tool results
      const content = sdkMessage.message.content;
      const transformedContent = Array.isArray(content)
        ? content.map((block) => {
            if (typeof block === 'object' && block !== null) {
              const typedBlock = block as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
              if (typedBlock.type === 'tool_result') {
                return {
                  type: 'tool_result',
                  tool_use_id: typedBlock.tool_use_id,
                  content: typeof typedBlock.content === 'string'
                    ? typedBlock.content
                    : JSON.stringify(typedBlock.content),
                  is_error: typedBlock.is_error,
                };
              }
            }
            return block as { type: string };
          })
        : [{ type: 'text', text: String(content) }];

      return {
        type: 'user',
        message: {
          id: sdkMessage.uuid || `user-${Date.now()}`,
          content: transformedContent,
        },
      };
    }

    case 'result': {
      // Final result message with usage stats
      return {
        type: 'result',
        result: sdkMessage.subtype === 'success' ? sdkMessage.result : undefined,
        usage: sdkMessage.usage,
        subtype: sdkMessage.subtype,
        session_id: sdkMessage.session_id,
      };
    }

    case 'system': {
      // System messages (init, status, etc.)
      if (sdkMessage.subtype === 'init') {
        // Could emit session info if needed
        return null; // Skip for now - we don't need init messages in output
      }
      return null;
    }

    case 'stream_event': {
      // Partial streaming events - skip unless includePartialMessages is true
      // These are handled separately if needed
      return null;
    }

    default:
      return null;
  }
}

/**
 * Build prompt with image support for multi-modal messages
 */
function buildPromptWithImages(prompt: string, messageParts?: MessagePart[]): string {
  // For now, we pass images via the message format rather than prompt string
  // The SDK handles multi-modal via the prompt parameter accepting different formats
  // TODO: Investigate SDK support for image content in prompts
  return prompt;
}

/**
 * Create a native Claude query function using the official SDK directly
 *
 * This replaces the previous approach of:
 * claudeCode() provider -> AI SDK streamText() -> transformAISDKStream()
 *
 * With:
 * query() SDK function -> minimal transformation -> output
 * 
 * Sentry Integration:
 * - The query() function is auto-instrumented by Sentry's claudeCodeAgentSdkIntegration
 * - Instrumentation hooks into @anthropic-ai/claude-agent-sdk via OpenTelemetry
 * - IMPORTANT: Sentry must be initialized BEFORE claude-agent-sdk is imported
 */
export function createNativeClaudeQuery(
  modelId: ClaudeModelId = DEFAULT_CLAUDE_MODEL_ID,
  abortController?: AbortController
) {
  return async function* nativeClaudeQuery(
    prompt: string,
    workingDirectory: string,
    systemPrompt: string,
    _agent?: string,
    _codexThreadId?: string,
    messageParts?: MessagePart[]
  ): AsyncGenerator<TransformedMessage, void, unknown> {
    debugLog('[runner] [native-sdk] 🎯 Starting native SDK query\n');
    debugLog(`[runner] [native-sdk] Model: ${modelId}\n`);
    debugLog(`[runner] [native-sdk] Working dir: ${workingDirectory}\n`);
    debugLog(`[runner] [native-sdk] Prompt length: ${prompt.length}\n`);

    // Build combined system prompt
    const systemPromptSegments: string[] = [CLAUDE_SYSTEM_PROMPT.trim()];
    if (systemPrompt && systemPrompt.trim().length > 0) {
      systemPromptSegments.push(systemPrompt.trim());
    }
    const appendedSystemPrompt = systemPromptSegments.join('\n\n');

    // Ensure working directory exists
    if (!existsSync(workingDirectory)) {
      console.log(`[native-sdk] Creating working directory: ${workingDirectory}`);
      mkdirSync(workingDirectory, { recursive: true });
    }
    
    // Ensure project has skills copied from bundled skills
    ensureProjectSkills(workingDirectory);

    // Check for multi-modal content
    const hasImages = messageParts?.some(p => p.type === 'image');
    if (hasImages) {
      const imageCount = messageParts?.filter(p => p.type === 'image').length || 0;
      debugLog(`[runner] [native-sdk] 🖼️  Multi-modal message with ${imageCount} image(s)\n`);
    }

    // Build the final prompt
    const finalPrompt = buildPromptWithImages(prompt, messageParts);

    // Configure SDK options
    const options: Options = {
      model: modelId,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: appendedSystemPrompt,
      },
      cwd: workingDirectory,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true, // Required for bypassPermissions
      maxTurns: 100,
      additionalDirectories: [workingDirectory],
      canUseTool: createProjectScopedPermissionHandler(workingDirectory),
      includePartialMessages: false, // We don't need streaming deltas
      settingSources: ['user', 'project'],
      env: {
        ...process.env,
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? '64000',
      },
      // Use preset tools from Claude Code
      tools: { type: 'preset', preset: 'claude_code' },
      // Pass abort controller for cancellation support
      // NOTE: There is a known bug in the Claude Agent SDK where AbortController
      // signals are not fully respected. When abort() is called, the SDK may
      // continue processing for several more turns before stopping.
      // See: https://github.com/anthropics/claude-code/issues/2970
      // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/46
      abortController,
    };

    debugLog('[runner] [native-sdk] 🚀 Starting SDK query stream\n');

    let messageCount = 0;
    let toolCallCount = 0;
    let textBlockCount = 0;

    try {
      // Stream messages directly from the SDK
      // NOTE: query() is auto-instrumented by Sentry's claudeCodeAgentSdkIntegration
      for await (const sdkMessage of query({ prompt: finalPrompt, options })) {
        messageCount++;

        // Transform SDK message to our internal format
        const transformed = transformSDKMessage(sdkMessage);

        if (transformed) {
          // Track stats for logging
          if (transformed.type === 'assistant' && transformed.message?.content) {
            for (const block of transformed.message.content) {
              if (block.type === 'tool_use') {
                toolCallCount++;
                debugLog(`[runner] [native-sdk] 🔧 Tool call: ${block.name}\n`);
              } else if (block.type === 'text') {
                textBlockCount++;
              }
            }
          }

          yield transformed;
        }

        // Log result messages
        if (sdkMessage.type === 'result') {
          if (sdkMessage.subtype === 'success') {
            debugLog(`[runner] [native-sdk] ✅ Query complete - ${sdkMessage.num_turns} turns, $${sdkMessage.total_cost_usd?.toFixed(4)} USD\n`);
          } else {
            debugLog(`[runner] [native-sdk] ⚠️  Query ended with: ${sdkMessage.subtype}\n`);
          }
        }
      }

      debugLog(`[runner] [native-sdk] 📊 Stream complete - ${messageCount} messages, ${toolCallCount} tool calls, ${textBlockCount} text blocks\n`);
    } catch (error) {
      debugLog(`[runner] [native-sdk] ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
      Sentry.captureException(error);
      throw error;
    }
  };
}

export type { TransformedMessage, MessagePart };
