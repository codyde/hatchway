/**
 * Transform Claude Agent SDK messages into the SSE format expected by the frontend
 * Includes message lifecycle tracking and path violation detection
 */

// Use namespace import for buildLogger to work around CommonJS/ESM interop
import * as AgentCore from '@hatchway/agent-core';
const { buildLogger } = AgentCore;

interface SSEEvent {
  type: string;
  [key: string]: any;
}

interface TransformerState {
  currentMessageId: string | null;
  messageStarted: boolean;
  expectedCwd?: string;
  commandMetadata: Map<string, { command?: string }>;
  toolNames: Map<string, string>; // Track tool names by tool call ID
}

// Track state across transformations
let transformerState: TransformerState = {
  currentMessageId: null,
  messageStarted: false,
  commandMetadata: new Map(),
  toolNames: new Map(),
};

export function resetTransformerState() {
  transformerState = {
    currentMessageId: null,
    messageStarted: false,
    commandMetadata: new Map(),
    toolNames: new Map(),
  };
}

export function setExpectedCwd(cwd: string) {
  transformerState.expectedCwd = cwd;
}

/**
 * Path violation detection - warns about absolute paths
 */
function detectPathViolations(toolName: string, input: any, expectedCwd?: string) {
  if (!['Bash', 'Read', 'Write', 'Edit'].includes(toolName)) {
    return;
  }

  const pathToCheck = input?.command || input?.file_path || input?.path || '';

  if (typeof pathToCheck === 'string') {
    // Only warn if absolute path is OUTSIDE the workspace entirely
    if (expectedCwd && pathToCheck.startsWith('/')) {
      // Get workspace root (parent of project directory)
      const workspaceRoot = expectedCwd.split('/').slice(0, -1).join('/');

      // Allow paths within workspace (project or parent workspace directory)
      const isWithinWorkspace = pathToCheck.startsWith(expectedCwd) || pathToCheck.startsWith(workspaceRoot);

      if (!isWithinWorkspace) {
        buildLogger.transformer.pathViolationWarning(toolName, pathToCheck, workspaceRoot);
      }
    }

    // Always warn about Desktop paths (hallucination indicator)
    if (pathToCheck.includes('/Desktop/')) {
      buildLogger.transformer.desktopPathDetected(pathToCheck);
    }
  }
}

export function transformAgentMessageToSSE(agentMessage: any): SSEEvent[] {
  const events: SSEEvent[] = [];

  if (agentMessage.type === 'assistant' && agentMessage.message) {
    const message = agentMessage.message;
    const assistantMessageId = message.id || `msg-${Date.now()}`;

    // Start new message if this is a different message ID
    if (assistantMessageId !== transformerState.currentMessageId) {
      // Finish previous message if one was open
      if (transformerState.messageStarted && transformerState.currentMessageId) {
        events.push({
          type: 'finish',
        });
      }

      // Start new message
      transformerState.currentMessageId = assistantMessageId;
      transformerState.messageStarted = true;
      events.push({
        type: 'start',
        messageId: assistantMessageId,
      });
    }

    // Process each content block
    if (message.content && Array.isArray(message.content)) {
      /**
       * Extract JSON with balanced braces for TODO_WRITE markers
       */
      const extractBalancedJsonForMarker = (text: string, startPos: number): { json: string; endPos: number } | null => {
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
      };

      const processTodoWriteMarkers = (text: string) => {
        let cleaned = '';
        let lastIndex = 0;

        // Find all TODO_WRITE markers
        const markerPattern = /TODO_WRITE\s*:\s*/g;
        let match: RegExpExecArray | null;

        while ((match = markerPattern.exec(text)) !== null) {
          const matchEnd = match.index + match[0].length;

          // Extract balanced JSON starting after the colon
          const extracted = extractBalancedJsonForMarker(text, matchEnd);

          if (!extracted) {
            if (process.env.DEBUG_BUILD === '1') {
              console.warn('⚠️  Failed to find balanced JSON for TODO_WRITE marker at position', match.index);
            }
            continue;
          }

          const jsonText = extracted.json;
          const fullMatch = text.substring(match.index, extracted.endPos);

          try {
            const payload = JSON.parse(jsonText);
            const toolCallId =
              typeof payload.toolCallId === 'string' && payload.toolCallId.length > 0
                ? payload.toolCallId
                : `codex-todo-${Date.now()}-${Math.random().toString(16).slice(2)}`;

            events.push({
              type: 'tool-input-available',
              toolCallId,
              toolName: 'TodoWrite',
              input: payload,
            });

            if (process.env.DEBUG_BUILD === '1') {
              console.log('✅ Parsed TODO_WRITE with', payload.todos?.length || 0, 'todos');
            }
          } catch (error) {
            if (process.env.DEBUG_BUILD === '1') {
              console.warn('⚠️  Failed to parse TODO_WRITE payload:', error);
              console.warn('    JSON (first 200 chars):', jsonText.substring(0, 200));
            }
          }

          cleaned += text.slice(lastIndex, match.index);
          lastIndex = extracted.endPos;
        }

        cleaned += text.slice(lastIndex);
        return cleaned;
      };

      for (const block of message.content) {
        // Detect skill invocations: the SDK loads skills via Read tool calls to SKILL.md files
        if (block.type === 'tool_use' && block.name === 'Read') {
          const filePath = block.input?.file_path || block.input?.filePath || block.input?.path || '';
          if (typeof filePath === 'string' && filePath.includes('SKILL.md')) {
            // Extract skill name from path: .../skills/<skill-name>/SKILL.md
            const skillMatch = filePath.match(/skills\/([^/]+)\/SKILL\.md/);
            const skillName = skillMatch ? skillMatch[1] : 'unknown';

            // Emit a skill-invocation event so the frontend can display it
            events.push({
              type: 'tool-input-available',
              toolCallId: block.id,
              toolName: 'SkillLoad',
              input: {
                skillName,
                filePath,
              },
            });

            // Store tool name as SkillLoad so output is also tagged
            transformerState.toolNames.set(block.id, 'SkillLoad');

            // Skip normal tool_use processing for this block
            continue;
          }
        }

        if (block.type === 'text' && block.text) {
          let text = String(block.text);

          // CRITICAL: Remove ALL task status formats from text BEFORE processing
          // We handle task status via synthetic TodoWrite events in the runner
          // Any task status in the text should be ignored to prevent conflicts

          text = processTodoWriteMarkers(text);

          // Remove old XML format completely
          text = text.replace(/<start-todolist>[\s\S]*?<\/start-todolist>/g, '').trim();
          text = text.replace(/<end-todolist>/g, '').trim();

          // Remove new structured format completely
          text = text.replace(/---TASK_STATUS---[\s\S]*?---END_TASK_STATUS---/g, '').trim();

          // DO NOT PARSE TASK STATUS FROM TEXT
          // The runner sends synthetic TodoWrite events with the authoritative state
          // Parsing from text causes stale/incorrect data

          const trimmed = text.trim();
          if (trimmed.length === 0) {
            continue;
          }

          const textBlockId = `${assistantMessageId}-text-${Date.now()}-${Math.random()}`;

          // Send all text as regular text-delta events for the chat
          // The UI will handle displaying it appropriately
          events.push({
            type: 'text-start',
            id: textBlockId,
          });

          events.push({
            type: 'text-delta',
            id: textBlockId,
            delta: text,
          });

          events.push({
            type: 'text-end',
            id: textBlockId,
          });
        } else if (block.type === 'tool_use') {
          // Detect path violations
          detectPathViolations(block.name, block.input, transformerState.expectedCwd);

          // Store tool name for later retrieval when output arrives
          transformerState.toolNames.set(block.id, block.name);

          // Send tool input with available state
          events.push({
            type: 'tool-input-available',
            toolCallId: block.id,
            toolName: block.name,
            input: block.input,
          });

          if (block.name === 'command_execution') {
          const command =
            typeof block.input?.command === 'string'
              ? block.input.command
              : '';
          transformerState.commandMetadata.set(block.id, { command });

            events.push({
              type: 'command_start',
              command,
              id: block.id,
            });
          }
        }
      }
    }
  } else if (agentMessage.type === 'user' && agentMessage.message) {
    // Process tool results
    const message = agentMessage.message;
    if (message.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          const toolId = block.tool_use_id;
          let output = block.content;
          if (Array.isArray(output)) {
            output = output
              .map((c: any) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c)))
              .join('\n');
          } else if (typeof output !== 'string') {
            output = JSON.stringify(output);
          }

          // Process TodoWrite markers in command outputs
          if (typeof output === 'string' && output.includes('TODO_WRITE')) {
            const regex = /TODO_WRITE\s*:\s*(\{[\s\S]*?\})(?=$|\n)/g;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(output)) !== null) {
              try {
                const payload = JSON.parse(match[1]);
                events.push({
                  type: 'tool-input-available',
                  toolCallId: payload.toolCallId ?? toolId ?? `todo-${Date.now()}`,
                  toolName: 'TodoWrite',
                  input: payload,
                });
              } catch (error) {
                if (process.env.DEBUG_BUILD === '1') console.warn('⚠️  Failed to parse TODO_WRITE payload from tool result:', error);
              }
            }
          }

          // Retrieve stored tool name for this tool call
          const toolName = transformerState.toolNames.get(block.tool_use_id);

          events.push({
            type: 'tool-output-available',
            toolCallId: block.tool_use_id,
            toolName, // Include tool name so API can broadcast to WebSocket
            output, // Use processed string output, not raw block.content
          });

          // Clean up tool name after use
          if (toolName) {
            transformerState.toolNames.delete(block.tool_use_id);
          }

          const commandMeta = transformerState.commandMetadata.get(toolId);
          if (commandMeta) {
            events.push({
              type: 'command_complete',
              id: toolId,
              command: commandMeta.command,
              output,
              exitCode: block.exit_code,
              status: block.status ?? (block.is_error ? 'failed' : 'completed'),
            });
            transformerState.commandMetadata.delete(toolId);
          }
        }
      }
    }
  } else if (agentMessage.type === 'result') {
    // Finish the current message if still open
    if (transformerState.messageStarted && transformerState.currentMessageId) {
      events.push({
        type: 'finish',
      });
      transformerState.messageStarted = false;
      transformerState.currentMessageId = null;
    }

    // Final result message
    events.push({
      type: 'result',
      result: agentMessage.result,
    });
  }

  return events;
}
