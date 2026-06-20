import { createUIMessageStream, type UIMessageStreamWriter } from 'ai';
import { db } from '../db/client';
import { projects, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Template } from '../templates/config';
import { getTemplateById, selectTemplateFromPrompt } from '../templates/config';
import { downloadTemplate, getProjectFileTree } from '../templates/downloader';
import type { BuildRequest } from '../../types/build';
import { DEFAULT_AGENT_ID, DEFAULT_CLAUDE_MODEL_ID } from '../../types/agent';
import type { AgentId, ClaudeModelId } from '../../types/agent';
import { getWorkspaceRoot } from '../workspace';

// Debug logging helper - suppressed in TUI mode (SILENT_MODE=1)
const debugLog = (message: string) => {
  if (process.env.SILENT_MODE !== '1' && process.env.DEBUG_BUILD === '1') {
    debugLog(message);
  }
};

export interface AgentMessage {
  type: string;
  subtype?: string;
  message?: {
    id?: string;
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: string;
    }>;
  };
  uuid?: string;
  error?: unknown;
  result?: unknown;
  usage?: unknown;
  finalResponse?: unknown;
}

export type AgentQueryFn = (args: {
  prompt: string;
  inputMessages: Array<{ role: string; content: string }>;
  options: Record<string, unknown>;
}) => AsyncGenerator<AgentMessage> | Promise<AsyncGenerator<AgentMessage>>;

export interface BuildStreamOptions extends BuildRequest {
  projectId: string;
  query: AgentQueryFn;
}

interface ProjectMetadata {
  slug: string;
  friendlyName: string;
  description: string;
  icon: string;
  template: string;
}

interface RuntimeMetadata {
  runCommand: string;
  projectType: string;
  port: number;
  detectedFramework: string | null; // Framework detected from filesystem (next, vite, astro, etc.)
}

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

interface PreBuildStartEvent {
  type: 'pre-build-start';
}

interface MetadataExtractedEvent {
  type: 'metadata-extracted';
  metadata: ProjectMetadata;
}

interface TemplateSelectedEvent {
  type: 'template-selected';
  template: Template;
}

interface TemplateDownloadedEvent {
  type: 'template-downloaded';
  path: string;
}

interface BuildErrorEvent {
  type: 'error';
  error: string;
}

function resolveScriptRunner(packageJson: PackageJson): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  const pm = typeof packageJson?.packageManager === 'string'
    ? packageJson.packageManager.toLowerCase()
    : '';

  if (pm.startsWith('pnpm')) return 'pnpm';
  if (pm.startsWith('yarn')) return 'yarn';
  if (pm.startsWith('bun')) return 'bun';

  if (packageJson?.devDependencies?.pnpm) return 'pnpm';
  if (packageJson?.devDependencies?.yarn) return 'yarn';
  if (packageJson?.devDependencies?.bun) return 'bun';

  return 'npm';
}

function buildScriptCommand(runner: 'npm' | 'pnpm' | 'yarn' | 'bun', script: string): string {
  switch (runner) {
    case 'pnpm':
      return `pnpm ${script}`;
    case 'yarn':
      return `yarn ${script}`;
    case 'bun':
      return script === 'dev' ? 'bun dev' : `bun run ${script}`;
    default:
      return `npm run ${script}`;
  }
}

async function detectRuntimeMetadata(projectPath: string): Promise<RuntimeMetadata | null> {
  try {
    const packageJsonPath = join(projectPath, 'package.json');
    const raw = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(raw);

    const runner = resolveScriptRunner(packageJson);
    const scripts = packageJson.scripts ?? {};

    let runCommand = '';
    if (scripts.dev) {
      runCommand = buildScriptCommand(runner, 'dev');
    } else if (scripts.start) {
      runCommand = buildScriptCommand(runner, 'start');
    }

    if (!runCommand) {
      runCommand = runner === 'yarn' ? 'yarn dev'
        : runner === 'pnpm' ? 'pnpm dev'
        : runner === 'bun' ? 'bun dev'
        : 'npm run dev';
    }

    let projectType = 'unknown';
    let port = 3000;

    const deps = packageJson.dependencies ?? {};
    const devDeps = packageJson.devDependencies ?? {};

    if (deps['@tanstack/react-start'] || devDeps['@tanstack/react-start']) {
      projectType = 'tanstack';
      port = 3000;
    } else if (deps.next || devDeps.next) {
      projectType = 'next';
      port = 3001;
    } else if (deps.astro || devDeps.astro) {
      projectType = 'astro';
      port = 4321;
    } else if (deps['@angular/core'] || devDeps['@angular/core']) {
      projectType = 'angular';
      port = 4200;
    } else if (devDeps.vite && !deps.astro && !devDeps.astro) {
      projectType = 'vite';
      port = 5173;
    }

    // CRITICAL FIX: Detect framework using filesystem analysis for port allocation
    // Import needed at top of file
    const { detectFrameworkFromFilesystem } = await import('../port-allocator');
    const detectedFramework = await detectFrameworkFromFilesystem(projectPath);
    
    if (process.env.DEBUG_BUILD === '1') console.log(`[build-engine] 🔍 Detected framework: ${detectedFramework || 'unknown'}`);

    return {
      runCommand,
      projectType,
      port,
      detectedFramework: detectedFramework || projectType, // Use filesystem detection or fall back to projectType
    };
  } catch (error) {
    if (process.env.DEBUG_BUILD === '1') console.warn('⚠️  Could not detect runtime metadata:', error);
    return null;
  }
}

export async function createBuildStream(options: BuildStreamOptions) {
  const { projectId: id, prompt, operationType, context, query } = options;

  const stream = createUIMessageStream({
    async execute({ writer }) {
      await runBuildPipeline({ projectId: id, prompt, operationType, context, writer, query });
    },
  });

  return stream;
}

function serializeMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  try {
    return JSON.stringify(content);
  } catch (error) {
    console.error('Failed to serialize message content, falling back to string', error);
    return JSON.stringify({ type: 'text', text: String(content) });
  }
}

interface BuildPipelineParams extends BuildRequest {
  projectId: string;
  writer: UIMessageStreamWriter;
  query: AgentQueryFn;
}

async function runBuildPipeline(params: BuildPipelineParams) {
  const { projectId: id, prompt, operationType, context, writer, query, agent, claudeModel } = params;
  const agentId: AgentId = agent ?? DEFAULT_AGENT_ID;
  const resolvedClaudeModel: ClaudeModelId =
    agentId === 'claude-code' && (claudeModel === 'claude-haiku-4-5' || claudeModel === 'claude-sonnet-4-6' || claudeModel === 'claude-opus-4-8')
      ? claudeModel
      : DEFAULT_CLAUDE_MODEL_ID;

  const project = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

  if (project.length === 0) {
    throw new Error('Project not found');
  }

  await db.update(projects)
    .set({ status: 'in_progress', lastActivityAt: new Date() })
    .where(eq(projects.id, id));

  await db.insert(messages).values({
    projectId: id,
    role: 'user',
    content: serializeMessageContent([{ type: 'text', text: prompt }]),
  });

  if (process.env.DEBUG_BUILD === '1') console.log('🎯 Starting build execution...');

  const workspaceRoot = getWorkspaceRoot();
  const projectsDir = workspaceRoot;
  const projectName = project[0].slug;
  let projectPath = project[0].path;

  let systemPrompt = '';
  let selectedTemplate: Template | null = null;
  let fileTree = '';
  let maxTurns = 100;
  let metadata: ProjectMetadata | null = null;

  const projectsDirName = workspaceRoot;

  switch (operationType) {
    case 'initial-build': {
      if (process.env.DEBUG_BUILD === '1') console.log('🆕 INITIAL BUILD - Starting pre-build phase...');
      const preBuildEvent: PreBuildStartEvent = { type: 'pre-build-start' };
      // Custom event types are not part of the standard UI stream protocol
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writer.write(preBuildEvent as any);

      metadata = await extractProjectMetadata(prompt, query, agentId, resolvedClaudeModel);
      const metadataEvent: MetadataExtractedEvent = {
        type: 'metadata-extracted',
        metadata,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writer.write(metadataEvent as any);

      selectedTemplate = metadata?.template
        ? await getTemplateById(metadata.template)
        : await selectTemplateFromPrompt(prompt);

      if (!selectedTemplate) {
        throw new Error('Unable to resolve template for build');
      }

      const templateEvent: TemplateSelectedEvent = { type: 'template-selected', template: selectedTemplate };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writer.write(templateEvent as any);

      const downloadResult = await downloadTemplate(selectedTemplate, projectName);
      const downloadEvent: TemplateDownloadedEvent = { type: 'template-downloaded', path: downloadResult };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writer.write(downloadEvent as any);

      // Update project path in database immediately after download
      projectPath = downloadResult;
      await db.update(projects)
        .set({ 
          path: projectPath,
          lastActivityAt: new Date(),
        })
        .where(eq(projects.id, id));
      if (process.env.DEBUG_BUILD === '1') console.log(`📁 Project path saved: ${projectPath}`);

      fileTree = await getProjectFileTree(downloadResult);
      systemPrompt = await buildInitialSystemPrompt({
        selectedTemplate,
        fileTree,
        projectPath: downloadResult,
        prompt,
        projectsDir: projectsDirName,
        projectName,
      });

      break;
    }

    case 'enhancement': {
      if (process.env.DEBUG_BUILD === '1') console.log('🔧 ENHANCEMENT - Follow-up chat for existing project');
      fileTree = await getProjectFileTree(projectPath);

      if (project[0].projectType) {
        const templateIdMap: Record<string, string> = {
          vite: 'react-vite',
          next: 'nextjs-fullstack',
          astro: 'astro-static',
          tanstack: 'template_tanstackstart',
        };
        const templateId = templateIdMap[project[0].projectType] || 'react-vite';
        selectedTemplate = await getTemplateById(templateId);
      }

      systemPrompt = buildEnhancementPrompt({
        project: project[0],
        fileTree,
        prompt,
        projectsDir: projectsDirName,
        projectName,
        selectedTemplate,
      });
      break;
    }

    case 'focused-edit': {
      if (process.env.DEBUG_BUILD === '1') console.log('🎯 FOCUSED EDIT - Targeted element change');
      maxTurns = 15;
      fileTree = await getProjectFileTree(projectPath);
      systemPrompt = buildFocusedEditPrompt({
        project: project[0],
        fileTree,
        prompt,
        context,
        projectsDir: projectsDirName,
        projectName,
      });
      break;
    }

    case 'continuation': {
      if (process.env.DEBUG_BUILD === '1') console.log('🔁 CONTINUATION - Retrying failed build');
      fileTree = await getProjectFileTree(projectPath);
      systemPrompt = buildContinuationPrompt({
        project: project[0],
        fileTree,
        prompt,
        projectsDir: projectsDirName,
        projectName,
        selectedTemplate,
      });
      break;
    }
  }

  const fullPrompt = operationType === 'focused-edit' && context?.elementSelector
    ? `${prompt}\n\nTarget element: ${context.elementSelector}`
    : prompt;

  const queryOptions: Record<string, unknown> = {
    cwd: projectsDir,
    permissionMode: 'bypassPermissions',
    maxTurns,
    systemPrompt,
  };

  if (agentId === 'claude-code') {
    queryOptions.model = resolvedClaudeModel;
  } else if (agentId === 'openai-codex') {
    queryOptions.model = 'gpt-5-codex';
  }

  const agentStream = (await query({
    prompt: fullPrompt,
    inputMessages: [{ role: 'system', content: systemPrompt }],
    options: queryOptions,
  })) as AsyncGenerator<AgentMessage>;

  await writeAgentMessagesToStream(agentStream, writer);

  const projectUpdates: Record<string, unknown> = {
    status: 'completed',
    lastActivityAt: new Date(),
  };

  const runtimeMetadata = await detectRuntimeMetadata(projectPath);
  if (runtimeMetadata) {
    if (process.env.DEBUG_BUILD === '1') console.log('🛠️  Runtime metadata detected:', runtimeMetadata);
    Object.assign(projectUpdates, runtimeMetadata);
  } else {
    if (process.env.DEBUG_BUILD === '1') console.warn('⚠️  Unable to determine runtime metadata for project, using defaults');
  }

  await db.update(projects)
    .set(projectUpdates)
    .where(eq(projects.id, id));

  if (operationType === 'initial-build') {
    await autoStartDevServer(id);
  }
}

async function extractProjectMetadata(
  prompt: string,
  query: AgentQueryFn,
  agentId: AgentId,
  claudeModel: ClaudeModelId,
): Promise<ProjectMetadata> {
  if (process.env.DEBUG_BUILD === '1') console.log('🤖 Extracting project metadata...');

  const metadataStream = await query({
    prompt: `Analyze this project request: "${prompt}"\n\nExtract metadata and select the best template.\n\nAvailable templates:\n- react-vite: React with Vite, TypeScript, Tailwind (fast SPA, client-side only)\n- nextjs-fullstack: Next.js with TypeScript, Tailwind (SSR, API routes, full-stack)\n- astro-static: Astro with TypeScript, Tailwind (static site generation, content-focused)\n- template_tanstackstart: TanStack Start with React 19, TanStack Router/Query, Tailwind (minimal full-stack foundation)\n\nOutput ONLY valid JSON (no markdown, no explanation):\n{\n  "slug": "short-kebab-case-name",\n  "friendlyName": "Friendly Display Name",\n  "description": "Brief description of what this builds",\n  "icon": "Package",\n  "template": "react-vite"\n}\n\nAvailable icons: Package, Rocket, Code, Zap, Database, Globe, ShoppingCart, Calendar, MessageSquare, Mail, FileText, Image, Music, Video, Book, Heart, Star, Users, Settings, Layout, Grid, List, Edit, Search, Filter\n\nRules:\n- slug must be lowercase, kebab-case, 2-4 words max\n- friendlyName should be concise (2-5 words)\n- description should explain what the app does\n- template must be one of: react-vite, nextjs-fullstack, astro-static, template_tanstackstart\n\nTemplate Selection Logic (PRIORITY ORDER):\n1. If user mentions "tanstack", "tanstack start", "tanstack router", or "react start" → template_tanstackstart\n2. If user explicitly mentions "vite" OR "react vite" → react-vite\n3. If user explicitly mentions "next" OR "nextjs" → nextjs-fullstack\n4. If user explicitly mentions "astro" → astro-static\n5. If user calls out TanStack Router/Query as the desired stack → template_tanstackstart\n6. If user mentions backend needs (API, database, auth, server) without TanStack cues → nextjs-fullstack\n7. If user mentions static content (blog, docs, markdown) → astro-static\n8. For simple landing pages with NO backend → react-vite (simpler/faster)\n9. For landing pages WITH backend/forms/API → nextjs-fullstack\n10. For interactive apps (todo, dashboard, calculator, game) → react-vite\n11. Default if unclear → react-vite (simplest option)\n\nCRITICAL: Pay attention to explicit technology mentions. If user says "vite landing page", use react-vite NOT nextjs!`,
    inputMessages: [],
    options: {
      ...(agentId === 'claude-code'
        ? { model: claudeModel }
        : agentId === 'openai-codex'
          ? { model: 'gpt-5-codex' }
          : {}),
      maxTurns: 1,
      systemPrompt: 'You are a metadata extraction assistant. Output ONLY valid JSON. No markdown blocks. No explanations. Just raw JSON.',
    },
  });

  let jsonResponse = '';
  for await (const message of metadataStream as AsyncGenerator<AgentMessage>) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text) {
          jsonResponse += block.text;
        }
      }
    }
  }

  try {
    let cleanedResponse = jsonResponse.trim();
    cleanedResponse = cleanedResponse.replace(/```json\s*/g, '');
    cleanedResponse = cleanedResponse.replace(/```\s*/g, '');
    cleanedResponse = cleanedResponse.trim();

    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const metadata = JSON.parse(jsonMatch[0]) as ProjectMetadata;
      if (!metadata.slug || !metadata.friendlyName || !metadata.template) {
        throw new Error('Missing required fields in metadata');
      }
      return metadata;
    }
  } catch (parseError) {
    if (process.env.DEBUG_BUILD === '1') console.error('❌ JSON parsing failed:', parseError);
  }

  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
    .replace(/-$/, '');

  return {
    slug: slug || `project-${Date.now()}`,
    friendlyName: prompt.substring(0, 50),
    description: prompt.substring(0, 150),
    icon: 'Code',
    template: 'react-vite',
  };
}

async function writeAgentMessagesToStream(
  agentStream: AsyncGenerator<AgentMessage>,
  writer: UIMessageStreamWriter,
) {
  let currentMessageId: string | null = null;
  let messageStarted = false;

  for await (const message of agentStream) {
    if (message.type === 'system' && message.subtype === 'init') {
      continue;
    }

    if (message.type === 'assistant') {
      const content = message.message?.content;
      const assistantMessageId = message.message?.id || message.uuid;

      if (assistantMessageId !== currentMessageId) {
        if (messageStarted && currentMessageId) {
          writer.write({ type: 'finish' });
        }

        currentMessageId = assistantMessageId ?? null;
        messageStarted = true;
        writer.write({ type: 'start', messageId: assistantMessageId });
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            const textBlockId = `${assistantMessageId}-text-${Date.now()}`;
            writer.write({ type: 'text-start', id: textBlockId });
            writer.write({ type: 'text-delta', id: textBlockId, delta: block.text });
            writer.write({ type: 'text-end', id: textBlockId });
          } else if (block.type === 'tool_use' && block.id && block.name) {
            const input = block.input as Record<string, unknown> | undefined;
            const pathToCheck = [
              typeof input?.command === 'string' ? input.command : null,
              typeof input?.file_path === 'string' ? input.file_path : null,
              typeof input?.path === 'string' ? input.path : null,
            ].find((value): value is string => !!value) ?? '';

            if (pathToCheck && (pathToCheck.includes('/Users/') || pathToCheck.includes('/home/'))) {
              console.error('🚨 PATH VIOLATION:', pathToCheck);
            }

            writer.write({
              type: 'tool-input-available',
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
            });
          }
        }
      }
    } else if (message.type === 'user' && message.message?.content) {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            writer.write({
              type: 'tool-output-available',
              toolCallId: block.tool_use_id,
              output: block.content,
            });
          }
        }
      }
    } else if (message.type === 'result') {
      if (messageStarted && currentMessageId) {
        writer.write({ type: 'finish' });
        messageStarted = false;
      }
    } else if (message.type === 'error') {
      if (process.env.DEBUG_BUILD === '1') console.error('❌ Agent Error:', message.error);
      const errorEvent: BuildErrorEvent = {
        type: 'error',
        error: message.error instanceof Error ? message.error.message : String(message.error),
      };
      // Custom event format for build errors
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writer.write(errorEvent as any);
    }
  }
}

async function autoStartDevServer(projectId: string) {
  // NOTE: This function is deprecated in favor of runner-based server management
  // Auto-start is now handled by the frontend (page.tsx) which calls /api/projects/:id/start
  // Keeping this as a no-op to avoid breaking existing code paths
  if (process.env.DEBUG_BUILD === '1') console.log(`⚠️  autoStartDevServer called for ${projectId} - deprecated, skipping`);
  if (process.env.DEBUG_BUILD === '1') console.log(`   Server should be started via /api/projects/:id/start endpoint instead`);
}

async function buildInitialSystemPrompt(params: {
  selectedTemplate: Template;
  fileTree: string;
  projectPath: string;
  prompt: string;
  projectsDir: string;
  projectName: string;
}) {
  const { selectedTemplate, fileTree, projectPath, prompt, projectsDir, projectName } = params;
  const promptAddition = selectedTemplate.ai?.systemPromptAddition || '';
  return `You are a helpful coding assistant specialized in building JavaScript applications.

🎯 INITIAL BUILD - TEMPLATE ALREADY DOWNLOADED

✅ **Template has been automatically selected and downloaded:**

Template: ${selectedTemplate.name}
Location: ${projectPath}
Framework: ${selectedTemplate.tech?.framework}

**Project Structure:**
${fileTree}

${promptAddition}

**Included Features:**
${selectedTemplate.ai?.includedFeatures?.map((f) => `  • ${f}`).join('\n') ?? ''}

**Setup Commands:**
  Install: ${selectedTemplate.setup?.installCommand}
  Dev: ${selectedTemplate.setup?.devCommand}
  Build: ${selectedTemplate.setup?.buildCommand}

**Your Task:**
The template is already downloaded and ready. You need to:
1. Install dependencies
2. Customize the template to match: "${prompt}"
3. Add any additional features requested

DO NOT scaffold a new project - the template is already there!
START by installing dependencies, THEN customize the existing code.

${getSharedPromptSections(projectsDir, projectName, selectedTemplate)}`;
}

function buildEnhancementPrompt(params: {
  project: typeof projects.$inferSelect;
  fileTree: string;
  prompt: string;
  projectsDir: string;
  projectName: string;
  selectedTemplate: Template | null;
}) {
  const { project, fileTree, prompt, projectsDir, projectName, selectedTemplate } = params;

  // Check if this is an error-fixing request
  const isErrorFix = /error|bug|fix|broken|crash|fail|issue|problem|not working|doesn't work/i.test(prompt);

  const errorFixInstructions = isErrorFix ? `
═══════════════════════════════════════════════════════════════════
🔧 ERROR FIX MODE - VERIFY BEFORE COMPLETING
═══════════════════════════════════════════════════════════════════

⚠️  CRITICAL: The user reported an error. You MUST verify it's fixed! ⚠️

**ERROR FIXING WORKFLOW:**

1. **Understand the Error**
   - Read the error message carefully
   - Identify the root cause (not just symptoms)
   - Find ALL files that could be related

2. **Make the Fix**
   - Apply targeted changes to fix the root cause
   - Don't just suppress the error - actually fix it

3. **VERIFY THE FIX (MANDATORY)**
   - Run \`npm run build\` or \`npm run dev\` to check for errors
   - Look at the terminal output for any remaining errors
   - If the SAME error appears: you didn't fix it, try again
   - If NEW errors appear: fix those too before completing

4. **ITERATE UNTIL FIXED**
   - DO NOT declare success until verification passes
   - DO NOT say "I've fixed the error" without running build/dev
   - Keep iterating until the app runs without errors

**WRONG ❌:**
- Make a code change → "Fixed! The error should be resolved now"
- Make a change → Mark todo complete → Stop

**RIGHT ✅:**
- Make a code change → Run npm run build/dev → Check output
- If errors remain → Make another fix → Verify again
- Only mark complete AFTER verification shows no errors

NEVER declare an error fixed without verification output proving it works!
` : '';

  return `You are enhancing an existing project with new features or changes.

🔄 ENHANCEMENT MODE

**Project:** ${project.name}
**Location:** ${project.path}
**Type:** ${project.projectType || 'Unknown'}

**Current Structure:**
${fileTree}

**User's Request:**
"${prompt}"
${errorFixInstructions}
**Your Task:**
1. Review the existing code structure
2. Make the requested changes/additions
3. Update or add files as needed
4. VERIFY your changes work by running the dev server or build
5. If errors remain, iterate until they're fixed

This is an EXISTING project - modify what's there, don't recreate from scratch!

${getSharedPromptSections(projectsDir, projectName, selectedTemplate)}`;
}

function buildFocusedEditPrompt(params: {
  project: typeof projects.$inferSelect;
  fileTree: string;
  prompt: string;
  context: BuildRequest['context'];
  projectsDir: string;
  projectName: string;
}) {
  const { project, fileTree, prompt, context, projectsDir, projectName } = params;
  return `You are making a focused, surgical change to an existing project.

🎯 FOCUSED EDIT MODE

**Project:** ${project.name}
**Location:** ${project.path}

${context?.elementSelector ? `**Target Element:**
Selector: ${context.elementSelector}
Tag: <${context.elementInfo?.tagName || 'unknown'}>
${context.elementInfo?.className ? `Classes: ${context.elementInfo.className}` : ''}
${context.elementInfo?.textContent ? `Text: "${context.elementInfo.textContent.substring(0, 100)}"` : ''}` : ''}

**Change Request:**
"${prompt}"

**Your Task:**
1. Find the specific element/code to change
2. Make ONLY the requested change
3. Verify it's complete
4. Do NOT make unrelated changes

Be quick and precise - this is a targeted edit!

${getSharedPromptSections(projectsDir, projectName, null)}`;
}

function buildContinuationPrompt(params: {
  project: typeof projects.$inferSelect;
  fileTree: string;
  prompt: string;
  projectsDir: string;
  projectName: string;
  selectedTemplate: Template | null;
}) {
  const { project, fileTree, prompt, projectsDir, projectName, selectedTemplate } = params;
  return `You are continuing a previous build that encountered issues.

🔁 CONTINUATION MODE

**Project:** ${project.name}
**Location:** ${project.path}
**Previous Error:** ${project.errorMessage || 'Unknown error'}

**Current Structure:**
${fileTree}

**Your Task:**
Continue from where you left off. Review what's been done and complete the build.

${getSharedPromptSections(projectsDir, projectName, selectedTemplate)}`;
}

function getSharedPromptSections(projectsDir: string, projectName: string, selectedTemplate: Template | null) {
  return `
🚨 PATH REQUIREMENTS 🚨

Your CWD: ${projectsDir}
Project directory: ${projectName}

PATH RULES:
✅ Use: ${projectName}/file.ts
✅ Use: cd ${projectName} && npm install
❌ NEVER: /Users/anything
❌ NEVER: /home/anything
❌ NEVER: Absolute paths

🎯 TASK MANAGEMENT:

Use TodoWrite to create detailed task breakdowns:
- Mark tasks "in_progress" when starting
- Mark "completed" immediately when done
- Create final summary task: "Project ready - Review and launch"

📄 FILE WRITING:

ALWAYS write COMPLETE file contents. NO placeholders like:
❌ "// ... rest remains same"
❌ "/* keeping existing code */"

✅ Write the ENTIRE file every time.

🔧 TYPESCRIPT:

Use explicit type imports:
✅ import type { MyType } from './types'
❌ import { MyType } from './types'

🌈 TAILWIND CSS v4 CONFIGURATION - CRITICAL 🌈

IMPORTANT: All templates use Tailwind CSS v4, which requires FUNCTION SYNTAX for CSS variables:

✅ CORRECT formats in globals.css or app.css:
  --primary: rgb(117 83 255);
  --background: oklch(0.24 0.05 294);

❌ WRONG formats (Tailwind v3 - DO NOT USE):
  --primary: 117 83 255;
  --primary: #7553FF;

Rules for CSS color variables:
1. Use rgb() or oklch() function syntax
2. Inside function: space-separated values (NO commas)
3. Apply to ALL color variables in :root

Example correct globals.css:
:root {
  --background: rgb(18 12 37);
  --foreground: rgb(255 255 255);
  --primary: rgb(117 83 255);
  --accent: rgb(255 69 168);
}

Both rgb() and oklch() work - but you MUST use function syntax!

📦 DEPENDENCIES:

Add ALL dependencies to package.json FIRST, then install once.

${selectedTemplate ? `
🛠️ WORKFLOW:

The template is already downloaded. Follow this sequence:
1. cd ${projectName} && ${selectedTemplate.setup?.installCommand}
2. Customize existing files to match user's request
3. Add new features as needed
4. Start the dev server to test the application
5. Verify it works correctly, then stop the dev server (Ctrl+C)
6. Mark final todo as complete
` : ''}

═══════════════════════════════════════════════════════════════════
🔄 VERIFICATION & ITERATION - MANDATORY
═══════════════════════════════════════════════════════════════════

⚠️  CRITICAL: Always verify your changes actually work! ⚠️

**BEFORE marking ANY work complete:**
1. Run \`npm run dev\` or \`npm run build\` to verify
2. Check terminal output for errors
3. If errors exist: FIX THEM before completing
4. Only declare success AFTER seeing clean output

**ERROR ITERATION LOOP:**
- If you see errors → Make a fix → Verify again
- Repeat until output is clean
- NEVER stop while errors remain
- NEVER say "should work now" without verifying

**What to look for in terminal output:**
✅ "compiled successfully"
✅ "ready in"
✅ Server running on port
❌ "error"
❌ "failed"
❌ Stack traces

After completing all tasks, you MUST test by starting the dev server, check output for errors, and iterate until clean!
`;
}
