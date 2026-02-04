import chalk from 'chalk';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink';
import React from 'react';
import { logger } from '../utils/logger.js';
import { configManager } from '../utils/config-manager.js';
import { startRunner } from '../../index.js';
import { RunnerDashboard } from '../tui/screens/RunnerDashboard.js';
import { initRunnerLogger } from '../../lib/logging/index.js';
import { setFileLoggerTuiMode } from '../../lib/file-logger.js';
import { 
  hasStoredToken, 
  getStoredToken, 
  performOAuthLogin, 
  storeToken 
} from '../utils/cli-auth.js';

// Default public Hatchway instance
const DEFAULT_URL = 'https://hatchway.sh';
const DEFAULT_WORKSPACE = join(homedir(), 'hatchway-workspace');

/**
 * Normalize URL by adding protocol if missing
 * Uses http:// for localhost, https:// for everything else
 */
function normalizeUrl(url: string): string {
  if (!url) return url;

  // If protocol already present, return as-is
  if (url.match(/^https?:\/\//i)) {
    return url;
  }

  // For localhost or 127.0.0.1, use http://
  if (url.match(/^(localhost|127\.0\.0\.1)(:|\/|$)/i)) {
    return `http://${url}`;
  }

  // For everything else, use https://
  return `https://${url}`;
}

/**
 * Derive WebSocket URL from a base HTTP/HTTPS URL
 * Converts https://example.com to wss://example.com/ws/runner
 */
function deriveWsUrl(baseUrl: string): string {
  const normalized = normalizeUrl(baseUrl);
  const wsProtocol = normalized.startsWith('https://') ? 'wss://' : 'ws://';
  const hostPath = normalized.replace(/^https?:\/\//, '');
  // Remove trailing slash if present
  const cleanHostPath = hostPath.replace(/\/$/, '');
  return `${wsProtocol}${cleanHostPath}/ws/runner`;
}

/**
 * Get the current system username
 */
function getSystemUsername(): string {
  try {
    return userInfo().username;
  } catch {
    // Fallback if userInfo() fails
    return process.env.USER || process.env.USERNAME || 'runner';
  }
}

interface RunOptions {
  broker?: string; // Legacy: WebSocket URL override (deprecated, use --url instead)
  url?: string;
  workspace?: string;
  runnerId?: string;
  secret?: string;
  verbose?: boolean;
  local?: boolean; // Enable local mode (bypasses authentication)
  noTui?: boolean; // Disable TUI dashboard
}

/**
 * Check if we should use TUI
 */
function shouldUseTUI(options: RunOptions): boolean {
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

export async function runCommand(options: RunOptions) {
  // Set local mode environment variable if requested
  if (options.local) {
    process.env.HATCHWAY_LOCAL_MODE = 'true';
    logger.info(chalk.yellow('Local mode enabled - authentication bypassed'));
  }

  const useTUI = shouldUseTUI(options);

  // Build runner options from CLI flags or smart defaults
  // NOTE: For the `runner` command, we intentionally ignore local config values
  // and default to the public Hatchway instance. This command is specifically
  // for connecting to remote servers, not local development.
  // Users can still override with CLI flags if needed.
  
  // Resolve API URL: CLI flag > default public instance (ignore config)
  const apiUrl = normalizeUrl(options.url || DEFAULT_URL);
  
  // Resolve WebSocket URL: CLI broker flag > derive from API URL (ignore config)
  const wsUrl = options.broker || deriveWsUrl(apiUrl);
  
  // Resolve workspace: CLI flag > config > default ~/hatchway-workspace
  // (workspace from config is fine since it's user's preference for where projects go)
  const config = configManager.get();
  const workspace = options.workspace || config.workspace || DEFAULT_WORKSPACE;
  
  // Resolve runner ID: CLI flag > system username (ignore config 'local' default)
  const runnerId = options.runnerId || getSystemUsername();
  
  // Resolve secret: CLI flag > config (required)
  // Only use config secret if it looks like a valid token (starts with sv_)
  // This prevents the default 'dev-secret' from being used in runner mode
  const configSecret = configManager.getSecret();
  const sharedSecret = options.secret || (configSecret?.startsWith('sv_') ? configSecret : undefined);

  const runnerOptions = {
    wsUrl,
    apiUrl,
    sharedSecret,
    runnerId,
    workspace,
    verbose: options.verbose,
    tuiMode: useTUI,
  };

  // Validate required options - secret is required
  // If not provided, try to use stored OAuth token or trigger OAuth flow
  if (!runnerOptions.sharedSecret) {
    // Check if we have a stored OAuth token
    if (hasStoredToken()) {
      const storedToken = getStoredToken();
      if (storedToken) {
        runnerOptions.sharedSecret = storedToken;
        logger.info(`Using stored runner token: ${chalk.cyan(storedToken.substring(0, 12) + '...')}`);
      }
    }
    
    // If still no secret and not in local mode, trigger OAuth flow
    if (!runnerOptions.sharedSecret && !options.local) {
      logger.info('No runner token found. Starting OAuth authentication...');
      logger.info('');
      
      const result = await performOAuthLogin({
        apiUrl: runnerOptions.apiUrl,
        silent: false,
      });
      
      if (result.success && result.token) {
        storeToken(result.token, runnerOptions.apiUrl);
        runnerOptions.sharedSecret = result.token;
        logger.log('');
        logger.success('Authentication successful!');
        logger.info(`Token: ${chalk.cyan(result.token.substring(0, 12) + '...')}`);
        logger.log('');
      } else {
        logger.error(result.error || 'Authentication failed');
        logger.info('');
        logger.info('You can also provide a token manually:');
        logger.info(`  ${chalk.cyan('hatchway runner --secret <your-secret>')}`);
        logger.info('');
        logger.info('Or login first:');
        logger.info(`  ${chalk.cyan('hatchway login')}`);
        process.exit(1);
      }
    }
    
    // Final check - if still no secret (and not local mode)
    if (!runnerOptions.sharedSecret && !options.local) {
      logger.error('Shared secret is required');
      logger.info('');
      logger.info('Get a runner key from your Hatchway dashboard, or provide via:');
      logger.info(`  ${chalk.cyan('hatchway runner --secret <your-secret>')}`);
      logger.info('');
      logger.info('Or login with OAuth:');
      logger.info(`  ${chalk.cyan('hatchway login')}`);
      process.exit(1);
    }
  }

  // ========================================
  // PLAIN TEXT MODE (--no-tui)
  // ========================================
  if (!useTUI) {
    // Display startup info
    logger.section('Starting Hatchway Runner');
    logger.info(`Server: ${chalk.cyan(runnerOptions.wsUrl)}`);
    logger.info(`API URL: ${chalk.cyan(runnerOptions.apiUrl)}`);
    logger.info(`Runner ID: ${chalk.cyan(runnerOptions.runnerId)}`);
    logger.info(`Workspace: ${chalk.cyan(runnerOptions.workspace)}`);
    logger.log('');

    if (options.verbose) {
      logger.debug('Verbose logging enabled');
      logger.debug(`Full options: ${JSON.stringify(runnerOptions, null, 2)}`);
    }

    try {
      // Start the runner (runs indefinitely)
      await startRunner(runnerOptions);
    } catch (error) {
      logger.error('Failed to start runner:');
      logger.error(error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof Error && error.stack) {
        logger.debug(error.stack);
      }
      process.exit(1);
    }
    return;
  }

  // ========================================
  // TUI MODE (default)
  // ========================================
  
  // Initialize the logger BEFORE rendering TUI so the TUI can subscribe to events
  // This must happen before startRunner() which would create its own logger
  initRunnerLogger({
    verbose: options.verbose || false,
    tuiMode: true,
  });
  
  // Enable TUI mode in file-logger to suppress terminal output
  setFileLoggerTuiMode(true);
  
  // Track runner cleanup function
  let runnerCleanupFn: (() => Promise<void>) | undefined;

  // Clear screen and enter alternate buffer for clean TUI
  process.stdout.write('\x1b[?1049h'); // Enter alternate screen
  process.stdout.write('\x1b[2J\x1b[H'); // Clear and home

  // Ensure stdin is in raw mode for keyboard input
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  // Handle quit from TUI
  const handleQuit = async () => {
    // Exit alternate screen buffer
    process.stdout.write('\x1b[?1049l');
    
    console.log('\n' + chalk.yellow('Shutting down runner...'));
    
    if (runnerCleanupFn) {
      try {
        await runnerCleanupFn();
        console.log(chalk.green('✓') + ' Runner stopped');
      } catch (e) {
        console.error(chalk.red('✗') + ' Error stopping runner:', e);
      }
    }
    
    process.exit(0);
  };

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', handleQuit);

  // Render the TUI dashboard
  const { waitUntilExit, clear } = render(
    React.createElement(RunnerDashboard, {
      config: {
        runnerId,
        serverUrl: wsUrl,
        workspace,
        apiUrl,
      },
      onQuit: handleQuit,
    }),
    {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      exitOnCtrlC: false, // We handle this ourselves
      patchConsole: false, // We use our own logging
    }
  );

  try {
    // Start the runner and get cleanup function
    runnerCleanupFn = await startRunner(runnerOptions);

    // Wait for TUI to exit (user pressed 'q')
    await waitUntilExit();

    // Clean up
    clear();
    await handleQuit();
  } catch (error) {
    clear();
    process.stdout.write('\x1b[?1049l'); // Exit alternate screen
    
    logger.error('Failed to start runner:');
    logger.error(error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error && error.stack) {
      logger.debug(error.stack);
    }
    process.exit(1);
  }
}
