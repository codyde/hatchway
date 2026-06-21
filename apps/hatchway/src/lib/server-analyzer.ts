/**
 * Server-side project analysis for Sandbox execution mode.
 *
 * In Local mode, `/api/projects/analyze` dispatches `analyze-project` to a
 * connected runner. In Sandbox mode there is no runner (and no project) yet at
 * analyze time, so we run the same template-selection + metadata generation on
 * the server using the Anthropic Messages API (the server holds ANTHROPIC_API_KEY)
 * and the bundled templates.json. The result shape matches the runner's so
 * `create-from-analysis` is unchanged.
 */
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import { setTemplatesPath, getAllTemplates } from '@hatchway/agent-core/lib/templates/config.server';
import type { Template } from '@hatchway/agent-core/lib/templates/config';
import { TAG_DEFINITIONS } from '@hatchway/agent-core/config/tags';
import type { AppliedTag } from '@hatchway/agent-core/types/tags';

export interface ServerAnalysisResult {
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

// Analysis is cheap classification — map everything to Sonnet unless Opus asked for.
const MODEL_MAP: Record<string, string> = {
  'claude-haiku-4-5': 'claude-sonnet-4-6',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-8': 'claude-opus-4-8',
};

const ICONS = [
  'Folder', 'Code', 'Layout', 'Database', 'Zap', 'Globe', 'Lock', 'Users',
  'ShoppingCart', 'Calendar', 'MessageSquare', 'FileText', 'Image', 'Music',
  'Video', 'CheckCircle', 'Star',
] as const;

let templatesConfigured = false;
function ensureTemplatesPath(): void {
  if (templatesConfigured) return;
  // The server process runs from apps/hatchway, where templates.json is shipped.
  setTemplatesPath(path.join(process.cwd(), 'templates.json'));
  templatesConfigured = true;
}

/** Fast path: if the user picked a framework tag, use that template (no LLM choice). */
function templateFromFrameworkTag(templates: Template[], tags?: AppliedTag[]): Template | null {
  const fw = tags?.find((t) => t.key === 'framework');
  if (!fw) return null;

  const direct = templates.find((t) => t.tech.framework === fw.value);
  if (direct) return direct;

  const def = TAG_DEFINITIONS.find((d) => d.key === 'framework');
  const opt = def?.options?.find((o) => o.value === fw.value) as
    | { label?: string; repository?: string; branch?: string }
    | undefined;
  if (opt?.repository) {
    return {
      id: `${fw.value}-default`,
      name: opt.label || fw.value,
      description: `Template for ${opt.label || fw.value}`,
      repository: opt.repository,
      branch: opt.branch || 'main',
      selection: { keywords: [], useCases: [], examples: [] },
      tech: {
        framework: fw.value,
        version: 'latest',
        language: 'TypeScript',
        styling: 'Tailwind CSS',
        packageManager: 'pnpm',
        nodeVersion: '20',
      },
      setup: { defaultPort: 3000, installCommand: 'pnpm install', devCommand: 'pnpm dev', buildCommand: 'pnpm build' },
      ai: { systemPromptAddition: '', includedFeatures: [] },
    } as Template;
  }
  return null;
}

export async function analyzeProjectServerSide(opts: {
  prompt: string;
  claudeModel?: string;
  tags?: AppliedTag[];
}): Promise<ServerAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the server (required for Sandbox-mode analysis)');

  ensureTemplatesPath();
  const templates = await getAllTemplates();
  if (templates.length === 0) throw new Error('No templates available for analysis');

  const model = MODEL_MAP[opts.claudeModel ?? ''] ?? 'claude-sonnet-4-6';
  const tagTemplate = templateFromFrameworkTag(templates, opts.tags);

  const templateList = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    framework: t.tech.framework,
    keywords: t.selection.keywords,
  }));

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    system:
      'You analyze an app-build prompt and (a) choose the best-matching starter template ' +
      'from the provided list and (b) generate project metadata. ' +
      `Available templates: ${JSON.stringify(templateList)}. ` +
      (tagTemplate
        ? `The user pre-selected template id "${tagTemplate.id}"; you MUST return that templateId.`
        : 'Pick the templateId whose framework/keywords best fit the prompt.'),
    tools: [
      {
        name: 'project_analysis',
        description: 'Return the chosen template id and generated project metadata.',
        input_schema: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: 'ID of the chosen template from the list' },
            slug: { type: 'string', description: 'URL-friendly id: lowercase, hyphens, 2-4 words' },
            friendlyName: { type: 'string', description: 'Human-readable name: Title Case, 2-5 words' },
            description: { type: 'string', description: 'One concise sentence describing the app' },
            icon: { type: 'string', enum: ICONS as unknown as string[], description: 'Best-fitting Lucide icon name' },
          },
          required: ['templateId', 'slug', 'friendlyName', 'description', 'icon'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'project_analysis' },
    messages: [{ role: 'user', content: `Build prompt: ${opts.prompt}` }],
  });

  const toolUse = msg.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Server-side analysis returned no structured output');
  }
  const out = toolUse.input as {
    templateId: string;
    slug: string;
    friendlyName: string;
    description: string;
    icon: string;
  };

  const chosen = tagTemplate ?? templates.find((t) => t.id === out.templateId) ?? templates[0];

  return {
    slug: out.slug,
    friendlyName: out.friendlyName,
    description: out.description,
    icon: ICONS.includes(out.icon as (typeof ICONS)[number]) ? out.icon : 'Code',
    template: {
      id: chosen.id,
      name: chosen.name,
      framework: chosen.tech.framework,
      port: chosen.setup.defaultPort,
      runCommand: chosen.setup.devCommand,
      repository: chosen.repository,
      branch: chosen.branch,
    },
  };
}
