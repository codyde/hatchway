#!/usr/bin/env node
/**
 * @hatchway/runner - Lightweight CLI for running the Hatchway runner only
 *
 * This is a minimal CLI that provides just the `runner` command functionality
 * without the full CLI overhead (init, build, database, etc.)
 */

// IMPORTANT: Ensure vendor packages are extracted before any imports
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the package root by looking for package.json
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const packageRoot = findPackageRoot(__dirname);

// Check if running in development mode
const isLinkedDevelopment = packageRoot.includes('/hatchway/packages/runner');

// Only run vendor install for production global installs
if (!isLinkedDevelopment) {
  const nodeModulesDir = dirname(packageRoot);
  const sentryNodePath = join(nodeModulesDir, "..", "@sentry", "node");

  if (!existsSync(sentryNodePath)) {
    try {
      const installScript = join(packageRoot, "scripts/install-vendor.js");
      execFileSync("node", [installScript], {
        cwd: packageRoot,
        stdio: "pipe"
      });
    } catch (error) {
      console.error("Failed to initialize vendor packages:", error);
      process.exit(1);
    }
  }
}

import { Command } from 'commander';
import chalk from 'chalk';

// Get package.json for version info
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf-8')
);

// Display a minimal banner
function displayBanner() {
  console.log('');
  console.log(chalk.cyan('  Hatchway Runner'));
  console.log(chalk.dim(`  v${packageJson.version}`));
  console.log('');
}

// Check if we should show banner
const args = process.argv.slice(2);
const isVersionCommand = args.includes('--version') || args.includes('-V');
const isNoTui = args.includes('--no-tui');

if (!isVersionCommand && isNoTui) {
  displayBanner();
}

const program = new Command();

program
  .name('hatchway-runner')
  .description('Lightweight Hatchway Runner - Connect to Hatchway server')
  .version(packageJson.version)
  .option('-u, --url <url>', 'Hatchway server URL (default: https://hatchway.sh)')
  .option('-w, --workspace <path>', 'Workspace directory (default: ~/hatchway-workspace)')
  .option('-i, --runner-id <id>', 'Runner identifier (default: system username)')
  .option('-s, --secret <secret>', 'Shared secret for authentication')
  .option('-b, --broker <url>', 'WebSocket URL override (advanced, inferred from --url)')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-l, --local', 'Enable local mode (bypasses authentication)')
  .option('--no-tui', 'Disable TUI dashboard, use plain text logs')
  .action(async (options) => {
    try {
      // Import the runner command - this will be resolved by the alias plugin at build time
      const { runCommand } = await import('@hatchway/cli/cli/commands/run');
      await runCommand(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof Error && error.stack && options.verbose) {
        console.error(chalk.dim(error.stack));
      }
      process.exit(1);
    }
  });

program.parse();
