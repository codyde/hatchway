#!/usr/bin/env node
// EARLY TUI DETECTION: Set SILENT_MODE before any modules are imported
// This suppresses console output in TUI mode
// Must be done before imports because file-logger.ts captures console at load time
{
  const args = process.argv.slice(2);
  const isRunnerTUI = args[0] === 'runner' && !args.includes('--no-tui');
  const isRunTUI = args[0] === 'run';
  const isInitTUI = args[0] === 'init' && (args.includes('-y') || args.includes('--yes') || args.includes('--non-interactive'));
  const isNoArgsTUI = args.length === 0 || (args.length === 1 && args[0] === '--debug');
  
  if (isRunnerTUI || isRunTUI || isInitTUI || isNoArgsTUI) {
    process.env.SILENT_MODE = '1';
  }
}

// IMPORTANT: Ensure vendor packages are extracted before any imports
// pnpm postinstall doesn't always run reliably for global installs from URLs
//
// NOTE: @hatchway/agent-core is bundled directly into dist/ by tsup,
// so we don't need to check for it. But vendor packages (Sentry, etc.) still
// need to be installed from the vendor/ tarballs.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the package root by looking for package.json
// This works regardless of where the bundled code ends up (dist/, dist/cli/, etc.)
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) { // Max 5 levels up
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }
  return startDir; // Fallback to start dir
}

const packageRoot = findPackageRoot(__dirname);

// Check if running in development mode (linked via pnpm/npm link)
// Skip vendor install if we're in the monorepo - dependencies are handled by pnpm
const isLinkedDevelopment = packageRoot.includes('/hatchway/apps/runner');

// Only run vendor install for production global installs
if (!isLinkedDevelopment) {
  // Check if Sentry packages are missing and extract from vendor if needed
  // (agent-core is bundled by tsup, but Sentry packages come from vendor tarballs)
  const nodeModulesDir = dirname(packageRoot); // Go up from package to node_modules/@hatchway
  const sentryNodePath = join(nodeModulesDir, "..", "@sentry", "node");

  if (!existsSync(sentryNodePath)) {
    // Silently initialize vendor packages in background
    try {
      const installScript = join(packageRoot, "scripts/install-vendor.js");
      execFileSync("node", [installScript], {
        cwd: packageRoot,
        stdio: "pipe" // Silent mode - output only shown if VERBOSE=1
      });
    } catch (error) {
      console.error("Failed to initialize vendor packages:", error);
      process.exit(1);
    }
  }
}

// Sentry instrumentation is loaded via --import flag in bin/hatchway.js wrapper
// This ensures instrumentation happens before any ESM module resolution

import { Command } from 'commander';
import { displayBanner } from './utils/banner.js';
import { setupGlobalErrorHandlers, globalErrorHandler } from './utils/error-handler.js';
import { setupShutdownHandler } from './utils/shutdown-handler.js';

// Get package.json for version info
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf-8')
);

// Setup global error handlers for uncaught errors
setupGlobalErrorHandlers();

// Setup graceful shutdown handlers for Ctrl+C
export const shutdownHandler = setupShutdownHandler({
  timeout: 5000,
  verbose: true,
});

// Check if we're running in TUI mode or version mode - skip banner if so
const args = process.argv.slice(2);
const isInitWithYes = args[0] === 'init' && (args.includes('-y') || args.includes('--yes') || args.includes('--non-interactive'));
const isNoArgs = args.length === 0 || (args.length === 1 && args[0] === '--debug');
const isRunCommand = args[0] === 'run'; // `hatchway run` uses TUI Dashboard
const isRunnerCommand = args[0] === 'runner' && !args.includes('--no-tui'); // `hatchway runner` uses TUI Dashboard (unless --no-tui)
const isVersionCommand = args.includes('--version') || args.includes('-V'); // Skip banner for version output
const isSkipBanner = process.env.HATCHWAY_SKIP_BANNER === '1'; // Skip banner after auto-update restart
const isTUIMode = isInitWithYes || isNoArgs || isRunCommand || isRunnerCommand;
const isSilentMode = isTUIMode || isVersionCommand || isSkipBanner;

// Set SILENT_MODE for TUI/version to suppress all console output from other modules
// This must be set early, before modules that use console.log are imported
if (isSilentMode) {
  process.env.SILENT_MODE = '1';
}

// Auto-update check - do this BEFORE displaying banner to avoid double banners
// All modes (TUI and CLI): full auto-update with restart
// For version mode: skip entirely - just show version
let willAutoUpdate = false;
if (!process.env.HATCHWAY_SKIP_UPDATE_CHECK && !isVersionCommand) {
  const { checkAndAutoUpdate } = await import('./utils/auto-update.js');
  
  try {
    // Show banner first for non-TUI modes
    if (!isSilentMode) {
      displayBanner();
    }
    
    // Full auto-update for all modes
    const didUpdate = await checkAndAutoUpdate(packageJson.version);
    if (didUpdate) {
      // CLI will be relaunched by auto-update, exit this process
      willAutoUpdate = true;
      process.exit(0);
    }
  } catch {
    // Auto-update failed silently, continue with current version
  }
} else if (!isSilentMode) {
  // Update check skipped, show banner for CLI mode (but not version mode)
  displayBanner();
}

const program = new Command();

program
  .name('hatchway')
  .description('Hatchway CLI - AI App Builder')
  .version(packageJson.version)
  .option('--runner', 'Start runner only (connect to remote server)')
  .option('--debug', 'Enable debug mode with verbose error output')
  .hook('preAction', (thisCommand) => {
    // Enable debug mode if --debug flag is present
    const opts = thisCommand.opts();
    if (opts.debug) {
      globalErrorHandler.setDebug(true);
      process.env.DEBUG = '1';
    }
  })
  .action(async (options) => {
    try {
      // Default action when no subcommand is provided
      if (options.runner) {
        // Start runner only (legacy flag)
        const { runCommand } = await import('./commands/run.js');
        await runCommand({});
      } else {
        // Show TUI main menu
        const { mainTUICommand } = await import('./commands/main-tui.js');
        await mainTUICommand();
      }
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

// Import commands
program
  .command('init')
  .description('Initialize workspace and configuration for local development')
  .option('--workspace <path>', 'Set workspace directory')
  .option('--url <url>', 'Set server URL (default: http://localhost:3000)')
  .option('--secret <secret>', 'Set shared secret')
  .option('--branch <branch>', 'Git branch to clone (default: main)')
  .option('--database [value]', 'Database setup: connection string, or omit to auto-setup Neon in -y mode')
  .option('-y, --yes', 'Accept all defaults (non-interactive mode)')
  .option('--non-interactive', 'Use defaults without prompts (alias for -y)')
  .action(async (options) => {
    try {
      const { initCommand } = await import('./commands/init.js');
      await initCommand(options);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('run')
  .description('Start the full stack locally (web app + runner)')
  .option('-p, --port <port>', 'Web app port (default: 3000)')
  .option('--dev', 'Use development mode (hot reload, slower startup)')
  .option('--rebuild', 'Rebuild services before starting')
  .option('--no-local', 'Disable local mode (require authentication)')
  .option('--no-tui', 'Disable TUI dashboard, use plain text logs')
  .option('-v, --verbose', 'Enable verbose logging (show debug info)')
  .action(async (options) => {
    try {
      const { startCommand } = await import('./commands/start.js');
      await startCommand(options);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('build')
  .description('Build all services without starting (useful while app is running)')
  .option('--watch', 'Watch for changes and rebuild automatically')
  .action(async (options) => {
    try {
      const { buildCommand } = await import('./commands/build.js');
      await buildCommand(options);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('runner')
  .description('Start runner only (connect to Hatchway server)')
  .option('-u, --url <url>', 'Hatchway server URL (default: https://hatchway.sh)')
  .option('-w, --workspace <path>', 'Workspace directory (default: ~/hatchway-workspace)')
  .option('-i, --runner-id <id>', 'Runner identifier (default: system username)')
  .option('-s, --secret <secret>', 'Shared secret for authentication (required)')
  .option('-b, --broker <url>', 'WebSocket URL override (advanced, inferred from --url)')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-l, --local', 'Enable local mode (bypasses authentication)')
  .option('--no-tui', 'Disable TUI dashboard, use plain text logs')
  .action(async (options) => {
    try {
      const { runCommand } = await import('./commands/run.js');
      await runCommand(options);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });


program
  .command('config <action> [key] [value]')
  .description('Manage configuration (actions: get, set, list, path, validate, reset)')
  .action(async (action, key, value) => {
    try {
      const { configCommand } = await import('./commands/config.js');
      await configCommand(action, key, value);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

// Alias for config validate
program
  .command('verify')
  .description('Verify configuration is valid (alias for config validate)')
  .action(async () => {
    try {
      const { configCommand } = await import('./commands/config.js');
      await configCommand('validate');
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('status')
  .description('Show runner status and configuration')
  .action(async () => {
    try {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand();
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('cleanup')
  .description('Clean up projects and resources')
  .option('--project <slug>', 'Delete specific project')
  .option('--all', 'Clean all projects in workspace')
  .option('--tunnels', 'Close all active tunnels')
  .option('--processes', 'Kill all dev servers')
  .action(async (options) => {
    try {
      const { cleanupCommand } = await import('./commands/cleanup.js');
      await cleanupCommand(options);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('database')
  .alias('db')
  .description('Set up a new database and initialize schema')
  .action(async () => {
    try {
      const { databaseCommand } = await import('./commands/database.js');
      await databaseCommand();
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('upgrade')
  .description('Upgrade to latest version (preserves configuration)')
  .option('--branch <branch>', 'Upgrade to specific branch (default: main)')
  .option('--force', 'Skip safety checks (uncommitted changes)')
  .action(async (options) => {
    try {
      const { upgradeCommand } = await import('./commands/upgrade.js');
      await upgradeCommand(options);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('login')
  .description('Authenticate with Hatchway via OAuth (GitHub/Sentry)')
  .option('-u, --url <url>', 'Hatchway server URL (default: https://hatchway.sh)')
  .option('-f, --force', 'Force re-authentication even if already logged in')
  .action(async (options) => {
    try {
      const { loginCommand } = await import('./commands/login.js');
      await loginCommand(options);
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program
  .command('logout')
  .description('Clear stored authentication credentials')
  .action(async () => {
    try {
      const { logoutCommand } = await import('./commands/logout.js');
      await logoutCommand();
    } catch (error) {
      globalErrorHandler.handle(error as Error);
    }
  });

program.parse();