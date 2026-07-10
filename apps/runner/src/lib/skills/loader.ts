/**
 * Skill loader for composing agent system prompts from modular skill files.
 *
 * Skills are modular pieces of procedural knowledge that get conditionally
 * composed into the system prompt based on agent type and project context.
 * This is the compatibility path for non-Claude agents (codex, opencode,
 * droid). Claude receives the essential workflow in its compact base prompt.
 */

import type { AgentId } from '@hatchway/agent-core/types/agent';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type SkillName =
  | 'todo-workflow'
  | 'todo-workflow-codex'
  | 'communication-style'
  | 'dependency-management'
  | 'design-excellence'
  | 'template-originality'
  | 'build-verification'
  | 'context-awareness'
  | 'architectural-thinking';

const skillCache = new Map<string, string>();

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
}

export function loadSkill(name: SkillName): string {
  if (skillCache.has(name)) {
    return skillCache.get(name)!;
  }

  const candidates = [
    join(__dirname, 'platform-plugin', 'skills', name, 'SKILL.md'),
    join(__dirname, 'lib', 'skills', 'platform-plugin', 'skills', name, 'SKILL.md'),
  ];

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const content = stripFrontmatter(raw);
      skillCache.set(name, content);
      return content;
    } catch {
      // Try next candidate
    }
  }

  if (process.env.SILENT_MODE !== '1') {
    process.stderr.write(`[skills] Could not load skill "${name}" from any path. Searched: ${candidates.join(', ')}\n`);
  }
  return `[Skill "${name}" not found]`;
}

export interface SkillContext {
  agentId: AgentId;
  isNewProject: boolean;
  hasDesignTags: boolean;
}

export function composeSkills(context: SkillContext): string[] {
  const sections: string[] = [];
  const loaded: SkillName[] = [];

  function add(name: SkillName) {
    sections.push(loadSkill(name));
    loaded.push(name);
  }

  // Agent-specific todo tracking
  if (context.agentId === 'openai-codex') {
    add('todo-workflow-codex');
  } else {
    add('todo-workflow');
  }

  // Always: communication and core discipline
  add('communication-style');
  add('context-awareness');
  add('dependency-management');

  // New project skills
  if (context.isNewProject) {
    add('architectural-thinking');
    add('template-originality');
  }

  // Design skills: new projects or when design tags present
  if (context.isNewProject || context.hasDesignTags) {
    add('design-excellence');
  }

  // Always: build verification
  add('build-verification');

  const totalChars = sections.reduce((sum, s) => sum + s.length, 0);
  if (process.env.SILENT_MODE !== '1') {
    process.stderr.write(`[skills] Composed ${loaded.length} skills (${totalChars} chars) for agent=${context.agentId} isNew=${context.isNewProject} hasDesign=${context.hasDesignTags}: [${loaded.join(', ')}]\n`);
  }

  return sections;
}

export function clearSkillCache(): void {
  skillCache.clear();
}
