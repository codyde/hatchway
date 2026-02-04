/**
 * OpenCode SDK Integration
 * 
 * This module provides integration with the OpenCode service for AI-powered builds.
 * It replaces the direct Claude Agent SDK integration with a client-server model
 * that supports multiple AI providers.
 * 
 * Architecture:
 * - Runner connects to OpenCode Service via HTTP/SSE
 * - OpenCode Service handles AI provider calls and tool execution
 * - Runner receives events and transforms them to SSE format for the frontend
 */

import * as Sentry from '@sentry/node';
import { existsSync, mkdirSync } from 'node:fs';
import {
  CLAUDE_SYSTEM_PROMPT,
  type OpenCodeModelId,
  DEFAULT_OPENCODE_MODEL_ID,
  normalizeModelId,
  parseModelId,
} from '@hatchway/agent-core';
import { ensureProjectSkills } from './skills.js';

// Debug logging helper
const debugLog = (message: string) => {
  if (process.env.SILENT_MODE !== '1' && process.env.DEBUG_BUILD === '1') {
    console.error(message);
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
 * Get OpenCode service URL
 */
function getOpenCodeUrl(): string {
  const url = process.env.OPENCODE_URL;
  if (url) return url;
  
  // Default to localhost in development/local mode
  if (process.env.HATCHWAY_LOCAL_MODE === 'true' || process.env.NODE_ENV === 'development') {
    return 'http://localhost:4096';
  }
  
  throw new Error('OPENCODE_URL environment variable is required');
}

/**
 * Get authentication token for OpenCode service
 */
function getAuthToken(): string | null {
  // Try runner key first
  const runnerKey = process.env.HATCHWAY_RUNNER_KEY;
  if (runnerKey) return runnerKey;
  
  // Fall back to shared secret
  const sharedSecret = process.env.RUNNER_SHARED_SECRET;
  if (sharedSecret) return sharedSecret;
  
  // Local mode doesn't require auth
  if (process.env.HATCHWAY_LOCAL_MODE === 'true') {
    return null;
  }
  
  return null;
}

/**
 * Transform OpenCode SSE event to our internal message format
 */
function transformOpenCodeEvent(event: any, sessionId: string): TransformedMessage | null {
  switch (event.type) {
    case 'message.created':
    case 'message.updated': {
      const message = event.properties?.message;
      if (!message) return null;
      
      if (message.role === 'assistant') {
        const parts = event.properties.parts || [];
        return {
          type: 'assistant',
          message: {
            id: message.id || `msg-${Date.now()}`,
            content: parts.map((part: any) => {
              if (part.type === 'text') {
                return { type: 'text', text: part.text };
              } else if (part.type === 'tool-invocation') {
                return {
                  type: 'tool_use',
                  id: part.toolInvocationId,
                  name: part.toolName,
                  input: part.input,
                };
              }
              return part;
            }),
          },
        };
      }
      return null;
    }
    
    case 'part.created':
    case 'part.updated': {
      const part = event.properties;
      if (!part) return null;
      
      // Text parts
      if (part.type === 'text' && part.text) {
        return {
          type: 'assistant',
          message: {
            id: `part-${Date.now()}`,
            content: [{ type: 'text', text: part.text }],
          },
        };
      }
      
      // Tool invocation start
      if (part.type === 'tool-invocation' && part.state === 'pending') {
        return {
          type: 'assistant',
          message: {
            id: `tool-${part.toolInvocationId}`,
            content: [{
              type: 'tool_use',
              id: part.toolInvocationId,
              name: part.toolName,
              input: part.input,
            }],
          },
        };
      }
      
      // Tool result
      if (part.type === 'tool-invocation' && part.state === 'result') {
        return {
          type: 'user',
          message: {
            id: `result-${part.toolInvocationId}`,
            content: [{
              type: 'tool_result',
              tool_use_id: part.toolInvocationId,
              content: typeof part.result === 'string' ? part.result : JSON.stringify(part.result),
              is_error: part.isError || false,
            }],
          },
        };
      }
      
      return null;
    }
    
    case 'session.completed': {
      return {
        type: 'result',
        result: 'completed',
        session_id: sessionId,
        subtype: 'success',
      };
    }
    
    case 'session.error': {
      return {
        type: 'result',
        result: event.properties?.error || 'Unknown error',
        session_id: sessionId,
        subtype: 'error',
      };
    }
    
    case 'session.aborted': {
      return {
        type: 'result',
        result: 'aborted',
        session_id: sessionId,
        subtype: 'aborted',
      };
    }
    
    default:
      return null;
  }
}

/**
 * Parse SSE data from event stream
 */
function parseSSEEvent(data: string): any | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Create OpenCode query function
 * 
 * This function connects to the OpenCode service, creates a session,
 * sends the prompt, and streams the response events.
 */
export function createOpenCodeQuery(
  modelId: OpenCodeModelId = DEFAULT_OPENCODE_MODEL_ID
) {
  return async function* openCodeQuery(
    prompt: string,
    workingDirectory: string,
    systemPrompt: string,
    _agent?: string,
    _codexThreadId?: string,
    messageParts?: MessagePart[]
  ): AsyncGenerator<TransformedMessage, void, unknown> {
    debugLog('[runner] [opencode-sdk] Starting OpenCode query');
    debugLog(`[runner] [opencode-sdk] Model: ${modelId}`);
    debugLog(`[runner] [opencode-sdk] Working dir: ${workingDirectory}`);
    debugLog(`[runner] [opencode-sdk] Prompt length: ${prompt.length}`);

    // Ensure working directory exists
    if (!existsSync(workingDirectory)) {
      console.log(`[opencode-sdk] Creating working directory: ${workingDirectory}`);
      mkdirSync(workingDirectory, { recursive: true });
    }
    
    // Ensure project has skills
    ensureProjectSkills(workingDirectory);

    const baseUrl = getOpenCodeUrl();
    const authToken = getAuthToken();
    
    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Build combined system prompt
    const systemPromptSegments: string[] = [CLAUDE_SYSTEM_PROMPT.trim()];
    if (systemPrompt && systemPrompt.trim().length > 0) {
      systemPromptSegments.push(systemPrompt.trim());
    }
    const combinedSystemPrompt = systemPromptSegments.join('\n\n');

    // Parse model ID
    const { provider: providerID, model: modelID } = parseModelId(normalizeModelId(modelId));
    
    let sessionId: string | null = null;
    
    // Start Sentry AI agent span for the entire OpenCode query
    // This provides visibility into AI operations in Sentry's trace view
    const aiSpan = Sentry.startInactiveSpan({
      name: 'opencode.query',
      op: 'ai.pipeline',
      attributes: {
        'ai.pipeline.name': 'opencode',
        'ai.model_id': `${providerID}/${modelID}`,
        'ai.provider': providerID,
        'ai.streaming': true,
        'gen_ai.system': 'opencode',
        'gen_ai.request.model': modelID,
      },
    });

    try {
      // Step 1: Create a session
      debugLog('[runner] [opencode-sdk] Creating session...');
      const sessionResponse = await fetch(`${baseUrl}/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: `Build ${Date.now()}`,
        }),
      });

      if (!sessionResponse.ok) {
        const error = await sessionResponse.text();
        throw new Error(`Failed to create session: ${sessionResponse.status} ${error}`);
      }

      const session = await sessionResponse.json();
      sessionId = session.id;
      debugLog(`[runner] [opencode-sdk] Session created: ${sessionId}`);
      
      // Update span with session info
      if (sessionId) {
        aiSpan?.setAttribute('opencode.session_id', sessionId);
      }

      // Step 2: Subscribe to events
      debugLog('[runner] [opencode-sdk] Subscribing to events...');
      const eventResponse = await fetch(`${baseUrl}/event`, {
        headers: {
          ...headers,
          'Accept': 'text/event-stream',
        },
      });

      if (!eventResponse.ok) {
        throw new Error(`Failed to subscribe to events: ${eventResponse.status}`);
      }

      // Step 3: Build message parts
      const parts: Array<{ type: string; text?: string; image?: string; mimeType?: string }> = [];
      
      // Add images first if present
      if (messageParts) {
        for (const part of messageParts) {
          if (part.type === 'image' && part.image) {
            parts.push({
              type: 'image',
              image: part.image,
              mimeType: part.mimeType || 'image/png',
            });
            debugLog('[runner] [opencode-sdk] Added image part');
          }
        }
      }
      
      // Add text prompt
      parts.push({
        type: 'text',
        text: prompt,
      });

      // Step 4: Send the prompt (don't await - we'll stream the response)
      debugLog('[runner] [opencode-sdk] Sending prompt...');
      const promptPromise = fetch(`${baseUrl}/session/${sessionId}/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: { providerID, modelID },
          system: combinedSystemPrompt,
          parts,
        }),
      });

      // Step 5: Process event stream
      const reader = eventResponse.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      let toolCallCount = 0;
      let messageCount = 0;

      try {
        while (!completed) {
          const { done, value } = await reader.read();
          
          if (done) {
            debugLog('[runner] [opencode-sdk] Event stream ended');
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          
          // Process complete SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              const event = parseSSEEvent(data);
              
              if (!event) continue;
              
              // Only process events for our session
              // Skip events that have a sessionId that doesn't match ours
              // Also skip events with no sessionId unless they reference our session in properties
              const eventSessionId = event.properties?.sessionId || event.properties?.session?.id;
              if (eventSessionId && eventSessionId !== sessionId) {
                continue; // Event belongs to a different session
              }
              if (!eventSessionId && sessionId) {
                // Event has no session identifier - skip it to avoid cross-session contamination
                // unless it's a global event type we explicitly want to handle
                const globalEventTypes = ['ping', 'connected', 'error'];
                if (!globalEventTypes.includes(event.type)) {
                  continue;
                }
              }

              const transformed = transformOpenCodeEvent(event, sessionId!);
              if (transformed) {
                // Track tool calls and messages for span metrics
                if (transformed.type === 'assistant' && transformed.message?.content) {
                  messageCount++;
                  for (const content of transformed.message.content) {
                    if (content.type === 'tool_use') {
                      toolCallCount++;
                    }
                  }
                }
                
                yield transformed;
                
                // Check for completion
                if (transformed.type === 'result') {
                  completed = true;
                  break;
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Ensure prompt request completed
      const promptResponse = await promptPromise;
      if (!promptResponse.ok) {
        const error = await promptResponse.text();
        console.error(`[opencode-sdk] Prompt request failed: ${error}`);
      }

      // Yield final result if not already done
      if (!completed) {
        yield {
          type: 'result',
          result: 'completed',
          session_id: sessionId ?? undefined,
          subtype: 'success',
        };
      }

      debugLog('[runner] [opencode-sdk] Query complete');
      
      // Update span with final metrics
      aiSpan?.setAttribute('opencode.tool_calls', toolCallCount);
      aiSpan?.setAttribute('opencode.messages', messageCount);
      aiSpan?.setStatus({ code: 1 }); // OK status

    } catch (error) {
      debugLog(`[runner] [opencode-sdk] Error: ${error instanceof Error ? error.message : String(error)}`);
      Sentry.captureException(error);
      
      // Mark span as errored
      aiSpan?.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
      
      // Yield error result
      yield {
        type: 'result',
        result: error instanceof Error ? error.message : String(error),
        session_id: sessionId || undefined,
        subtype: 'error',
      };
      
      throw error;
    } finally {
      // End the AI span
      aiSpan?.end();
    }
  };
}

/**
 * Feature flag to control which implementation to use
 * 
 * Default: Claude Agent SDK (native)
 * Set ENABLE_OPENCODE_SDK=true to enable OpenCode multi-provider support
 * Note: OPENCODE_URL must also be set to the OpenCode service URL
 */
export const ENABLE_OPENCODE_SDK = process.env.ENABLE_OPENCODE_SDK === 'true' && !!process.env.OPENCODE_URL;

export type { TransformedMessage, MessagePart };
