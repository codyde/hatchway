import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Get the workspace root directory for the runner.
 * This is where projects will be stored.
 */
export function getWorkspaceRoot(): string {
  // Check environment variable first
  const envWorkspace = process.env.WORKSPACE_ROOT;
  if (envWorkspace && existsSync(envWorkspace)) {
    return resolve(envWorkspace);
  }

  // Default to a workspace directory in the user's home
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const defaultWorkspace = resolve(homeDir, 'hatchway-workspace');

  return defaultWorkspace;
}
