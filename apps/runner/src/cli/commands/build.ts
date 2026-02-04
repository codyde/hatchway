/**
 * Build command - rebuild all services without starting them
 * Useful for rebuilding while services are already running
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { configManager } from '../utils/config-manager.js';
import { isInsideMonorepo } from '../utils/repo-detector.js';
import { CLIError, errors } from '../utils/cli-error.js';

interface BuildOptions {
  watch?: boolean; // Watch mode for continuous rebuilds
}

export async function buildCommand(options: BuildOptions) {
  const s = p.spinner();

  // Step 1: Find monorepo
  s.start('Locating Hatchway repository');

  let monorepoRoot: string | undefined;
  const config = configManager.get();

  if (config.monorepoPath && existsSync(config.monorepoPath)) {
    monorepoRoot = config.monorepoPath;
  }

  if (!monorepoRoot) {
    const repoCheck = await isInsideMonorepo();
    if (repoCheck.inside && repoCheck.root) {
      monorepoRoot = repoCheck.root;
    }
  }

  if (!monorepoRoot) {
    s.stop(pc.red('✗') + ' Repository not found');
    throw errors.monorepoNotFound([
      config.monorepoPath || 'none',
      process.cwd(),
    ]);
  }

  s.stop(pc.green('✓') + ' Repository found');

  // Step 2: Build services
  if (options.watch) {
    console.log();
    console.log(pc.cyan('Building services in watch mode...'));
    console.log(pc.dim('Press Ctrl+C to stop'));
    console.log();

    // Use turbo watch mode
    const watchProcess = spawn('pnpm', ['build:all', '--watch'], {
      cwd: monorepoRoot,
      stdio: 'inherit',
      shell: true,
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log();
      console.log(pc.yellow('⚠'), 'Stopping watch mode...');
      watchProcess.kill('SIGTERM');
      process.exit(0);
    });

    watchProcess.on('error', (error) => {
      throw new CLIError({
        code: 'BUILD_FAILED',
        message: 'Watch mode failed',
        cause: error,
        suggestions: [
          'Check that all dependencies are installed',
          'Try running: pnpm install',
        ],
      });
    });

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      watchProcess.on('close', () => resolve());
    });
  } else {
    s.start('Building all services');

    try {
      await new Promise<void>((resolve, reject) => {
        const buildProcess = spawn('pnpm', ['build:all'], {
          cwd: monorepoRoot,
          stdio: 'inherit', // Show build output
          shell: true,
        });

        buildProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Build failed with code ${code}`));
          }
        });

        buildProcess.on('error', reject);
      });

      s.stop(pc.green('✓') + ' Build complete');

      console.log();
      console.log(pc.dim('Tip: Restart services to use the new build'));
    } catch (error) {
      s.stop(pc.red('✗') + ' Build failed');
      throw new CLIError({
        code: 'BUILD_FAILED',
        message: 'Failed to build services',
        cause: error instanceof Error ? error : new Error(String(error)),
        suggestions: [
          'Check that all dependencies are installed',
          'Try running: pnpm install',
          'Check for TypeScript errors in your code',
        ],
      });
    }
  }
}
