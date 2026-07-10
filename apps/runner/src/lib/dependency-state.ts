import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { getWorkspaceRoot } from './workspace.js';

export type DependencyStateStatus = 'current' | 'missing' | 'stale' | 'not-applicable';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export interface DependencyStateSnapshot {
  status: DependencyStateStatus;
  packageManager: PackageManager;
  dependencyFileCount: number;
  hasInstallArtifacts: boolean;
}

interface DependencyAnalysis extends DependencyStateSnapshot {
  fingerprint: string;
}

interface DependencyStateRecord {
  schemaVersion: 1;
  fingerprint: string;
  packageManager: PackageManager;
  recordedAt: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  architecture: string;
}

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]);

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

const MAX_SCAN_DEPTH = 5;
const MAX_DEPENDENCY_FILES = 100;

function statePath(projectPath: string): string {
  const projectKey = createHash('sha256')
    .update(resolve(projectPath))
    .digest('hex')
    .slice(0, 24);
  return join(getWorkspaceRoot(), '.hatchway-state', 'dependencies', `${projectKey}.json`);
}

async function collectDependencyFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || files.length >= MAX_DEPENDENCY_FILES) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= MAX_DEPENDENCY_FILES || entry.isSymbolicLink()) break;
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await visit(entryPath, depth + 1);
      } else if (DEPENDENCY_FILES.has(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await visit(projectPath, 0);
  return files.sort((left, right) => left.localeCompare(right));
}

async function detectPackageManager(projectPath: string, files: string[]): Promise<PackageManager> {
  const rootPackageJson = join(projectPath, 'package.json');
  try {
    const parsed = JSON.parse(await readFile(rootPackageJson, 'utf8')) as { packageManager?: unknown };
    if (typeof parsed.packageManager === 'string') {
      const declared = parsed.packageManager.split('@')[0];
      if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn' || declared === 'bun') {
        return declared;
      }
    }
  } catch {
    // Fall through to lockfile detection.
  }

  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(projectPath, 'bun.lock')) || existsSync(join(projectPath, 'bun.lockb'))) return 'bun';
  if (existsSync(join(projectPath, 'package-lock.json')) || existsSync(join(projectPath, 'npm-shrinkwrap.json'))) return 'npm';

  const names = new Set(files.map(file => basename(file)));
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('yarn.lock')) return 'yarn';
  if (names.has('bun.lock') || names.has('bun.lockb')) return 'bun';
  if (names.has('package-lock.json') || names.has('npm-shrinkwrap.json')) return 'npm';
  return files.some(file => file.endsWith('package.json')) ? 'npm' : 'unknown';
}

async function hasInstallArtifacts(projectPath: string, files: string[]): Promise<boolean> {
  const packageDirectories = new Set(
    files
      .filter(file => file.endsWith('package.json'))
      .map(file => dirname(file))
  );
  packageDirectories.add(projectPath);
  return [...packageDirectories].some(directory => existsSync(join(directory, 'node_modules')));
}

async function analyzeDependencies(projectPath: string): Promise<DependencyAnalysis> {
  const files = await collectDependencyFiles(projectPath);
  const packageManager = await detectPackageManager(projectPath, files);
  const hash = createHash('sha256');
  hash.update(`node=${process.version}\nplatform=${process.platform}\narch=${process.arch}\n`);

  for (const file of files) {
    hash.update(`file=${relative(projectPath, file)}\n`);
    try {
      hash.update(await readFile(file));
    } catch {
      hash.update('<unreadable>');
    }
    hash.update('\n');
  }

  return {
    status: files.length === 0 ? 'not-applicable' : 'missing',
    packageManager,
    dependencyFileCount: files.length,
    hasInstallArtifacts: await hasInstallArtifacts(projectPath, files),
    fingerprint: hash.digest('hex'),
  };
}

function snapshot(analysis: DependencyAnalysis): DependencyStateSnapshot {
  return {
    status: analysis.status,
    packageManager: analysis.packageManager,
    dependencyFileCount: analysis.dependencyFileCount,
    hasInstallArtifacts: analysis.hasInstallArtifacts,
  };
}

export async function inspectDependencyState(projectPath: string): Promise<DependencyStateSnapshot> {
  const analysis = await analyzeDependencies(projectPath);
  if (analysis.status === 'not-applicable') return snapshot(analysis);

  let record: DependencyStateRecord | undefined;
  try {
    record = JSON.parse(await readFile(statePath(projectPath), 'utf8')) as DependencyStateRecord;
  } catch {
    // No previous successful dependency state has been recorded.
  }

  if (!record) {
    analysis.status = 'missing';
  } else if (record.schemaVersion !== 1 || record.fingerprint !== analysis.fingerprint) {
    analysis.status = 'stale';
  } else {
    analysis.status = analysis.hasInstallArtifacts ? 'current' : 'missing';
  }
  return snapshot(analysis);
}

/** Record state only when install artifacts actually exist after a successful build. */
export async function recordDependencyState(projectPath: string): Promise<DependencyStateSnapshot> {
  const analysis = await analyzeDependencies(projectPath);
  if (analysis.status === 'not-applicable' || !analysis.hasInstallArtifacts) {
    return snapshot(analysis);
  }

  const record: DependencyStateRecord = {
    schemaVersion: 1,
    fingerprint: analysis.fingerprint,
    packageManager: analysis.packageManager,
    recordedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  };
  const filePath = statePath(projectPath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  analysis.status = 'current';
  return snapshot(analysis);
}

export function dependencyGuidance(state: DependencyStateSnapshot): string {
  const commands: Record<PackageManager, string> = {
    npm: 'npm install --prefer-offline --no-audit --no-fund',
    pnpm: 'pnpm install --prefer-offline',
    yarn: 'yarn install',
    bun: 'bun install',
    unknown: 'use the package manager declared by the project',
  };

  const stateInstruction = state.status === 'current'
    ? 'Dependencies are installed and the package manifests, lockfiles, runtime, and platform are unchanged. Do not reinstall unless you modify a dependency file.'
    : state.status === 'not-applicable'
      ? 'No JavaScript dependency manifest exists yet. Install only if your implementation introduces one.'
      : state.status === 'stale'
        ? 'Dependency files changed since the last successful build. One installation is required after all dependency changes are complete.'
        : 'No reusable successful installation is recorded. One installation is required after all dependency changes are complete.';

  return `## Dependency State\n\n- Detected package manager: ${state.packageManager}\n- ${stateInstruction}\n- Finish code and dependency-manifest edits before installing. Batch dependency changes, then run at most one install command.\n- Preferred install command: \`${commands[state.packageManager]}\`.`;
}

export function isDependencyInstallCommand(command: string): boolean {
  return /(?:^|&&|\|\||;)\s*(?:npm\s+(?:install|i|ci|add)|pnpm\s+(?:install|i|add)|yarn\s+(?:install|add)|bun\s+(?:install|add))(?:\s|$)/i.test(command);
}
