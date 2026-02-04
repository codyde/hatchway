import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AgentId, ClaudeModelId } from '@hatchway/agent-core/types/agent';
import { resolveAgentStrategy } from '@hatchway/agent-core/lib/agents';
import { ensureProjectSkills } from '../skills.js';

// Debug logging helper - suppressed in TUI mode (SILENT_MODE=1)
const debugLog = (message: string) => {
  if (process.env.SILENT_MODE !== '1' && process.env.DEBUG_BUILD === '1') {
    debugLog(message);
  }
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
  codexThreadId?: string, // For resuming Codex threads
  messageParts?: MessagePart[] // Multi-modal content
) => AsyncGenerator<unknown, void, unknown>;

interface BuildStreamOptions {
  projectId: string;
  projectName: string;
  prompt: string;
  messageParts?: MessagePart[]; // Multi-modal content (text, images, etc.)
  operationType: string;
  context?: Record<string, unknown>;
  query: BuildQueryFn;
  workingDirectory: string;
  systemPrompt: string;
  agent: AgentId;
  isNewProject?: boolean;
  claudeModel?: ClaudeModelId;
  codexThreadId?: string; // For resuming Codex threads
}

/**
 * Create a build stream that executes the Claude query and returns a stream
 */
export async function createBuildStream(options: BuildStreamOptions): Promise<ReadableStream> {
  const { prompt, messageParts, query, context, workingDirectory, systemPrompt, agent, isNewProject } = options;

  // For Codex on NEW projects, use parent directory as CWD (Codex will create the project dir)
  // For everything else, use the project directory
  const strategy = await resolveAgentStrategy(agent);
  const projectName = options.projectName || path.basename(workingDirectory);
  const strategyContext = {
    projectId: options.projectId,
    projectName,
    prompt,
    workingDirectory,
    operationType: options.operationType,
    isNewProject: !!isNewProject,
  };

  const resolvedDir = strategy.resolveWorkingDirectory?.(strategyContext);
  const actualWorkingDir = resolvedDir ?? workingDirectory;

  if (resolvedDir) {
    if (process.env.DEBUG_BUILD === '1') console.log(`[engine] Strategy adjusted CWD to: ${actualWorkingDir}`);
  } else if (!existsSync(workingDirectory)) {
    mkdirSync(workingDirectory, { recursive: true });
  }
  
  // Ensure project has skills copied from bundled skills
  ensureProjectSkills(actualWorkingDir);

  if (!resolvedDir) {
    if (process.env.DEBUG_BUILD === '1') console.log(`[engine] Using project directory as CWD: ${actualWorkingDir}`);
  }

  // Store the original CWD to restore it later
  const originalCwd = process.cwd();

  // Change to the appropriate directory
  process.chdir(actualWorkingDir);

  // Build the full prompt with context
  let fullPrompt = prompt;

  if (context && Object.keys(context).length > 0) {
    fullPrompt = `${fullPrompt}\n\nContext: ${JSON.stringify(context, null, 2)}`;
  }

  // Pass prompt, working directory, and system prompt to the query function
  // The buildQuery wrapper will configure the SDK with all options
  // Use actualWorkingDir so the query function gets the correct CWD

  debugLog('[runner] [build-engine] 🚀 Creating generator with query function...\n');
  const generator = query(fullPrompt, actualWorkingDir, systemPrompt, agent, options.codexThreadId, messageParts);

  debugLog('[runner] [build-engine] 📦 Creating ReadableStream from generator...\n');
  // Create a ReadableStream from the AsyncGenerator
  const stream = new ReadableStream({
    async start(controller) {
      debugLog('[runner] [build-engine] ▶️  Stream start() called, beginning to consume generator...\n');
      let chunkCount = 0;
      try {
        for await (const chunk of generator) {
          chunkCount++;
          if (chunkCount % 5 === 0) {
            debugLog(`[runner] [build-engine] Processed ${chunkCount} chunks from generator\n`);
          }
          // Convert chunk to appropriate format
          if (typeof chunk === 'string') {
            controller.enqueue(new TextEncoder().encode(chunk));
          } else if (chunk instanceof Uint8Array) {
            controller.enqueue(chunk);
          } else if (typeof chunk === 'object') {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(chunk)));
          }
        }
        debugLog(`[runner] [build-engine] ✅ Generator exhausted after ${chunkCount} chunks, closing stream\n`);
        controller.close();
      } catch (error) {
        debugLog(`[runner] [build-engine] ❌ Error consuming generator: ${error}\n`);
        controller.error(error);
      } finally {
        // Restore the original working directory
        process.chdir(originalCwd);
      }
    },
  });

  debugLog('[runner] [build-engine] ✅ Stream created and returned\n');
  return stream;
}
