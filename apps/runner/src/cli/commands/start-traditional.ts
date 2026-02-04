/**
 * Enhanced start command with graceful shutdown and better error handling
 * Starts the full stack: Web App + Runner (no broker - runner connects directly)
 */

import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { configManager } from '../utils/config-manager.js';
import { findMonorepoRoot, isInsideMonorepo } from '../utils/repo-detector.js';
import { killProcessOnPort } from '../utils/process-killer.js';
import { CLIError, errors } from '../utils/cli-error.js';
import { shutdownHandler } from '../index.js';

interface StartOptions {
  port?: string;
  dev?: boolean; // Use development mode (hot reload)
  rebuild?: boolean; // Rebuild services before starting
  local?: boolean; // Enable local mode (default: true, use --no-local to disable)
  verbose?: boolean; // Enable verbose logging
}

interface ManagedProcess {
  name: string;
  process: ChildProcess;
  port?: number;
}

export async function startCommand(options: StartOptions) {
  const s = p.spinner();

  // Step 1: Find monorepo
  s.start('Locating Hatchway repository');

  let monorepoRoot: string | undefined;
  const config = configManager.get();

  // Try config first
  if (config.monorepoPath && existsSync(config.monorepoPath)) {
    monorepoRoot = config.monorepoPath;
  }

  // Try detection
  if (!monorepoRoot) {
    const repoCheck = await isInsideMonorepo();
    if (repoCheck.inside && repoCheck.root) {
      monorepoRoot = repoCheck.root;
      configManager.set('monorepoPath', monorepoRoot);
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

  // Step 2: Check dependencies
  const nodeModulesPath = join(monorepoRoot, 'node_modules');

  if (!existsSync(nodeModulesPath)) {
    s.start('Installing dependencies');
    try {
      const { installDependencies } = await import('../utils/repo-cloner.js');
      await installDependencies(monorepoRoot);
      s.stop(pc.green('✓') + ' Dependencies installed');
    } catch (error) {
      s.stop(pc.red('✗') + ' Failed to install dependencies');
      throw new CLIError({
        code: 'DEPENDENCIES_INSTALL_FAILED',
        message: 'Failed to install dependencies',
        cause: error instanceof Error ? error : new Error(String(error)),
        suggestions: [
          `Run manually: cd ${monorepoRoot} && pnpm install`,
          'Check your internet connection',
        ],
      });
    }
  }

  // Step 2.5: Check for production build (unless --dev mode)
  const nextBuildIdPath = join(monorepoRoot, 'apps', 'hatchway', '.next', 'BUILD_ID');
  const needsProductionBuild = !options.dev && !existsSync(nextBuildIdPath);

  // Rebuild services if requested OR if production build is missing
  if (options.rebuild || needsProductionBuild) {
    const buildReason = options.rebuild 
      ? 'Rebuilding services' 
      : 'Building for production (first run)';
    s.start(buildReason);

    try {
      // Use turbo to build all services with caching
      await new Promise<void>((resolve, reject) => {
        const buildProcess = spawn('pnpm', ['build:all'], {
          cwd: monorepoRoot,
          stdio: 'inherit', // Show build output in traditional mode
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

      s.stop(pc.green('✓') + ' Build complete (using Turborepo cache)');
    } catch (error) {
      s.stop(pc.red('✗') + ' Build failed');
      throw new CLIError({
        code: 'BUILD_FAILED',
        message: 'Failed to build services',
        suggestions: [
          'Check that all dependencies are installed',
          'Try running: pnpm build:all',
          'Run with --dev flag to skip build and use dev mode',
        ],
      });
    }
  }

  // Step 3: Check database
  if (!config.databaseUrl) {
    throw new CLIError({
      code: 'MISSING_REQUIRED_CONFIG',
      message: 'Database URL not configured',
      suggestions: [
        'Run initialization: hatchway init',
        'Or set manually: hatchway config set databaseUrl <url>',
        'Or setup database: hatchway db',
      ],
      docs: 'https://github.com/codyde/hatchway#database-setup',
    });
  }

  // Step 4: Clean up zombie processes
  const webPort = Number(options.port || '3000');

  s.start('Checking for port conflicts');
  await killProcessOnPort(webPort);
  s.stop(pc.green('✓') + ' Ports available');

  console.log();
  console.log(pc.bold('Starting services...'));
  console.log();

  const processes: ManagedProcess[] = [];
  const sharedSecret = configManager.getSecret() || 'dev-secret';

  // Register cleanup with shutdown handler
  shutdownHandler.onShutdown(async () => {
    console.log();
    console.log(pc.yellow('⚠'), 'Stopping all services...');

    // Kill all child processes
    for (const { name, process: proc } of processes) {
      if (!proc.killed && proc.pid) {
        console.log(pc.dim(`  Stopping ${name}...`));
        proc.kill('SIGTERM');
      }
    }

    // Give them time to exit gracefully
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Force kill stragglers
    for (const { name, port } of processes) {
      if (port) {
        try {
          await killProcessOnPort(port);
        } catch {
          // Best effort
        }
      }
    }

    console.log(pc.green('✓'), 'All services stopped');
  });

  try {
    // Local mode is enabled by default, can be disabled with --no-local
    const isLocalMode = options.local !== false;

    // Write .env.local file to ensure env vars are available to Next.js
    const envLocalPath = join(monorepoRoot, 'apps', 'hatchway', '.env.local');
    const envContent = [
      '# Auto-generated by hatchway CLI - DO NOT EDIT',
      `# Generated at: ${new Date().toISOString()}`,
      '',
      `HATCHWAY_LOCAL_MODE=${isLocalMode ? 'true' : 'false'}`,
      `RUNNER_SHARED_SECRET=${sharedSecret}`,
      `WORKSPACE_ROOT=${config.workspace}`,
      `RUNNER_ID=${config.runner?.id || 'local'}`,
      `RUNNER_DEFAULT_ID=${config.runner?.id || 'local'}`,
      `DATABASE_URL=${config.databaseUrl || ''}`,
      '',
    ].join('\n');

    writeFileSync(envLocalPath, envContent);

    // Start Web App (now handles runner WebSocket connections directly)
    console.log(pc.cyan('1/2'), 'Starting web app...');
    // Default to production mode unless --dev flag is present
    const webCommand = options.dev ? 'dev' : 'start';
    const webApp = spawn('pnpm', ['--filter', 'hatchway', webCommand], {
      cwd: monorepoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        PORT: String(webPort),
        DATABASE_URL: config.databaseUrl,
        RUNNER_SHARED_SECRET: sharedSecret,
        WORKSPACE_ROOT: config.workspace,
        RUNNER_ID: config.runner?.id || 'local',
        RUNNER_DEFAULT_ID: config.runner?.id || 'local',
        // Enable local mode - bypasses authentication requirements (default: true)
        HATCHWAY_LOCAL_MODE: isLocalMode ? 'true' : 'false',
      },
    });

    processes.push({ name: 'Web App', process: webApp, port: webPort });
    shutdownHandler.registerProcess(webApp);

    // Handle web app output
    webApp.stdout?.on('data', (data) => {
      const text = data.toString().trim();
      if (text && !text.includes('warn') && !text.includes('deprecated')) {
        console.log(pc.blue('[web]'), text);
      }
    });

    webApp.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      if (text && !text.includes('warn') && !text.includes('deprecated')) {
        console.log(pc.yellow('[web]'), text);
      }
    });

    webApp.on('exit', (code) => {
      // Exit codes 0, 130 (SIGINT), and 143 (SIGTERM) are normal shutdown
      if (code !== 0 && code !== null && code !== 130 && code !== 143) {
        console.error(pc.red('✗'), `Web app crashed with code ${code}`);
        process.exit(1);
      }
    });

    // Wait for web app and WebSocket server to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Start Runner
    console.log(pc.cyan('2/2'), 'Starting runner...');
    console.log();

    // Success message
    console.log(pc.green('✓'), pc.bold('All services started!'));
    console.log();
    console.log(pc.bold('Services running:'));
    console.log(`  ${pc.blue('Web App:')} http://localhost:${webPort}`);
    console.log(`  ${pc.magenta('Runner:')} Connected to web app`);
    console.log();
    console.log(pc.dim(`Press ${pc.cyan('Ctrl+C')} to stop all services`));
    console.log();

    // Start runner (blocks until shutdown) - connects directly to Next.js WebSocket
    const { startRunner } = await import('../../index.js');
    await startRunner({
      wsUrl: `ws://localhost:${webPort}/ws/runner`,
      sharedSecret: sharedSecret,
      runnerId: config.runner?.id || 'local',
      workspace: config.workspace,
      verbose: options.verbose,
      tuiMode: false, // Traditional mode = no TUI
    });

  } catch (error) {
    // Global error handler will format this nicely
    throw error;
  }
}
