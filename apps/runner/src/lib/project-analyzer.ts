/**
 * Project Analyzer Module
 * 
 * Handles AI-based project analysis before builds:
 * - Template selection (or uses framework tag fast-path)
 * - Project name/slug generation
 * - Project metadata generation (icon, description)
 * 
 * This consolidates AI calls that were previously split between frontend and runner,
 * ensuring the runner is the single source of truth for all project decisions.
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as os from 'os';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as Sentry from '@sentry/node';
import type { AgentId, ClaudeModelId } from '@hatchway/agent-core/types/agent';
import type { AppliedTag } from '@hatchway/agent-core/types/tags';
import {
  ProjectMetadataSchema,
  ProjectNamingSchema,
  TemplateAnalysisSchema,
} from '@hatchway/agent-core';
import { getAllTemplates, type Template } from './templates/config.js';
import { TAG_DEFINITIONS } from '@hatchway/agent-core/config/tags';
import type { RunnerEvent } from '@hatchway/agent-core';

// Map model IDs to Claude Agent SDK model names
const MODEL_MAP: Record<string, string> = {
  'claude-haiku-4-5': 'claude-sonnet-4-5', // Haiku 4.5 not yet available, use Sonnet
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
  'claude-opus-4-5': 'claude-opus-4-5',
};

function resolveModelName(modelId: string): string {
  return MODEL_MAP[modelId] || 'claude-sonnet-4-5';
}

/**
 * Get a clean env object with only string values
 */
function getCleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (!env.PATH) {
    env.PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  }
  return env;
}

/**
 * Ensure a directory exists
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate structured output using Claude Agent SDK
 */
async function generateStructuredOutput<T extends z.ZodType>(options: {
  model: string;
  schema: T;
  prompt: string;
  system?: string;
}): Promise<{ object: z.infer<T> }> {
  const modelName = resolveModelName(options.model);
  const jsonSchema = z.toJSONSchema(options.schema);
  
  const jsonInstructions = `You must respond with ONLY valid JSON that matches this schema. Do not include any text before or after the JSON object. Do not wrap in markdown code blocks.

JSON Schema:
${JSON.stringify(jsonSchema, null, 2)}

CRITICAL: Your response must START with { and END with }. Output only the JSON object.`;

  const fullPrompt = options.system 
    ? `${options.system}\n\n${jsonInstructions}\n\nUser request: ${options.prompt}`
    : `${jsonInstructions}\n\nUser request: ${options.prompt}`;

  const tempDir = path.join(os.tmpdir(), 'runner-ai');
  ensureDir(tempDir);
  
  const sdkOptions: Options = {
    model: modelName,
    maxTurns: 1,
    tools: [],
    cwd: tempDir,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    env: getCleanEnv(),
  };

  let responseText = '';

  try {
    for await (const message of query({ prompt: fullPrompt, options: sdkOptions })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            responseText += block.text;
          }
        }
      }
    }
  } catch (error) {
    console.error('[project-analyzer] SDK query failed:', error);
    Sentry.captureException(error);
    throw error;
  }

  if (!responseText) {
    throw new Error('No text response from Claude Agent SDK');
  }

  // Clean up any markdown code blocks if present
  let jsonText = responseText.trim();
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }
  
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonText = jsonMatch[0];
  }

  const parsed = JSON.parse(jsonText);
  const validated = options.schema.parse(parsed);
  
  return { object: validated };
}

/**
 * Generate project name/slug from user prompt
 */
async function generateProjectName(
  prompt: string,
  model: string
): Promise<{ slug: string; friendlyName: string }> {
  const namePrompt = `Extract the core project concept from this request and create appropriate names:

User's project request: "${prompt}"

IMPORTANT: Extract only the PROJECT TYPE/CONCEPT. Ignore all conversational phrases:
- Ignore: "I want", "I need", "I would like", "please", "can you", "build me", "create me", "make me"
- Ignore: "a", "an", "the", "using", "with", "for me"
- Focus ONLY on WHAT is being built, not how the user asked for it

Generate:
1. A URL-friendly slug (lowercase, hyphens, 2-4 words, max 30 chars)
2. A human-readable friendly name (Title Case, 2-5 words)

Examples:
- "I want to build a todo app" → slug: "todo-app", friendlyName: "Todo App"
- "I want a workflow automation tool" → slug: "workflow-automation", friendlyName: "Workflow Automation"
- "Can you create an error monitoring dashboard for me" → slug: "error-monitoring", friendlyName: "Error Monitoring Dashboard"
- "I need a chat app with real-time messaging please" → slug: "realtime-chat", friendlyName: "Realtime Chat"

Requirements:
- Slug: lowercase, hyphens only, no special characters, max 30 chars
- Friendly name: Title Case, readable, professional, 2-5 words
- NEVER include words like "want", "need", "please", "build", "create", "make" in the output
- Focus on the core product/application concept`;

  try {
    console.log('[project-analyzer] Generating project name...');
    const result = await generateStructuredOutput({
      model,
      schema: ProjectNamingSchema,
      prompt: namePrompt,
    });

    const { slug, friendlyName } = result.object;

    // Validate slug format
    if (slug.length < 2 || slug.length > 100 || !/^[a-z0-9-]+$/.test(slug)) {
      throw new Error('Generated slug is invalid format');
    }

    console.log(`[project-analyzer] Generated name: ${friendlyName} (${slug})`);
    return { slug, friendlyName };
  } catch (error) {
    console.error('[project-analyzer] Name generation failed, using fallback:', error);
    
    // Fallback: extract words from prompt
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !['the', 'and', 'for', 'with', 'build', 'create', 'make', 'want', 'need', 'please', 'can', 'you', 'help', 'using'].includes(w))
      .slice(0, 4);

    const slug = words.length > 0 ? words.join('-') : 'new-project';
    const friendlyName = words.length > 0
      ? words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : 'New Project';

    return { slug, friendlyName };
  }
}

/**
 * Generate project metadata (icon, description)
 */
async function generateProjectMetadata(
  prompt: string,
  model: string
): Promise<{ icon: string; description: string }> {
  const metadataPrompt = `Based on this project request, generate appropriate metadata:

User's request: "${prompt}"

Available icons: Folder, Code, Layout, Database, Zap, Globe, Lock, Users, ShoppingCart, Calendar, MessageSquare, FileText, Image, Music, Video, CheckCircle, Star

Generate:
- icon: Most appropriate icon from the list above
- description: 1-2 sentences describing what the project does

IMPORTANT: Focus on the actual functionality being requested.`;

  try {
    console.log('[project-analyzer] Generating project metadata...');
    const result = await generateStructuredOutput({
      model,
      schema: ProjectMetadataSchema.pick({ icon: true, description: true }).extend({
        slug: z.string().optional(),
        friendlyName: z.string().optional(),
      }),
      prompt: metadataPrompt,
    });

    console.log(`[project-analyzer] Generated icon: ${result.object.icon}`);
    return { 
      icon: result.object.icon, 
      description: result.object.description 
    };
  } catch (error) {
    console.error('[project-analyzer] Metadata generation failed, using defaults:', error);
    return {
      icon: 'Code',
      description: prompt.substring(0, 150),
    };
  }
}

/**
 * Select template based on prompt (AI analysis)
 */
async function selectTemplateWithAI(
  prompt: string,
  templates: Template[],
  model: string
): Promise<{ template: Template; reasoning: string; confidence: number }> {
  const templateContext = templates.map(t => `
## ${t.name} (ID: ${t.id})
${t.description}
Keywords: ${t.selection.keywords.join(', ')}
Use cases: ${t.selection.useCases.join('; ')}
Tech: ${t.tech.framework} ${t.tech.version}, ${t.tech.language}
`).join('\n---\n');

  const selectionPrompt = `Select the best template for this project:

User's request: "${prompt}"

Available templates:
${templateContext}

Selection guidelines:
- react-vite: Simple SPAs, prototypes, basic UIs
- nextjs-fullstack: Full-stack apps needing auth, database, API routes, SSR
- astro-static: Blogs, documentation, landing pages

Return the template ID, your reasoning, and confidence score.
VALID templateId values: ${templates.map(t => t.id).join(', ')}`;

  try {
    console.log('[project-analyzer] Analyzing prompt for template selection...');
    const result = await generateStructuredOutput({
      model,
      schema: TemplateAnalysisSchema,
      prompt: selectionPrompt,
    });

    const template = templates.find(t => t.id === result.object.templateId);
    if (!template) {
      throw new Error(`Template ${result.object.templateId} not found`);
    }

    console.log(`[project-analyzer] Selected template: ${template.name} (confidence: ${result.object.confidence})`);
    console.log(`[project-analyzer] Reasoning: ${result.object.reasoning}`);
    
    return {
      template,
      reasoning: result.object.reasoning,
      confidence: result.object.confidence,
    };
  } catch (error) {
    console.error('[project-analyzer] Template selection failed, using fallback:', error);
    
    // Fallback to keyword-based selection
    const promptLower = prompt.toLowerCase();
    let template = templates.find(t => t.id === 'react-vite'); // Default
    
    if (promptLower.includes('next') || promptLower.includes('full-stack') || promptLower.includes('database') || promptLower.includes('auth')) {
      template = templates.find(t => t.id === 'nextjs-fullstack') || template;
    } else if (promptLower.includes('blog') || promptLower.includes('landing') || promptLower.includes('static') || promptLower.includes('docs')) {
      template = templates.find(t => t.id === 'astro-static') || template;
    }
    
    return {
      template: template!,
      reasoning: 'Fallback keyword-based selection',
      confidence: 0.5,
    };
  }
}

/**
 * Get template from framework tag (fast path - no AI)
 */
function getTemplateFromTag(
  templates: Template[],
  tags: AppliedTag[]
): Template | null {
  const frameworkTag = tags.find(t => t.key === 'framework');
  if (!frameworkTag) return null;

  // Find template matching the framework tag
  const matchingTemplate = templates.find(t =>
    t.tech.framework.toLowerCase() === frameworkTag.value.toLowerCase()
  );

  if (matchingTemplate) {
    console.log(`[project-analyzer] Using template from framework tag: ${matchingTemplate.name}`);
    return matchingTemplate;
  }

  // Try to get template info from TAG_DEFINITIONS
  const frameworkDef = TAG_DEFINITIONS.find(d => d.key === 'framework');
  const frameworkOption = frameworkDef?.options?.find(o => o.value === frameworkTag.value);
  
  if (frameworkOption?.repository) {
    console.log(`[project-analyzer] Framework tag found but no matching template, using tag metadata`);
    // Return null - caller should use tag metadata directly
    return null;
  }

  return null;
}

export interface AnalyzeProjectOptions {
  prompt: string;
  agent: AgentId;
  claudeModel?: ClaudeModelId;
  tags?: AppliedTag[];
}

export interface AnalyzeProjectResult {
  slug: string;
  friendlyName: string;
  description: string;
  icon: string;
  template: {
    id: string;
    name: string;
    framework: string;
    port: number;
    runCommand: string;
    repository: string;
    branch: string;
  };
}

/**
 * Main analysis function - orchestrates all AI calls
 * 
 * Sends events via callback as analysis progresses:
 * - analysis-started
 * - project-metadata (with results)
 * - analysis-complete
 */
export async function analyzeProject(
  options: AnalyzeProjectOptions,
  sendEvent: (event: RunnerEvent) => void,
  commandId: string
): Promise<AnalyzeProjectResult> {
  const { prompt, agent, claudeModel, tags } = options;
  const model = claudeModel || 'claude-sonnet-4-5';
  
  console.log('[project-analyzer] Starting project analysis...');
  console.log(`[project-analyzer] Agent: ${agent}, Model: ${model}`);
  
  // Emit analysis started
  sendEvent({
    type: 'analysis-started',
    commandId,
    timestamp: new Date().toISOString(),
  } as RunnerEvent);

  // Load templates
  const templates = await getAllTemplates();
  console.log(`[project-analyzer] Loaded ${templates.length} templates`);

  // Step 1: Template Selection
  let selectedTemplate: Template | null = null;

  // Fast path: Check if framework tag is present
  if (tags && tags.length > 0) {
    const tagTemplate = getTemplateFromTag(templates, tags);
    if (tagTemplate) {
      selectedTemplate = tagTemplate;
      console.log('[project-analyzer] FAST PATH: Using template from framework tag');
    } else {
      // Check if we have tag metadata without matching template
      const frameworkTag = tags.find(t => t.key === 'framework');
      if (frameworkTag) {
        const frameworkDef = TAG_DEFINITIONS.find(d => d.key === 'framework');
        const frameworkOption = frameworkDef?.options?.find(o => o.value === frameworkTag.value);
        
        if (frameworkOption?.repository) {
          // Build synthetic template from tag
          selectedTemplate = {
            id: `${frameworkTag.value}-default`,
            name: frameworkOption.label,
            description: `Template for ${frameworkOption.label}`,
            repository: frameworkOption.repository,
            branch: frameworkOption.branch || 'main',
            selection: { keywords: [], useCases: [], examples: [] },
            tech: {
              framework: frameworkTag.value,
              version: 'latest',
              language: 'TypeScript',
              styling: 'Tailwind CSS',
              packageManager: 'pnpm',
              nodeVersion: '20',
            },
            setup: {
              defaultPort: 3000,
              installCommand: 'pnpm install',
              devCommand: 'pnpm dev',
              buildCommand: 'pnpm build',
            },
            ai: { systemPromptAddition: '', includedFeatures: [] },
          };
          console.log('[project-analyzer] FAST PATH: Built template from tag metadata');
        }
      }
    }
  }

  // Slow path: AI template selection (if not already selected via tag)
  if (!selectedTemplate) {
    console.log('[project-analyzer] Running AI template selection...');
    const selection = await selectTemplateWithAI(prompt, templates, model);
    selectedTemplate = selection.template;
  }

  // At this point selectedTemplate is guaranteed to be assigned
  const finalTemplate = selectedTemplate;

  // Step 2: Generate project name (parallel-capable but keeping sequential for simplicity)
  const { slug, friendlyName } = await generateProjectName(prompt, model);

  // Step 3: Generate metadata (icon, description)
  const { icon, description } = await generateProjectMetadata(prompt, model);

  // Build result
  const result: AnalyzeProjectResult = {
    slug,
    friendlyName,
    description,
    icon,
    template: {
      id: finalTemplate.id,
      name: finalTemplate.name,
      framework: finalTemplate.tech.framework,
      port: finalTemplate.setup.defaultPort,
      runCommand: finalTemplate.setup.devCommand,
      repository: finalTemplate.repository,
      branch: finalTemplate.branch,
    },
  };

  // Emit project metadata
  sendEvent({
    type: 'project-metadata',
    commandId,
    timestamp: new Date().toISOString(),
    payload: {
      path: '', // Not yet created
      projectType: result.template.framework,
      runCommand: result.template.runCommand,
      port: result.template.port,
      detectedFramework: result.template.framework,
      slug: result.slug,
      friendlyName: result.friendlyName,
      description: result.description,
      icon: result.icon,
      template: result.template,
    },
  } as RunnerEvent);

  // Emit analysis complete
  sendEvent({
    type: 'analysis-complete',
    commandId,
    timestamp: new Date().toISOString(),
  } as RunnerEvent);

  console.log('[project-analyzer] Analysis complete!');
  console.log(`[project-analyzer] Project: ${friendlyName} (${slug})`);
  console.log(`[project-analyzer] Template: ${finalTemplate.name}`);
  console.log(`[project-analyzer] Icon: ${icon}`);

  return result;
}
