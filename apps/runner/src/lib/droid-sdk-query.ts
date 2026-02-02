/**
 * Factory Droid SDK Integration
 * 
 * This module provides integration with the Factory Droid SDK (droid-sdk)
 * for AI-powered builds. It wraps the DroidSession class and transforms
 * DroidEvents into the standard TransformedMessage format used by the runner.
 * 
 * Enable by setting agent to 'factory-droid' in build requests.
 */

import { DroidSession } from 'droid-sdk';
import type { DroidEvent, DroidSessionOptions } from 'droid-sdk';
import * as Sentry from '@sentry/node';
import { existsSync, mkdirSync } from 'node:fs';
import { ensureProjectSkills } from './skills.js';
import { CLAUDE_SYSTEM_PROMPT } from '@openbuilder/agent-core';

const debugLog = (message: string) => {
  if (process.env.SILENT_MODE !== '1' && process.env.DEBUG_BUILD === '1') {
    console.log(message);
  }
};

interface MessagePart {
  type: string;
  text?: string;
  image?: string;
  mimeType?: string;
  fileName?: string;
}

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
 * Transform a DroidEvent to our internal TransformedMessage format
 */
function transformDroidEvent(event: DroidEvent): TransformedMessage | null {
  switch (event.type) {
    case 'system': {
      // System init event - emit session info
      if (event.subtype === 'init') {
        return {
          type: 'system',
          subtype: 'init',
          session_id: event.session_id,
        };
      }
      return null;
    }

    case 'message': {
      // Message events from assistant
      if (event.role === 'assistant') {
        let text = event.text || '';
        
        // Filter out TodoWrite JSON that might be embedded in message text
        // The droid CLI sometimes echoes the todo list as JSON in its message
        if (text.includes('[{"activeForm"') || text.includes('[{"content"')) {
          // Try to remove JSON array that looks like todos
          text = text.replace(/\[(\s*\{[^[\]]*"(activeForm|content|status)"[^[\]]*\}\s*,?\s*)+\]/g, '').trim();
        }
        
        // Skip empty messages after filtering
        if (!text) {
          return null;
        }
        
        return {
          type: 'assistant',
          message: {
            id: event.id,
            content: [{ type: 'text', text }],
          },
        };
      }
      return null;
    }

    case 'tool_call': {
      // Tool call events - map to tool_use format
      let input = event.parameters;
      
      // Special handling for TodoWrite - droid CLI may send different formats,
      // but UI expects array format: { todos: [{ content, status, activeForm? }] }
      if (event.toolName === 'TodoWrite' && input) {
        const rawInput = input as { todos?: unknown };
        
        // Case 1: todos is already an array (pass through with normalization)
        if (Array.isArray(rawInput.todos)) {
          const normalizedTodos = rawInput.todos.map((item: { content?: string; activeForm?: string; status?: string }) => ({
            content: item.content || item.activeForm || 'Untitled task',
            status: item.status || 'pending',
            activeForm: item.activeForm,
          }));
          input = { todos: normalizedTodos };
          process.stderr.write(`[runner] [droid-sdk] TodoWrite: ${normalizedTodos.length} todos (already array)\n`);
        }
        // Case 2: todos is a string (needs parsing)
        else if (typeof rawInput.todos === 'string') {
          const rawTodos = rawInput.todos;
          let parsedTodos: Array<{ content: string; status: string; activeForm?: string }> = [];
          
          // Try to parse as JSON first (droid may send serialized array)
          const trimmed = rawTodos.trim();
          if (trimmed.startsWith('[')) {
            try {
              const jsonParsed = JSON.parse(trimmed);
              if (Array.isArray(jsonParsed)) {
                parsedTodos = jsonParsed.map((item: { content?: string; activeForm?: string; status?: string }) => ({
                  content: item.content || item.activeForm || 'Untitled task',
                  status: item.status || 'pending',
                  activeForm: item.activeForm,
                }));
                process.stderr.write(`[runner] [droid-sdk] TodoWrite: ${parsedTodos.length} todos parsed from JSON string\n`);
              }
            } catch {
              // Not valid JSON, fall through to line-by-line parsing
            }
          }
          
          // If JSON parsing didn't work, try numbered format: "1. [completed] Task"
          if (parsedTodos.length === 0) {
            const lines = rawTodos.split('\n').filter((l: string) => l.trim());
            parsedTodos = lines.map((line: string) => {
              const match = line.match(/^\d+\.\s*\[(\w+)\]\s*(.+)$/);
              if (match) {
                return {
                  content: match[2].trim(),
                  status: match[1].toLowerCase(),
                };
              }
              return {
                content: line.replace(/^\d+\.\s*/, '').trim(),
                status: 'pending',
              };
            });
            process.stderr.write(`[runner] [droid-sdk] TodoWrite: ${parsedTodos.length} todos parsed from numbered format\n`);
          }
          
          input = { todos: parsedTodos };
        }
      }
      
      return {
        type: 'assistant',
        message: {
          id: event.messageId,
          content: [{
            type: 'tool_use',
            id: event.toolId,
            name: event.toolName,
            input,
          }],
        },
      };
    }

    case 'tool_result': {
      // Tool result events - map to tool_result format
      return {
        type: 'user',
        message: {
          id: event.messageId,
          content: [{
            type: 'tool_result',
            tool_use_id: event.toolId,
            content: event.value,
            is_error: event.isError,
          }],
        },
      };
    }

    case 'completion': {
      // Completion event - final result
      return {
        type: 'result',
        result: event.finalText,
        session_id: event.session_id,
        usage: {
          numTurns: event.numTurns,
          durationMs: event.durationMs,
        },
      };
    }

    default:
      return null;
  }
}

/**
 * Create a Factory Droid query function
 * 
 * This implements the same BuildQueryFn interface as createNativeClaudeQuery
 * but uses the Factory Droid SDK instead.
 */
export function createDroidQuery(modelId?: string) {
  return async function* droidQuery(
    prompt: string,
    workingDirectory: string,
    systemPrompt: string,
    _agent?: string,
    _codexThreadId?: string,
    _messageParts?: MessagePart[]
  ): AsyncGenerator<TransformedMessage, void, unknown> {
    debugLog('[runner] [droid-sdk] Starting Factory Droid query');
    debugLog(`[runner] [droid-sdk] Model: ${modelId || 'default'}`);
    debugLog(`[runner] [droid-sdk] Working dir: ${workingDirectory}`);
    debugLog(`[runner] [droid-sdk] Prompt length: ${prompt.length}`);

    // Build combined system prompt
    const systemPromptSegments: string[] = [CLAUDE_SYSTEM_PROMPT.trim()];
    if (systemPrompt && systemPrompt.trim().length > 0) {
      systemPromptSegments.push(systemPrompt.trim());
    }
    const combinedSystemPrompt = systemPromptSegments.join('\n\n');

    // Ensure working directory exists
    if (!existsSync(workingDirectory)) {
      console.log(`[droid-sdk] Creating working directory: ${workingDirectory}`);
      mkdirSync(workingDirectory, { recursive: true });
    }

    // Ensure project has skills
    ensureProjectSkills(workingDirectory);

    // Configure DroidSession options
    const sessionOptions: DroidSessionOptions = {
      model: modelId,
      cwd: workingDirectory,
      autonomyLevel: 'high',
      systemPrompt: combinedSystemPrompt,
    };

    // Force log to stderr so it shows in TUI mode
    process.stderr.write(`[runner] [droid-sdk] Creating DroidSession with model=${modelId || 'default'}, cwd=${workingDirectory}\n`);
    const session = new DroidSession(sessionOptions);

    // Listen for error events from the session (these bubble up from the child process)
    session.on('error', (err: Error) => {
      process.stderr.write(`[runner] [droid-sdk] Session error event: ${err.message}\n`);
      if (err.stack) {
        process.stderr.write(`[runner] [droid-sdk] Stack: ${err.stack}\n`);
      }
    });

    session.on('close', (code: number | null) => {
      process.stderr.write(`[runner] [droid-sdk] Session closed with code: ${code}\n`);
    });

    let messageCount = 0;
    let toolCallCount = 0;
    let lastEventType = '';

    try {
      process.stderr.write(`[runner] [droid-sdk] Sending prompt to Droid (${prompt.length} chars)\n`);

      // Stream events from the Droid SDK
      for await (const event of session.send(prompt)) {
        messageCount++;
        lastEventType = event.type;

        // Log every event type to track progress
        if (event.type === 'tool_call') {
          toolCallCount++;
          process.stderr.write(`[runner] [droid-sdk] Event #${messageCount}: tool_call - ${(event as { toolName: string }).toolName}\n`);
        } else if (event.type === 'tool_result') {
          const toolResult = event as { isError?: boolean; value?: string };
          const status = toolResult.isError ? 'ERROR' : 'OK';
          const preview = (toolResult.value || '').substring(0, 50);
          process.stderr.write(`[runner] [droid-sdk] Event #${messageCount}: tool_result [${status}] ${preview}...\n`);
        } else {
          process.stderr.write(`[runner] [droid-sdk] Event #${messageCount}: ${event.type}\n`);
        }

        // Transform Droid event to our internal format
        const transformed = transformDroidEvent(event);

        if (transformed) {
          yield transformed;
        }

        // Log completion
        if (event.type === 'completion') {
          process.stderr.write(`[runner] [droid-sdk] ✅ Query complete - ${(event as { numTurns: number }).numTurns} turns, ${(event as { durationMs: number }).durationMs}ms\n`);
        }
      }

      process.stderr.write(`[runner] [droid-sdk] Stream finished - ${messageCount} events, ${toolCallCount} tool calls, last event: ${lastEventType}\n`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      // Force write to stderr to bypass TUI silent mode
      process.stderr.write(`\n[runner] [droid-sdk] ❌ Error: ${errorMessage}\n`);
      process.stderr.write(`[runner] [droid-sdk] Stack: ${errorStack}\n`);
      process.stderr.write(`[runner] [droid-sdk] Model: ${modelId || 'default'}\n`);
      process.stderr.write(`[runner] [droid-sdk] Working dir: ${workingDirectory}\n`);
      process.stderr.write(`[runner] [droid-sdk] Events received: ${messageCount}\n`);
      process.stderr.write(`[runner] [droid-sdk] Tool calls: ${toolCallCount}\n`);
      process.stderr.write(`[runner] [droid-sdk] Last event type: ${lastEventType}\n\n`);
      Sentry.captureException(error, {
        extra: {
          modelId,
          workingDirectory,
          promptLength: prompt.length,
          eventsReceived: messageCount,
          toolCalls: toolCallCount,
        }
      });
      throw error;
    } finally {
      // Cleanup session
      await session.close();
    }
  };
}

export type { TransformedMessage, MessagePart };
