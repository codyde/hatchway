/**
 * Start command with TUI dashboard support
 * Provides beautiful real-time monitoring of all services
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink';
import React from 'react';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { configManager } from '../utils/config-manager.js';
import { isInsideMonorepo } from '../utils/repo-detector.js';
import { killProcessOnPort } from '../utils/process-killer.js';
import { CLIError, errors } from '../utils/cli-error.js';
import { ServiceManager } from '../ui/service-manager.js';
import { Dashboard } from '../ui/Dashboard.js';
import { ConsoleInterceptor } from '../ui/console-interceptor.js';
import { LogFileManager } from '../ui/log-file-manager.js';
import { initRunnerLogger } from '../../lib/logging/index.js';
import { setFileLoggerTuiMode } from '../../lib/file-logger.js';
import { extractBuildErrors } from '../utils/build-error-extractor.js';

interface StartOptions {
  port?: string;
  noTui?: boolean; // Disable TUI, use traditional logs
  dev?: boolean; // Use development mode (hot reload)
  rebuild?: boolean; // Rebuild services before starting
  local?: boolean; // Enable local mode (default: true, use --no-local to disable)
  verbose?: boolean; // Enable verbose logging
}

/**
 * Check if we should use TUI
 */
function shouldUseTUI(options: StartOptions): boolean {
  // Explicit flag
  if (options.noTui) return false;

  // CI/CD environments
  if (process.env.CI === '1' || process.env.CI === 'true') return false;

  // Not a TTY
  if (!process.stdout.isTTY) return false;

  // Explicit env var to disable
  if (process.env.NO_TUI === '1') return false;

  return true;
}

export async function startCommand(options: StartOptions) {
  const useTUI = shouldUseTUI(options);

  // If TUI is disabled, use the traditional start command
  if (!useTUI) {
    const { startCommand: traditionalStart } = await import('./start-traditional.js');
    return traditionalStart(options);
  }

  // ========================================
  // TUI MODE
  // ========================================

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
    const { installDependencies } = await import('../utils/repo-cloner.js');
    await installDependencies(monorepoRoot);
    s.stop(pc.green('✓') + ' Dependencies installed');
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
    const { spawn } = await import('child_process');

    // Capture build output for error reporting
    let buildOutput = '';
    let buildError = '';

    try {
      // Use turbo to build all services with caching
      await new Promise<void>((resolve, reject) => {
        const buildProcess = spawn('pnpm', ['build:all'], {
          cwd: monorepoRoot,
          stdio: 'pipe', // Capture output
        });

        buildProcess.stdout?.on('data', (data: Buffer) => {
          buildOutput += data.toString();
        });

        buildProcess.stderr?.on('data', (data: Buffer) => {
          buildError += data.toString();
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
      
      // Extract meaningful error lines from build output
      const allOutput = (buildOutput + '\n' + buildError).trim();
      const errorLines = extractBuildErrors(allOutput);
      
      const suggestions = [
        'Check that all dependencies are installed',
        'Try running: pnpm build:all',
        'Run with --dev flag to skip build and use dev mode',
      ];
      
      // Add error context if available
      if (errorLines.length > 0) {
        console.log(pc.red('\nBuild errors:'));
        console.log(pc.gray('─'.repeat(60)));
        errorLines.forEach(line => console.log(pc.red(`  ${line}`)));
        console.log(pc.gray('─'.repeat(60)));
        console.log('');
      }
      
      throw new CLIError({
        code: 'BUILD_FAILED',
        message: 'Failed to build services',
        suggestions,
      });
    }
  }

  // Step 3: Check database configuration
  if (!config.databaseUrl) {
    throw new CLIError({
      code: 'MISSING_REQUIRED_CONFIG',
      message: 'Database URL not configured',
      suggestions: [
        'Run initialization: hatchway init',
        'Or set manually: hatchway config set databaseUrl <url>',
      ],
      docs: 'https://github.com/codyde/hatchway#database-setup',
    });
  }

  // Step 4: Clean up zombie processes
  const webPort = Number(options.port || '3000');

  s.start('Checking for port conflicts');
  await killProcessOnPort(webPort);
  s.stop(pc.green('✓') + ' Ports available');

  // Step 5: Create ServiceManager, LogFileManager, and Console Interceptor FIRST
  const serviceManager = new ServiceManager();
  const logFileManager = new LogFileManager();
  logFileManager.start(); // Start log file writing immediately
  const consoleInterceptor = new ConsoleInterceptor(serviceManager, logFileManager);

  // Start intercepting IMMEDIATELY before anything else can print
  consoleInterceptor.start();

  const sharedSecret = configManager.getSecret() || 'dev-secret';

  // Hook up service manager output to log file (for child process logs)
  serviceManager.on('service:output', (name, output, stream) => {
    logFileManager.write(name, output.trim(), stream);
  });

  // Keep silent mode for TUI, logs go to file
  process.env.SILENT_MODE = '1';

  // Clear screen for clean TUI start
  console.clear();

  // Register web app (now handles runner WebSocket connections directly)
  // Default to production mode unless --dev flag is present
  const webCommand = options.dev ? 'dev' : 'start';
  
  // Local mode is enabled by default, can be disabled with --no-local
  const isLocalMode = options.local !== false;
  
  // Write .env.local file to ensure env vars are available to Next.js
  // This is necessary because env vars passed to spawn() may not be visible
  // to Next.js server components in production mode
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
  
  // Build environment variables for the web app
  const webEnv: Record<string, string> = {
    PORT: String(webPort),
    RUNNER_SHARED_SECRET: sharedSecret,
    WORKSPACE_ROOT: config.workspace,
    RUNNER_ID: config.runner?.id || 'local',
    RUNNER_DEFAULT_ID: config.runner?.id || 'local',
    DATABASE_URL: config.databaseUrl,
    // Enable local mode - bypasses authentication requirements (default: true)
    HATCHWAY_LOCAL_MODE: isLocalMode ? 'true' : 'false',
  };
  
  serviceManager.register({
    name: 'web',
    displayName: 'Web App',
    port: webPort,
    command: 'pnpm',
    args: ['--filter', 'hatchway', webCommand],
    cwd: monorepoRoot,
    env: webEnv,
  });

  // Register runner (special handling - not spawned, imported directly)
  serviceManager.register({
    name: 'runner',
    displayName: 'Runner',
    command: 'internal', // Not actually spawned
    args: [],
    cwd: monorepoRoot,
    env: {},
  });

  // Step 6: Clear screen and move cursor to home before TUI renders
  // Use ANSI codes that will pass through our interceptor
  process.stdout.write('\x1b[2J\x1b[H'); // Clear screen + move cursor to top-left

  // Ensure stdin is in raw mode for keyboard input
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  // Track runner cleanup function and shutting down state
  let isShuttingDown = false;
  let runnerCleanupFn: (() => Promise<void>) | undefined;

  // Add backup SIGINT handler for Ctrl+C (in case Ink's doesn't fire)
  const handleSigInt = async () => {
    if (isShuttingDown) {
      // Force exit if already shutting down
      process.exit(1);
    }
    isShuttingDown = true;

    console.log('\n⚠ Received Ctrl+C, stopping services...');

    // Stop runner first if cleanup function exists
    if (runnerCleanupFn) {
      await runnerCleanupFn().catch(() => {});
    }

    // Then stop other services
    await serviceManager.stopAll().catch(() => {});
    consoleInterceptor.stop();
    process.exit(0);
  };

  process.on('SIGINT', handleSigInt);

  // One final clear right before rendering
  process.stdout.write('\x1b[2J\x1b[H');

  // Enable alternate screen buffer to prevent scrolling above TUI
  process.stdout.write('\x1b[?1049h'); // Enter alternate screen
  process.stdout.write('\x1b[2J\x1b[H'); // Clear and home

  // Initialize the RunnerLogger BEFORE rendering TUI so the TUI can subscribe to build events
  // This must happen before startRunner() which would create its own logger
  initRunnerLogger({
    verbose: options.verbose || false,
    tuiMode: true,
  });
  
  // Enable TUI mode in file-logger to suppress terminal output
  setFileLoggerTuiMode(true);

  // Render TUI immediately with log file path
  const { waitUntilExit, clear } = render(
    React.createElement(Dashboard, {
      serviceManager,
      apiUrl: `http://localhost:${webPort}`,
      webPort,
      logFilePath: consoleInterceptor.getLogFilePath()
    }),
    {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      exitOnCtrlC: true,
      patchConsole: false // Don't let Ink patch console since we already intercept
    }
  );

  // Step 7: Start services
  try {
    // Start web app (runner will be started separately)
    await serviceManager.start('web');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for WebSocket server to initialize

    // Mark runner as starting
    const runnerService = serviceManager['services'].get('runner');
    if (runnerService) {
      runnerService.state.status = 'starting';
      runnerService.startTime = Date.now();
      serviceManager.emit('service:status-change', 'runner', 'starting');
    }

    // Start runner directly (this blocks until shutdown)
    const { startRunner } = await import('../../index.js');

    // Mark as running
    if (runnerService) {
      runnerService.state.status = 'running';
      serviceManager.emit('service:status-change', 'runner', 'running');
    }

    // Start runner and get cleanup function - connects directly to Next.js WebSocket
    runnerCleanupFn = await startRunner({
      wsUrl: `ws://localhost:${webPort}/ws/runner`,
      sharedSecret: sharedSecret,
      runnerId: config.runner?.id || 'local',
      workspace: config.workspace,
      silent: false, // Changed to false - show all logs
      verbose: options.verbose,
      tuiMode: true, // TUI mode enabled
    });

    // Wait for TUI to exit
    await waitUntilExit();

    // Stop console interception and restore normal console
    consoleInterceptor.stop();

    // Clear TUI immediately
    clear();

    // Exit alternate screen buffer
    process.stdout.write('\x1b[?1049l');

    // Show shutdown message
    console.log();
    console.log(pc.yellow('⚠'), 'Stopping all services...');

    // Stop all services with timeout
    const shutdownPromise = Promise.race([
      (async () => {
        // Close any active tunnels first (give it 1s)
        await serviceManager.closeTunnel('web').catch(() => {});

        // Stop spawned services (web, broker)
        await serviceManager.stopAll();
        console.log(pc.green('✓'), 'Services stopped');

        // Stop runner explicitly using cleanup function
        if (runnerCleanupFn) {
          console.log(pc.yellow('⚠'), 'Stopping runner...');
          await runnerCleanupFn();
          console.log(pc.green('✓'), 'Runner stopped');
        }

        console.log(pc.green('✓'), 'All services stopped');
      })(),
      new Promise((resolve) => setTimeout(() => {
        console.log(pc.yellow('⚠'), 'Shutdown timeout - forcing exit');
        resolve(undefined);
      }, 5000)) // Increased from 3s to 5s to allow tunnel cleanup
    ]);

    await shutdownPromise;

    // Force exit to ensure we return to prompt
    process.exit(0);
  } catch (error) {
    // Stop console interception on error
    consoleInterceptor.stop();
    clear();
    // Exit alternate screen buffer
    process.stdout.write('\x1b[?1049l');
    throw error;
  }
}
