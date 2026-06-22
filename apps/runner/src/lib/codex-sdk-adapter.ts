/**
 * Adapter to transform Codex SDK events into the unified format expected by message transformer
 *
 * Codex SDK uses a different event structure than AI SDK:
 * - thread.runStreamed().events yields ThreadEvent types
 * - We need to transform these to match our unified message format
 *
 * This allows the frontend to work with both Claude (AI SDK) and Codex (Codex SDK)
 * without knowing the difference.
 */

import { fileLog, streamLog } from './file-logger.js';

// Use Codex SDK's actual event type (it's a union of various event types)
// Since we can't import types from Codex SDK directly, we use a flexible type
type CodexThreadEvent = {
  type: string;
  item?: {
    type?: string;
    id?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number;
    status?: string;
    changes?: unknown[];
    // MCP tool call fields
    server?: string;
    tool?: string;
    query?: unknown;
    arguments?: unknown;
    // Web search fields
    search_query?: string;
    results?: unknown[];
    // Error fields
    error?: string;
    error_type?: string;
    error_code?: string;
    stack?: string;
    message?: string;
    // Todo list fields
    items?: unknown[];
    [key: string]: unknown;
  };
  thread_id?: string;
  usage?: unknown;
  finalResponse?: string;
  error?: unknown;
  message?: string;
  [key: string]: unknown;
}

interface TransformedMessage {
  type: 'assistant' | 'user';
  message: {
    id: string;
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: any;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>;
  };
}

/**
 * Extract item type from Codex event
 */
function getItemType(item: CodexThreadEvent['item']): string {
  if (!item) return '';
  if (typeof item.type === 'string') return item.type;
  return '';
}

/**
 * Extract tool call ID from item
 */
function getToolId(item: CodexThreadEvent['item']): string {
  if (!item) return `tool-${Date.now()}`;
  const candidates = ['id', 'tool_call_id', 'item_id'];
  for (const key of candidates) {
    const value = item[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return `tool-${Date.now()}`;
}

/**
 * Extract tool input from item
 */
function getToolInput(item: CodexThreadEvent['item']): any {
  if (!item) return {};
  const candidates = ['arguments', 'args', 'input'];
  for (const key of candidates) {
    const value = item[key];
    if (value !== undefined) return value;
  }
  return {};
}

/**
 * Extract tool output from item
 */
function getToolOutput(item: CodexThreadEvent['item']): any {
  if (!item) return null;
  const candidates = ['aggregated_output', 'output', 'result', 'content'];
  for (const key of candidates) {
    const value = item[key];
    if (value !== undefined) return value;
  }
  return null;
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

/**
 * Helper to extract just the filename from a path
 */
function getBasename(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Convert JavaScript object notation to strict JSON
 * Handles unquoted keys like: { todos: [...] } → { "todos": [...] }
 */
function convertJSObjectToJSON(text: string): string {
  // Replace unquoted keys with quoted keys
  // Match pattern: word characters followed by colon (but not inside strings)
  return text.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
}

/**
 * Extract JSON with balanced braces starting from a position
 * Returns the JSON string and the end position, or null if invalid
 */
function extractBalancedJson(text: string, startPos: number): { json: string; endPos: number } | null {
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let startBraceFound = false;

  for (let i = startPos; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      if (!startBraceFound) startBraceFound = true;
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0 && startBraceFound) {
        // Found matching closing brace
        return {
          json: text.substring(startPos, i + 1),
          endPos: i + 1
        };
      }
    }
  }

  return null; // No matching brace found
}

/**
 * Extract TodoWrite calls from Codex text and convert to TODO_WRITE marker format
 *
 * Codex outputs: TodoWrite({ "todos": [...] })
 * We need: TODO_WRITE : {"todos": [...]}
 *
 * This allows the message transformer to recognize and process todo updates
 */
function extractAndConvertTodoWrite(text: string): string {
  if (!text) return text;

  let result = text;
  const replacements: Array<{ original: string; replacement: string; startPos: number }> = [];

  // Find all TodoWrite occurrences
  const todoWritePattern = /TodoWrite\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = todoWritePattern.exec(text)) !== null) {
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    // Extract balanced JSON starting after the opening paren
    const extracted = extractBalancedJson(text, matchEnd);

    if (!extracted) {
      streamLog.warn(`[Codex Adapter] Failed to find matching braces for TodoWrite at position ${matchStart}`);
      continue;
    }

    // Check if there's a closing paren after the JSON
    const nextChar = text[extracted.endPos];
    if (nextChar !== ')') {
      streamLog.warn(`[Codex Adapter] Expected ')' after TodoWrite JSON at position ${extracted.endPos}`);
      continue;
    }

    const jsonText = extracted.json;
    const fullMatch = text.substring(matchStart, extracted.endPos + 1);

    try {
      // Convert JS object notation to strict JSON (handles unquoted keys)
      const strictJSON = convertJSObjectToJSON(jsonText);

      // Validate that it's valid JSON
      const parsed = JSON.parse(strictJSON);

      // Check if it has the expected todos structure
      if (parsed.todos && Array.isArray(parsed.todos)) {
        // Validate todos have required fields
        const validTodos = parsed.todos.filter((t: any) =>
          t && typeof t === 'object' && (t.content || t.activeForm)
        );

        if (validTodos.length > 0) {
          // Convert to TODO_WRITE marker format using STRICT JSON
          const todoWriteMarker = `TODO_WRITE : ${strictJSON}`;
          replacements.push({ original: fullMatch, replacement: todoWriteMarker, startPos: matchStart });

          streamLog.info(`[Codex Adapter] Extracted TodoWrite with ${validTodos.length} todos`);
          streamLog.info(`[Codex Adapter] JSON length: ${strictJSON.length} chars`);
          streamLog.info(`[Codex Adapter] First todo: ${JSON.stringify(validTodos[0])}`);
        } else {
          streamLog.warn('[Codex Adapter] TodoWrite has no valid todos, skipping');
        }
      }
    } catch (error) {
      // If JSON is invalid, leave it as-is
      streamLog.warn('[Codex Adapter] Failed to parse TodoWrite JSON:', error);
      streamLog.warn('[Codex Adapter] Original JSON (first 200 chars):', jsonText.substring(0, 200));
      streamLog.warn('[Codex Adapter] Converted JSON (first 200 chars):', convertJSObjectToJSON(jsonText).substring(0, 200));
    }
  }

  // Apply all replacements in reverse order to preserve positions
  for (const { original, replacement } of replacements.reverse()) {
    result = result.replace(original, replacement);
  }

  // ALSO extract from JSON code blocks: ```json\n{"todos":[...]}\n```
  const codeBlockPattern = /```json\s*\n([\s\S]*?)\n```/g;
  let codeBlockMatch: RegExpExecArray | null;

  while ((codeBlockMatch = codeBlockPattern.exec(result)) !== null) {
    const jsonText = codeBlockMatch[1].trim();

    try {
      // Convert JS object notation to strict JSON
      const strictJSON = convertJSObjectToJSON(jsonText);
      const parsed = JSON.parse(strictJSON);

      // Check if it's a todos array (with or without wrapper)
      const todosArray = parsed.todos || (Array.isArray(parsed) ? parsed : null);

      if (todosArray && Array.isArray(todosArray)) {
        const validTodos = todosArray.filter((t: any) =>
          t && typeof t === 'object' && (t.content || t.activeForm)
        );

        if (validTodos.length > 0) {
          // Convert code block to TODO_WRITE marker
          const todoWriteMarker = `TODO_WRITE : ${JSON.stringify({ todos: validTodos })}`;
          result = result.replace(codeBlockMatch[0], todoWriteMarker);

          streamLog.info(`[Codex Adapter] Extracted ${validTodos.length} todos from JSON code block`);
          streamLog.info(`[Codex Adapter] First todo: ${JSON.stringify(validTodos[0])}`);
        }
      }
    } catch (error) {
      // Not a valid todos structure, leave code block as-is
      streamLog.warn('[Codex Adapter] Code block is not valid todos JSON:', error);
    }
  }

  // ALSO extract standalone JSON objects: {"todos":[...]}
  // Codex often outputs these directly without TodoWrite() wrapper or code blocks
  // Look for objects that start with {"todos" (more specific than just any brace)
  const standaloneJsonPattern = /\{\s*["']?todos["']?\s*:/g;
  let jsonMatch: RegExpExecArray | null;
  const standaloneReplacements: Array<{ original: string; replacement: string }> = [];

  while ((jsonMatch = standaloneJsonPattern.exec(result)) !== null) {
    // Start position is the opening brace (first character of the match)
    const startPos = jsonMatch.index;
    
    // Try to extract balanced JSON starting from the brace
    const extracted = extractBalancedJson(result, startPos);
    
    if (!extracted) {
      continue;
    }

    try {
      // Convert JS object notation to strict JSON
      const strictJSON = convertJSObjectToJSON(extracted.json);
      const parsed = JSON.parse(strictJSON);

      // Check if it's a todos structure
      if (parsed.todos && Array.isArray(parsed.todos)) {
        const validTodos = parsed.todos.filter((t: any) =>
          t && typeof t === 'object' && (t.content || t.activeForm)
        );

        if (validTodos.length > 0) {
          // Convert to TODO_WRITE marker
          const todoWriteMarker = `TODO_WRITE : ${JSON.stringify({ todos: validTodos })}`;
          standaloneReplacements.push({
            original: extracted.json,
            replacement: todoWriteMarker
          });

          streamLog.info(`[Codex Adapter] Extracted ${validTodos.length} todos from standalone JSON`);
          streamLog.info(`[Codex Adapter] First todo: ${JSON.stringify(validTodos[0])}`);
        }
      }
    } catch (error) {
      // Not valid JSON or not a todos structure, continue searching
      continue;
    }
  }

  // Apply standalone replacements
  for (const { original, replacement } of standaloneReplacements) {
    result = result.replace(original, replacement);
  }

  return result;
}

/**
 * Transform Codex SDK event stream to unified message format
 *
 * IMPORTANT: This function must consume the entire event stream directly from
 * thread.runStreamed().events. Do NOT wrap individual events in intermediate
 * generators — that breaks the streaming async context the SDK relies on.
 *
 * ✅ Correct:   transformCodexStream(streamedTurn.events)
 * ❌ Incorrect: for (event of events) { transformCodexStream(singleEvent()) }
 *
 * @param stream AsyncIterable of ThreadEvent from Codex SDK
 */
export async function* transformCodexStream(
  stream: AsyncIterable<any> // Use any to avoid type conflicts with Codex SDK's ThreadEvent union
): AsyncGenerator<TransformedMessage, void, unknown> {
  let currentMessageId = `codex-${Date.now()}`;
  let eventCount = 0;
  let yieldCount = 0;

  // Track in-progress tools to match started → completed events
  const inProgressTools = new Map<string, {
    type: string;
    command?: string;
    changes?: any[];
  }>();

  streamLog.info('━━━ CODEX STREAM TRANSFORMATION STARTED ━━━');

  for await (const event of stream) {
    eventCount++;

    // Log first 50 events
    if (eventCount <= 50) {
      streamLog.event(eventCount, event.type, event);
    }

    const itemType = getItemType(event.item);

    // Handle different Codex event types
    switch (event.type) {
      case 'item.started': {
        // Tool execution started - emit tool call
        if (!event.item) break;

        const toolId = getToolId(event.item);
        const itemType = event.item.type;

        if (itemType === 'command_execution') {
          const fullCommand = event.item.command || '';
          const displayCommand = simplifyCommand(fullCommand);
          
          // Store tool info for matching with completion
          inProgressTools.set(toolId, {
            type: 'command_execution',
            command: fullCommand,
          });

          // Emit tool call immediately with simplified command for display
          const toolMessage: TransformedMessage = {
            type: 'assistant',
            message: {
              id: `${currentMessageId}-tool-${toolId}`,
              content: [{
                type: 'tool_use',
                id: toolId,
                name: 'Bash',
                input: { command: displayCommand },
              }],
            },
          };

          yieldCount++;
          streamLog.yield('tool-call-start', { toolName: 'Bash', toolId, command: displayCommand });
          yield toolMessage;
        } else if (itemType === 'file_change') {
          // Store file change info
          const changes = event.item.changes || [];
          inProgressTools.set(toolId, {
            type: 'file_change',
            changes,
          });

          // Emit tool call immediately with simplified paths for display
          const displayPaths = changes.map((c: any) => getBasename(c.path)).join(', ');
          const toolMessage: TransformedMessage = {
            type: 'assistant',
            message: {
              id: `${currentMessageId}-tool-${toolId}`,
              content: [{
                type: 'tool_use',
                id: toolId,
                name: 'Write',
                input: { paths: displayPaths },
              }],
            },
          };

          yieldCount++;
          streamLog.yield('tool-call-start', { toolName: 'Write', toolId, paths: displayPaths });
          yield toolMessage;
        } else if (itemType === 'mcp_tool_call') {
          // MCP tool call started
          const mcpToolName = event.item.tool || event.item.server || 'MCPTool';
          const mcpQuery = event.item.query || event.item.arguments || {};
          
          inProgressTools.set(toolId, {
            type: 'mcp_tool_call',
          });

          // Emit tool call immediately
          const toolMessage: TransformedMessage = {
            type: 'assistant',
            message: {
              id: `${currentMessageId}-tool-${toolId}`,
              content: [{
                type: 'tool_use',
                id: toolId,
                name: mcpToolName,
                input: mcpQuery,
              }],
            },
          };

          yieldCount++;
          streamLog.yield('tool-call-start', { 
            toolName: mcpToolName, 
            toolId, 
            server: event.item.server,
            tool: event.item.tool,
          });
          yield toolMessage;
        } else if (itemType === 'web_search') {
          // Web search started
          const searchQuery = event.item.query || event.item.search_query || '';
          
          inProgressTools.set(toolId, {
            type: 'web_search',
          });

          // Emit tool call immediately
          const toolMessage: TransformedMessage = {
            type: 'assistant',
            message: {
              id: `${currentMessageId}-tool-${toolId}`,
              content: [{
                type: 'tool_use',
                id: toolId,
                name: 'WebSearch',
                input: { query: searchQuery },
              }],
            },
          };

          yieldCount++;
          streamLog.yield('tool-call-start', { 
            toolName: 'WebSearch', 
            toolId, 
            query: searchQuery,
          });
          yield toolMessage;
        }

        // Update message ID
        if (event.item) {
          currentMessageId = `codex-${Date.now()}-${toolId}`;
        }
        break;
      }

      case 'turn.started':
        // New turn started
        if (event.item) {
          currentMessageId = `codex-${Date.now()}-${getToolId(event.item)}`;
        }
        break;

      case 'item.completed': {
        // Tool execution completed - emit tool result only
        if (!event.item) break;

        const itemType = event.item.type;
        const toolId = getToolId(event.item);

        // Handle different Codex item types
        if (itemType === 'command_execution') {
          // Command execution completed - emit result
          const toolInfo = inProgressTools.get(toolId);

          // If we didn't track the start (shouldn't happen), emit the tool call now
          if (!toolInfo) {
            streamLog.warn(`[Codex Adapter] Tool ${toolId} completed without start event, emitting both`);
            const toolMessage: TransformedMessage = {
              type: 'assistant',
              message: {
                id: `${currentMessageId}-tool-${toolId}`,
                content: [{
                  type: 'tool_use',
                  id: toolId,
                  name: 'Bash',
                  input: { command: event.item.command },
                }],
              },
            };
            yieldCount++;
            yield toolMessage;
          }

          // Emit result
          let output = event.item.aggregated_output || '';

          // CRITICAL: Extract TodoWrite from bash command outputs
          // Codex doesn't have TodoWrite as a tool, so it uses printf/echo to output it

          // FIRST: Check for raw JSON from Codex's custom todo scripts
          // Format: {"todos": [{"content": "...", "status": "...", "activeForm": ""}]}
          const rawJsonMatch = output.match(/\{"todos":\s*\[[\s\S]*?\]\}/);
          if (rawJsonMatch) {
            try {
              const parsed = JSON.parse(rawJsonMatch[0]);
              if (parsed.todos && Array.isArray(parsed.todos)) {
                streamLog.info(`[Codex Adapter] 🎯 Found raw JSON in bash output: ${parsed.todos.length} todos`);

                // Emit as TodoWrite so persistent processor tracks it
                const todoWriteMessage: TransformedMessage = {
                  type: 'assistant',
                  message: {
                    id: currentMessageId,
                    content: [{
                      type: 'tool_use',
                      id: `bash-todo-${toolId}`,
                      name: 'TodoWrite',
                      input: { todos: parsed.todos },
                    }],
                  },
                };

                yieldCount++;
                streamLog.yield('bash-json-todo', { toolId, count: parsed.todos.length });
                yield todoWriteMessage;

                streamLog.info('[Codex Adapter] ✅ Converted bash JSON to TodoWrite');
              }
            } catch (error) {
              streamLog.warn('[Codex Adapter] Failed to parse JSON from bash output:', error);
            }
          }

          // SECOND: Check for TodoWrite({...}) format
          const extractedTodoWrite = extractAndConvertTodoWrite(output);
          if (extractedTodoWrite !== output) {
            // TodoWrite was found and converted, emit as text
            streamLog.info('[Codex Adapter] Extracted TodoWrite function call from bash output');
            const todoTextMessage: TransformedMessage = {
              type: 'assistant',
              message: {
                id: currentMessageId,
                content: [{
                  type: 'text',
                  text: extractedTodoWrite,
                }],
              },
            };
            yieldCount++;
            yield todoTextMessage;
          }

          const resultMessage: TransformedMessage = {
            type: 'user',
            message: {
              id: `result-${toolId}`,
              content: [{
                type: 'tool_result',
                tool_use_id: toolId,
                content: output,
              }],
            },
          };

          yieldCount++;
          streamLog.yield('tool-result', { toolId, output: output.substring(0, 100) });
          yield resultMessage;

          // Clean up tracking
          inProgressTools.delete(toolId);
        } else if (itemType === 'file_change') {
          // File change completed - emit result
          const toolInfo = inProgressTools.get(toolId);
          const changes = event.item.changes || [];
          const paths = changes.map((c: any) => c.path).join(', ');

          // If we didn't track the start (shouldn't happen), emit the tool call now
          if (!toolInfo) {
            streamLog.warn(`[Codex Adapter] Tool ${toolId} completed without start event, emitting both`);
            const toolMessage: TransformedMessage = {
              type: 'assistant',
              message: {
                id: `${currentMessageId}-tool-${toolId}`,
                content: [{
                  type: 'tool_use',
                  id: toolId,
                  name: 'Write',
                  input: { paths: changes },
                }],
              },
            };
            yieldCount++;
            yield toolMessage;
          }

          // Emit result
          const resultMessage: TransformedMessage = {
            type: 'user',
            message: {
              id: `result-${toolId}`,
              content: [{
                type: 'tool_result',
                tool_use_id: toolId,
                content: `File changes applied: ${paths}`,
              }],
            },
          };

          yieldCount++;
          streamLog.yield('tool-result', { toolId, changes });
          yield resultMessage;

          // Clean up tracking
          inProgressTools.delete(toolId);
        } else if (itemType === 'agent_message' || itemType === 'reasoning') {
          // Agent message/reasoning → Text message
          let text = event.item.text as string;
          if (text && text.trim().length > 0) {
            // Strip markdown bold from reasoning (Codex outputs short bolded titles)
            // Convert "**Title**" to just "Title"
            text = text.replace(/^\*\*(.*?)\*\*$/g, '$1').trim();

            // Extract TodoWrite calls and convert to TODO_WRITE markers
            // Codex outputs: TodoWrite({ "todos": [...] })
            // We need: TODO_WRITE : {"todos": [...]}
            text = extractAndConvertTodoWrite(text);

            // Only yield if there's actual content (skip empty or very short reasoning)
            if (text.length > 5) {
              const textMessage: TransformedMessage = {
                type: 'assistant',
                message: {
                  id: currentMessageId,
                  content: [{
                    type: 'text',
                    text: text,
                  }],
                },
              };

              yieldCount++;
              streamLog.yield('text', { length: text.length });
              yield textMessage;
            }
          }
        } else if (itemType === 'todo_list') {
          // Handle explicit todo_list items from Codex
          // These are structured todo updates that should be converted to TodoWrite format
          if (event.item.items && Array.isArray(event.item.items)) {
            const todos = event.item.items.map((item: any) => {
              // Normalize status values to match expected format
              let status = item.status || 'pending';
              // Handle variations: 'in-progress', 'in_progress', 'inprogress'
              if (status.toLowerCase().replace(/[-_\s]/g, '') === 'inprogress') {
                status = 'in_progress';
              }

              return {
                content: item.content || item.description || '',
                activeForm: item.activeForm || item.content || item.description || '',
                status: status as 'pending' | 'in_progress' | 'completed',
              };
            });

            // Validate at least some todos have content
            const validTodos = todos.filter((t: { content: string; activeForm: string; status: string }) =>
              t.content && t.content.length > 0
            );
            if (validTodos.length === 0) {
              streamLog.warn('[Codex Adapter] todo_list has no valid todos, skipping');
              break;
            }

            // Convert to TODO_WRITE marker format
            const todoWriteMarker = `TODO_WRITE : ${JSON.stringify({ todos: validTodos })}`;
            const textMessage: TransformedMessage = {
              type: 'assistant',
              message: {
                id: currentMessageId,
                content: [{
                  type: 'text',
                  text: todoWriteMarker,
                }],
              },
            };

            yieldCount++;
            streamLog.yield('todo-list', { count: validTodos.length });
            streamLog.info(`[Codex Adapter] Converted todo_list to TodoWrite with ${validTodos.length} todos`);
            yield textMessage;
          }
        } else if (itemType === 'mcp_tool_call') {
          // MCP (Model Context Protocol) tool invocation
          const toolInfo = inProgressTools.get(toolId);
          
          // If we didn't track the start, emit the tool call now
          if (!toolInfo) {
            streamLog.info(`[Codex Adapter] MCP tool call ${toolId} completed without start event`);
            const mcpToolName = event.item.tool || event.item.server || 'MCPTool';
            const toolMessage: TransformedMessage = {
              type: 'assistant',
              message: {
                id: `${currentMessageId}-tool-${toolId}`,
                content: [{
                  type: 'tool_use',
                  id: toolId,
                  name: mcpToolName,
                  input: event.item.query || event.item.arguments || {},
                }],
              },
            };
            yieldCount++;
            yield toolMessage;
          }

          // Emit result
          const mcpOutput = getToolOutput(event.item);
          const mcpToolName = event.item.tool;

          // Special handling for todo MCP tools - convert to TodoWrite format
          if (mcpToolName === 'todo-list-tool' || mcpToolName === 'todo-update-tool') {
            try {
              const outputObj = typeof mcpOutput === 'string' ? JSON.parse(mcpOutput) : mcpOutput;

              if (outputObj && outputObj.todos && Array.isArray(outputObj.todos)) {
                streamLog.info(`[Codex Adapter] 🎯 MCP ${mcpToolName} returned ${outputObj.todos.length} todos`);

                // Emit as TodoWrite so persistent processor picks it up
                const todoWriteMessage: TransformedMessage = {
                  type: 'assistant',
                  message: {
                    id: currentMessageId,
                    content: [{
                      type: 'tool_use',
                      id: `mcp-todo-${toolId}`,
                      name: 'TodoWrite',
                      input: { todos: outputObj.todos },
                    }],
                  },
                };

                yieldCount++;
                streamLog.yield('mcp-todo-converted', { toolId, count: outputObj.todos.length });
                yield todoWriteMessage;

                streamLog.info(`[Codex Adapter] ✅ Converted MCP ${mcpToolName} to TodoWrite`);
              }
            } catch (error) {
              streamLog.warn('[Codex Adapter] Failed to parse MCP todo tool output:', error);
            }
          }

          const resultMessage: TransformedMessage = {
            type: 'user',
            message: {
              id: `result-${toolId}`,
              content: [{
                type: 'tool_result',
                tool_use_id: toolId,
                content: typeof mcpOutput === 'string' ? mcpOutput : JSON.stringify(mcpOutput),
              }],
            },
          };

          yieldCount++;
          streamLog.yield('mcp-tool-result', {
            toolId,
            server: event.item.server,
            tool: event.item.tool,
          });
          yield resultMessage;

          // Clean up tracking
          inProgressTools.delete(toolId);
        } else if (itemType === 'web_search') {
          // Web search query and results
          const toolInfo = inProgressTools.get(toolId);
          const searchQuery = event.item.query || event.item.search_query || '';
          
          // If we didn't track the start, emit the tool call now
          if (!toolInfo) {
            streamLog.info(`[Codex Adapter] Web search ${toolId} completed without start event`);
            const toolMessage: TransformedMessage = {
              type: 'assistant',
              message: {
                id: `${currentMessageId}-tool-${toolId}`,
                content: [{
                  type: 'tool_use',
                  id: toolId,
                  name: 'WebSearch',
                  input: { query: searchQuery },
                }],
              },
            };
            yieldCount++;
            yield toolMessage;
          }

          // Emit search results
          const searchResults = event.item.results || event.item.aggregated_output || '';
          const resultMessage: TransformedMessage = {
            type: 'user',
            message: {
              id: `result-${toolId}`,
              content: [{
                type: 'tool_result',
                tool_use_id: toolId,
                content: typeof searchResults === 'string' ? searchResults : JSON.stringify(searchResults),
              }],
            },
          };

          yieldCount++;
          streamLog.yield('web-search-result', { 
            toolId, 
            query: searchQuery,
            result_count: Array.isArray(event.item.results) ? event.item.results.length : 'unknown',
          });
          yield resultMessage;

          // Clean up tracking
          inProgressTools.delete(toolId);
        } else if (itemType === 'error') {
          // Enhanced error handling with detailed context
          const errorMessage = event.item.message || event.item.error || 'Unknown error';
          const errorDetails = {
            message: errorMessage,
            type: event.item.error_type,
            code: event.item.error_code,
            stack: event.item.stack,
          };
          
          streamLog.error('[Codex Adapter] Error item:', errorDetails);
          fileLog.error('Codex error item:', errorDetails);

          // Emit error as text message so frontend can display it
          const errorTextMessage: TransformedMessage = {
            type: 'assistant',
            message: {
              id: currentMessageId,
              content: [{
                type: 'text',
                text: `⚠️ Error: ${errorMessage}`,
              }],
            },
          };

          yieldCount++;
          yield errorTextMessage;
        }

        break;
      }

      case 'turn.completed':
        // Track usage statistics for cost and performance monitoring
        if (event.usage) {
          streamLog.info('Turn usage statistics:', event.usage);
          fileLog.info('Codex turn usage:', {
            usage: event.usage,
            turn_number: eventCount,
          });
        }

        // Turn completed - might have final response text
        if (event.finalResponse && typeof event.finalResponse === 'string') {
          const textMessage: TransformedMessage = {
            type: 'assistant',
            message: {
              id: currentMessageId,
              content: [{
                type: 'text',
                text: event.finalResponse,
              }],
            },
          };

          yieldCount++;
          streamLog.yield('text', { length: event.finalResponse.length });
          yield textMessage;
        }
        break;

      case 'error':
        // Error event
        fileLog.error('Codex stream error:', event.error);
        break;

      default:
        // Log unknown event types
        if (eventCount <= 20) {
          fileLog.debug(`Unknown Codex event type: ${event.type}`);
        }
        break;
    }
  }

  streamLog.info('━━━ CODEX STREAM TRANSFORMATION COMPLETE ━━━');
  streamLog.info(`Total events: ${eventCount}`);
  streamLog.info(`Total yields: ${yieldCount}`);
}
