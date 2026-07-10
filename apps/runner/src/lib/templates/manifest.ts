import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export interface ProjectManifestOptions {
  /** Stable template identity. Omit for an existing project that may change. */
  cacheKey?: string;
  maxDepth?: number;
  maxEntries?: number;
  maxContentChars?: number;
}

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_ENTRIES = 220;
const DEFAULT_MAX_CONTENT_CHARS = 24_000;
const MAX_FILE_CHARS = 6_000;

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vercel',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

const EXCLUDED_FILES = new Set([
  '.DS_Store',
  'npm-debug.log',
  'yarn-error.log',
]);

const KEY_FILE_CANDIDATES = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'next.config.ts',
  'next.config.mjs',
  'next.config.js',
  'astro.config.mjs',
  'src/main.tsx',
  'src/main.ts',
  'src/main.jsx',
  'src/main.js',
  'src/App.tsx',
  'src/App.jsx',
  'app/layout.tsx',
  'app/page.tsx',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'client/package.json',
  'server/package.json',
  'client/src/main.tsx',
  'client/src/App.tsx',
] as const;

const manifestCache = new Map<string, Promise<string>>();

function shouldExclude(name: string, isDirectory: boolean): boolean {
  if (isDirectory) return EXCLUDED_DIRECTORIES.has(name);
  if (EXCLUDED_FILES.has(name)) return true;
  return name === '.env' || name.startsWith('.env.');
}

async function buildTree(
  projectPath: string,
  maxDepth: number,
  maxEntries: number
): Promise<{ tree: string; truncated: boolean }> {
  const lines: string[] = ['./'];
  let entryCount = 0;
  let truncated = false;

  async function visit(relativeDirectory: string, depth: number): Promise<void> {
    if (depth > maxDepth || truncated) return;

    let entries;
    try {
      entries = await readdir(join(projectPath, relativeDirectory), { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      if (shouldExclude(entry.name, entry.isDirectory()) || entry.isSymbolicLink()) continue;
      if (entryCount >= maxEntries) {
        truncated = true;
        return;
      }

      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      lines.push(`${'  '.repeat(depth)}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      entryCount++;

      if (entry.isDirectory() && depth < maxDepth) {
        await visit(relativePath, depth + 1);
      }
    }
  }

  await visit('', 1);
  if (truncated) lines.push(`… truncated after ${maxEntries} entries`);
  return { tree: lines.join('\n'), truncated };
}

function normalizeKeyFile(relativePath: string, content: string): string {
  if (!relativePath.endsWith('package.json')) return content;

  try {
    const packageJson = JSON.parse(content) as Record<string, unknown>;
    if (typeof packageJson.name === 'string') packageJson.name = '<project-name>';
    return JSON.stringify(packageJson, null, 2);
  } catch {
    return content;
  }
}

function codeFenceLanguage(filePath: string): string {
  const extension = extname(filePath).slice(1);
  if (extension === 'json') return 'json';
  if (extension === 'tsx' || extension === 'ts' || extension === 'mts') return 'ts';
  if (extension === 'jsx' || extension === 'js' || extension === 'mjs') return 'js';
  return '';
}

async function readKeyFiles(projectPath: string, maxContentChars: number): Promise<string[]> {
  const sections: string[] = [];
  let totalChars = 0;

  for (const relativePath of KEY_FILE_CANDIDATES) {
    if (totalChars >= maxContentChars) break;

    try {
      const raw = await readFile(join(projectPath, relativePath), 'utf8');
      const normalized = normalizeKeyFile(relativePath, raw);
      const remaining = maxContentChars - totalChars;
      const content = normalized.slice(0, Math.min(MAX_FILE_CHARS, remaining));
      const wasTruncated = content.length < normalized.length;
      const section = `#### ${relativePath}\n\`\`\`${codeFenceLanguage(relativePath)}\n${content}${wasTruncated ? '\n… file truncated' : ''}\n\`\`\``;
      sections.push(section);
      totalChars += content.length;
    } catch {
      // Candidate is not present in this template.
    }
  }

  return sections;
}

async function generateProjectManifest(
  projectPath: string,
  options: ProjectManifestOptions
): Promise<string> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const [{ tree }, keyFiles] = await Promise.all([
    buildTree(projectPath, maxDepth, maxEntries),
    readKeyFiles(projectPath, maxContentChars),
  ]);

  const sections = [`### File tree\n\n${tree}`];
  if (keyFiles.length > 0) {
    sections.push(`### Key files\n\n${keyFiles.join('\n\n')}`);
  }
  return sections.join('\n\n');
}

/**
 * Produce bounded, secret-filtered context for the build agent. Template manifests
 * can be cached across builds; mutable existing projects deliberately bypass it.
 */
export function getProjectManifest(
  projectPath: string,
  options: ProjectManifestOptions = {}
): Promise<string> {
  if (!options.cacheKey) return generateProjectManifest(projectPath, options);

  const cacheIdentity = [
    options.cacheKey,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
  ].join(':');
  const cached = manifestCache.get(cacheIdentity);
  if (cached) return cached;

  const generated = generateProjectManifest(projectPath, options).catch(error => {
    manifestCache.delete(cacheIdentity);
    throw error;
  });
  manifestCache.set(cacheIdentity, generated);
  return generated;
}

export function clearProjectManifestCache(): void {
  manifestCache.clear();
}
