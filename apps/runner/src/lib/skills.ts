/**
 * Skills provisioning for the Claude Agent SDK.
 *
 * Platform-level skills are packaged as a local plugin that the SDK
 * discovers via the `plugins` option. The plugin lives within the runner at:
 *   src/lib/skills/platform-plugin/  (dev)
 *   dist/lib/skills/platform-plugin/ (built)
 *
 * The plugin contains:
 *   .claude-plugin/plugin.json   - Plugin manifest
 *   skills/<name>/SKILL.md       - Individual skill files
 *
 * The SDK loads skill descriptions into context and invokes full content
 * on-demand when the agent determines a skill is relevant.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CODEX_ONLY_SKILLS = new Set(['todo-workflow-codex']);

/**
 * Find the platform plugin directory.
 */
function findPluginDir(): string | null {
  const candidates = [
    join(__dirname, 'skills', 'platform-plugin'),                 // dev: src/lib/skills/platform-plugin/
    join(__dirname, 'lib', 'skills', 'platform-plugin'),          // bundle: dist/lib/skills/platform-plugin/
    join(__dirname, '..', 'src', 'lib', 'skills', 'platform-plugin'), // bundle fallback
  ];

  for (const dir of candidates) {
    const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
    if (existsSync(manifestPath)) {
      return dir;
    }
  }
  return null;
}

let _pluginDir: string | null | undefined;

/**
 * Get the absolute path to the platform plugin directory.
 * Pass this to the SDK's `plugins` option as `{ type: "local", path: <this> }`.
 */
export function getPlatformPluginDir(): string | null {
  if (_pluginDir === undefined) {
    _pluginDir = findPluginDir();
    if (_pluginDir) {
      const names = listBundledSkills();
      if (process.env.SILENT_MODE !== '1') {
        process.stderr.write(`[skills] Platform plugin: ${_pluginDir} (${names.length} skills: [${names.join(', ')}])\n`);
      }
    } else {
      if (process.env.SILENT_MODE !== '1') {
        process.stderr.write('[skills] Platform plugin directory not found\n');
      }
    }
  }
  return _pluginDir;
}

/**
 * No-op for backward compatibility.
 */
export function ensureProjectSkills(_projectDirectory: string): boolean {
  return false;
}

/**
 * List available skill names from the plugin.
 */
export function listBundledSkills(): string[] {
  const pluginDir = _pluginDir ?? findPluginDir();
  if (!pluginDir) return [];
  const skillsPath = join(pluginDir, 'skills');
  if (!existsSync(skillsPath)) return [];

  return readdirSync(skillsPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && !CODEX_ONLY_SKILLS.has(d.name))
    .map(d => d.name);
}
