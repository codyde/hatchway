import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Check if current directory or a given path contains the Hatchway monorepo
 */
export async function isHatchwayRepo(path: string = process.cwd()): Promise<boolean> {
  try {
    // Check for key indicators
    const packageJsonPath = join(path, 'package.json');
    const runnerPath = join(path, 'apps/runner');
    const hatchwayPath = join(path, 'apps/hatchway');

    // Must have package.json
    if (!existsSync(packageJsonPath)) {
      return false;
    }

    // Must have the core app directories
    if (!existsSync(runnerPath) || !existsSync(hatchwayPath)) {
      return false;
    }

    // Verify package.json has correct name
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    if (packageJson.name !== 'hatchway-monorepo') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Find the Hatchway monorepo root from current location
 * Searches up the directory tree
 */
export async function findMonorepoRoot(startPath: string = process.cwd()): Promise<string | null> {
  let currentPath = startPath;
  const root = '/';

  while (currentPath !== root) {
    if (await isHatchwayRepo(currentPath)) {
      return currentPath;
    }

    // Move up one directory
    const parentPath = join(currentPath, '..');
    if (parentPath === currentPath) {
      break; // Reached root
    }
    currentPath = parentPath;
  }

  return null;
}

/**
 * Check if we're inside the monorepo (current dir or any parent)
 */
export async function isInsideMonorepo(): Promise<{ inside: boolean; root?: string }> {
  const root = await findMonorepoRoot();
  return {
    inside: root !== null,
    root: root || undefined,
  };
}
