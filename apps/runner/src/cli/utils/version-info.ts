/**
 * Version and git commit info utilities
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find the package root directory (apps/runner).
 * Works in both development (src/cli/utils/) and production (dist/cli/utils/) modes.
 */
function findPackageRoot(): string {
  // Try multiple possible locations
  const possiblePaths = [
    // Development: src/cli/utils/ -> apps/runner (3 levels up)
    join(__dirname, '..', '..', '..'),
    // Production from dist/cli/utils/: -> apps/runner (3 levels up, same structure)
    join(__dirname, '..', '..', '..'),
  ];
  
  for (const path of possiblePaths) {
    const packageJsonPath = join(path, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        // Verify this is the runner package
        if (pkg.name === '@hatchway/cli') {
          return path;
        }
      } catch {
        // Continue to next path
      }
    }
  }
  
  // Fallback to the standard path
  return join(__dirname, '..', '..', '..');
}

// Cache the package root
const packageRoot = findPackageRoot();

/**
 * Get the package version from package.json
 */
export function getPackageVersion(): string {
  try {
    const packageJsonPath = join(packageRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || '0.0.0';
    }
  } catch {
    // Ignore errors
  }
  return '0.0.0';
}

/**
 * Get the short git commit hash
 */
export function getGitCommit(): string | null {
  try {
    // Try to get commit from git command
    const commit = execSync('git rev-parse --short HEAD', {
      cwd: packageRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return commit || null;
  } catch {
    // Git not available or not a git repo
    return null;
  }
}

/**
 * Get combined version string with commit
 * Returns "v0.19.1 (abc1234)" or just "v0.19.1" if no commit
 */
export function getVersionString(): string {
  const version = getPackageVersion();
  const commit = getGitCommit();
  
  if (commit) {
    return `v${version} (${commit})`;
  }
  return `v${version}`;
}

/**
 * Version info object
 */
export interface VersionInfo {
  version: string;
  commit: string | null;
  display: string;
}

/**
 * Get all version info
 */
export function getVersionInfo(): VersionInfo {
  const version = getPackageVersion();
  const commit = getGitCommit();
  
  return {
    version,
    commit,
    display: commit ? `v${version} (${commit})` : `v${version}`,
  };
}
