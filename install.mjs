#!/usr/bin/env node

/**
 * Hatchway CLI Installer
 *
 * A beautiful installer for the Hatchway CLI.
 *
 * Usage: curl -fsSL https://hatchway.sh/install.mjs | node -
 */

import { execSync, spawn } from 'node:child_process';

// ANSI 256-color support for hex-like colors
// These match the TUI theme.ts colors
const hex = {
  cyan: '\x1b[38;2;6;182;212m',       // #06b6d4
  purple: '\x1b[38;2;168;85;247m',    // #a855f7
  brightPurple: '\x1b[38;2;192;132;252m', // #c084fc
  success: '\x1b[38;2;34;197;94m',    // #22c55e
  error: '\x1b[38;2;239;68;68m',      // #ef4444
  warning: '\x1b[38;2;245;158;11m',   // #f59e0b
  white: '\x1b[38;2;255;255;255m',    // #ffffff
  gray: '\x1b[38;2;107;114;128m',     // #6b7280
  dimGray: '\x1b[38;2;75;85;99m',     // #4b5563
};

const c = {
  ...hex,
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// Symbols - matching TUI theme
const S = {
  success: `${c.success}✓${c.reset}`,
  error: `${c.error}✗${c.reset}`,
  warning: `${c.warning}!${c.reset}`,
  info: `${c.cyan}●${c.reset}`,
  check: '✓',
  cross: '✗',
  // Braille spinner frames from TUI theme
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

// Banner - matching TUI Banner.tsx exactly
function printBanner() {
  // Same structure as TUI: OPEN in cyan, BUILDER in brightPurple
  const lines = [
    { open: ' ██████╗ ██████╗ ███████╗███╗   ██╗', builder: '██████╗ ██╗   ██╗██╗██╗     ██████╗ ███████╗██████╗ ' },
    { open: '██╔═══██╗██╔══██╗██╔════╝████╗  ██║', builder: '██╔══██╗██║   ██║██║██║     ██╔══██╗██╔════╝██╔══██╗' },
    { open: '██║   ██║██████╔╝█████╗  ██╔██╗ ██║', builder: '██████╔╝██║   ██║██║██║     ██║  ██║█████╗  ██████╔╝' },
    { open: '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║', builder: '██╔══██╗██║   ██║██║██║     ██║  ██║██╔══╝  ██╔══██╗' },
    { open: '╚██████╔╝██║     ███████╗██║ ╚████║', builder: '██████╔╝╚██████╔╝██║███████╗██████╔╝███████╗██║  ██║' },
    { open: ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝', builder: '╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝' },
  ];

  console.log();
  for (const line of lines) {
    console.log(`  ${c.cyan}${line.open}${c.brightPurple}${line.builder}${c.reset}`);
  }
  console.log();
}

// Spinner helper - matching TUI timing (120ms)
class Spinner {
  constructor(message) {
    this.message = message;
    this.frameIndex = 0;
    this.interval = null;
  }

  start() {
    process.stdout.write(`  ${c.cyan}${S.spinner[0]}${c.reset} ${this.message}`);
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % S.spinner.length;
      process.stdout.write(`\r  ${c.cyan}${S.spinner[this.frameIndex]}${c.reset} ${this.message}`);
    }, 120); // Match TUI spinnerInterval
    return this;
  }

  stop(symbol, newMessage) {
    clearInterval(this.interval);
    process.stdout.write(`\r  ${symbol} ${newMessage || this.message}\x1b[K\n`);
  }

  success(message) {
    this.stop(S.success, message);
  }

  error(message) {
    this.stop(S.error, message);
  }
}

// Check Node.js version
function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  
  if (major < 20) {
    // Always show errors, even in quiet mode
    console.log(`  ${S.error} Node.js 20+ required ${c.dimGray}(you have ${version})${c.reset}`);
    console.log();
    console.log(`  ${c.dimGray}Install Node.js 20+ from https://nodejs.org${c.reset}`);
    console.log();
    process.exit(1);
  }
  
  log(`  ${S.success} Node.js ${c.dimGray}${version}${c.reset}`);
  return version;
}

// Get latest release version from npm (source of truth for installable versions)
async function getLatestVersion() {
  // In quiet mode, skip the spinner
  const spinner = isQuietMode ? null : new Spinner('Fetching latest release...').start();
  
  try {
    // Use npm registry as source of truth since that's where we install from
    const npmResponse = await fetch('https://registry.npmjs.org/@hatchway/cli/latest');
    if (npmResponse.ok) {
      const data = await npmResponse.json();
      const version = `v${data.version}`;
      if (spinner) spinner.success(`Latest version: ${c.cyan}${version}${c.reset}`);
      return version;
    }
    
    throw new Error('Could not determine latest version from npm');
  } catch (error) {
    if (spinner) spinner.error('Failed to fetch latest version');
    throw error;
  }
}

// Check if pnpm is available
function hasPnpm() {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Check if npm is available
function hasNpm() {
  try {
    execSync('npm --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Install pnpm using npm
async function installPnpm() {
  const spinner = new Spinner('Installing pnpm...').start();
  
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', 'pnpm'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    // Immediately close stdin to prevent any possibility of hanging
    proc.stdin.end();
    
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        spinner.success('pnpm installed');
        resolve(true);
      } else {
        spinner.error('Failed to install pnpm');
        const error = new Error(`npm install -g pnpm failed with code ${code}`);
        error.stderr = stderr;
        reject(error);
      }
    });
    
    proc.on('error', (err) => {
      spinner.error('Failed to install pnpm');
      const error = new Error(`npm install -g pnpm failed: ${err.message}`);
      reject(error);
    });
  });
}

// Check if pnpm global bin directory is in PATH
// Note: We no longer check PNPM_HOME since it's not always set
// Instead, we check if pnpm can successfully run global packages
function isPnpmConfigured() {
  try {
    // Check if pnpm's global bin is accessible by checking where pnpm would install
    const globalDir = execSync('pnpm root -g', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return !!globalDir;
  } catch {
    // If we can't determine the global dir, assume it's configured
    // The actual install will fail if it's not, and we'll show a helpful error
    return true;
  }
}

// Run pnpm setup to configure global bin directory
async function runPnpmSetup() {
  console.log(`  ${S.info} Running ${c.cyan}pnpm setup${c.reset} to configure global directory...`);
  
  return new Promise((resolve, reject) => {
    // Use --force to make pnpm setup non-interactive
    // This prevents hanging when stdin is not a TTY (e.g., curl | bash)
    const proc = spawn('pnpm', ['setup', '--force'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    // Immediately close stdin to prevent any possibility of hanging
    proc.stdin.end();
    
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`  ${S.success} pnpm setup completed`);
        console.log(`  ${S.warning} ${c.warning}Note: You may need to restart your terminal after install${c.reset}`);
        console.log();
        resolve(true);
      } else {
        const error = new Error(`pnpm setup failed with code ${code}`);
        error.stderr = stderr;
        reject(error);
      }
    });
    
    proc.on('error', (err) => {
      const error = new Error(`pnpm setup failed: ${err.message}`);
      reject(error);
    });
  });
}

// Track if pnpm was installed during this run (for terminal restart reminder)
let pnpmWasInstalled = false;

// Track if pnpm setup was run (for terminal restart reminder)
let pnpmSetupWasRun = false;

// Print pnpm install error
function printPnpmInstallError(error) {
  console.log();
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.error}  ${c.bold}Failed to install pnpm${c.reset}`);
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log();
  
  // Check for permission error
  const isPermissionError = error.stderr?.includes('EACCES') || error.stderr?.includes('permission denied');
  
  if (isPermissionError) {
    console.log(`  ${c.warning}Permission denied when installing to global node_modules.${c.reset}`);
    console.log();
    console.log(`  ${c.dimGray}This usually means npm's global directory isn't writable.${c.reset}`);
    console.log(`  ${c.dimGray}You have a few options:${c.reset}`);
    console.log();
    console.log(`  ${c.white}Option 1: Use sudo (quick fix)${c.reset}`);
    console.log(`    ${c.cyan}sudo npm install -g pnpm${c.reset}`);
    console.log();
    console.log(`  ${c.white}Option 2: Fix npm permissions (recommended)${c.reset}`);
    console.log(`    ${c.cyan}mkdir -p ~/.npm-global${c.reset}`);
    console.log(`    ${c.cyan}npm config set prefix '~/.npm-global'${c.reset}`);
    console.log(`    ${c.dimGray}Then add ~/.npm-global/bin to your PATH${c.reset}`);
    console.log();
    console.log(`  ${c.white}Option 3: Use a Node version manager${c.reset}`);
    console.log(`    ${c.dimGray}nvm, fnm, or volta handle permissions automatically${c.reset}`);
    console.log();
  } else {
    if (error.stderr) {
      console.log(`  ${c.dimGray}${error.stderr.trim()}${c.reset}`);
      console.log();
    }
    console.log(`  ${c.dimGray}Please install pnpm manually:${c.reset}`);
    console.log(`    ${c.cyan}npm install -g pnpm${c.reset}`);
    console.log();
  }
  console.log(`  ${c.dimGray}Then run this installer again.${c.reset}`);
  console.log();
}

// Print npm not found error
function printNpmNotFoundError() {
  console.log();
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.error}  ${c.bold}npm is required${c.reset}`);
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log();
  console.log(`  ${c.dimGray}Hatchway requires npm to install pnpm.${c.reset}`);
  console.log(`  ${c.dimGray}npm should be included with Node.js.${c.reset}`);
  console.log();
  console.log(`  ${c.dimGray}Please reinstall Node.js from:${c.reset}`);
  console.log(`    ${c.cyan}https://nodejs.org${c.reset}`);
  console.log();
}

// Print pnpm setup error
function printPnpmSetupError(error) {
  console.log();
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.error}  ${c.bold}pnpm setup failed${c.reset}`);
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log();
  if (error.stderr) {
    console.log(`  ${c.dimGray}${error.stderr.trim()}${c.reset}`);
    console.log();
  }
  console.log(`  ${c.dimGray}Please run the following command manually:${c.reset}`);
  console.log(`    ${c.cyan}pnpm setup${c.reset}`);
  console.log();
  console.log(`  ${c.dimGray}Then restart your terminal and run this installer again.${c.reset}`);
  console.log();
}

// Install the CLI
async function installCLI(version) {
  // Install from npm registry with explicit version to avoid pnpm cache issues
  // Strip 'v' prefix if present (GitHub releases use 'v1.0.0', npm uses '1.0.0')
  const cleanVersion = version.startsWith('v') ? version.slice(1) : version;
  const packageSpec = `@hatchway/cli@${cleanVersion}`;
  
  // Check pnpm availability - install if not present
  if (!hasPnpm()) {
    log(`  ${S.info} pnpm not found, installing...`);
    
    // Check if npm is available to install pnpm
    if (!hasNpm()) {
      printNpmNotFoundError();
      process.exit(1);
    }
    
    try {
      await installPnpm();
      pnpmWasInstalled = true;
    } catch (error) {
      printPnpmInstallError(error);
      process.exit(1);
    }
  } else {
    log(`  ${S.success} pnpm ${c.dimGray}found${c.reset}`);
  }
  
  // Check if pnpm is properly configured
  if (!isPnpmConfigured()) {
    // pnpm exists but PNPM_HOME not set - run pnpm setup
    try {
      await runPnpmSetup();
      pnpmSetupWasRun = true;
    } catch (error) {
      printPnpmSetupError(error);
      process.exit(1);
    }
  }
  
  const spinner = isQuietMode ? null : new Spinner('Installing Hatchway CLI...').start();
  
  const installArgs = ['add', '-g', packageSpec];
  
  return new Promise((resolve, reject) => {
    // Set increased heap size for large packages and suppress DEP0190 warning
    // DEP0190: Passing args to child_process spawn with shell:true (comes from package managers)
    const env = {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=8192 --disable-warning=DEP0190`.trim(),
    };
    
    const proc = spawn('pnpm', installArgs, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    // Immediately close stdin to prevent any possibility of hanging
    proc.stdin.end();
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        if (spinner) spinner.success('Hatchway CLI installed');
        resolve();
      } else {
        if (spinner) spinner.error('Installation failed');
        const error = new Error(`pnpm install failed with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    
    proc.on('error', (error) => {
      if (spinner) spinner.error('Installation failed');
      reject(error);
    });
  });
}

// Verify installation
function verifyInstallation() {
  try {
    // Skip update check to prevent recursive installer calls
    const output = execSync('hatchway --version', { 
      encoding: 'utf8',
      env: { ...process.env, HATCHWAY_SKIP_UPDATE_CHECK: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // Extract just the version number (last line or the line with the version)
    const lines = output.split('\n');
    const versionLine = lines.find(l => /^\d+\.\d+\.\d+/.test(l.trim())) || lines[lines.length - 1];
    const version = versionLine.trim();
    log(`  ${S.success} Verified: ${c.dim}hatchway v${version}${c.reset}`);
    return true;
  } catch {
    log(`  ${S.warning} Could not verify installation`);
    return false;
  }
}

// Print success message
function printSuccess() {
  // In quiet mode (auto-update), show minimal output
  if (isQuietMode) {
    return;
  }
  
  console.log();
  console.log(`${c.success}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.success}  ${c.bold}Installation complete!${c.reset}`);
  console.log(`${c.success}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log();
  
  // Remind user to restart terminal if pnpm was installed or setup was run
  if (pnpmWasInstalled || pnpmSetupWasRun) {
    console.log(`  ${S.warning} ${c.warning}Important: pnpm was ${pnpmWasInstalled ? 'installed' : 'configured'} during this install.${c.reset}`);
    console.log(`  ${c.warning}Please restart your terminal or run:${c.reset}`);
    console.log(`    ${c.cyan}source ~/.bashrc${c.reset}  ${c.dimGray}(or ~/.zshrc, ~/.profile, etc.)${c.reset}`);
    console.log();
  }
  
  console.log(`  ${c.dimGray}Get started:${c.reset}`);
  console.log();
  console.log(`    ${c.cyan}hatchway${c.reset}          Launch the interactive TUI`);
  console.log(`    ${c.cyan}hatchway init${c.reset}     Initialize configuration`);
  console.log(`    ${c.cyan}hatchway --help${c.reset}   Show all commands`);
  console.log();
}

// Print failure message
function printFailure(error) {
  console.log();
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.error}  ${c.bold}Installation failed${c.reset}`);
  console.log(`${c.error}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log();
  
  // Show the actual error details
  if (error.stderr) {
    console.log(`  ${c.dimGray}Error output:${c.reset}`);
    // Show relevant parts of stderr (trim long output)
    const stderrLines = error.stderr.trim().split('\n');
    const relevantLines = stderrLines
      .filter(line => line.includes('error') || line.includes('Error') || line.includes('404') || line.includes('ERESOLVE'))
      .slice(0, 10);
    if (relevantLines.length > 0) {
      relevantLines.forEach(line => console.log(`  ${c.error}${line}${c.reset}`));
    } else {
      // Show last few lines if no obvious error lines found
      stderrLines.slice(-5).forEach(line => console.log(`  ${c.dimGray}${line}${c.reset}`));
    }
    console.log();
  }
  
  if (error.message && !error.stderr) {
    console.log(`  ${c.error}${error.message}${c.reset}`);
    console.log();
  }
  
  if (error.stderr?.includes('heap out of memory') || error.stderr?.includes('ENOMEM')) {
    console.log(`  ${c.warning}Out of memory error detected.${c.reset}`);
    console.log();
    console.log(`  ${c.dimGray}Try running with increased memory:${c.reset}`);
    console.log(`    ${c.cyan}NODE_OPTIONS="--max-old-space-size=8192" pnpm add -g @hatchway/cli${c.reset}`);
  } else {
    console.log(`  ${c.dimGray}Try manual installation:${c.reset}`);
    console.log(`    ${c.cyan}pnpm add -g @hatchway/cli${c.reset}`);
  }
  console.log();
  console.log(`  ${c.dimGray}If the problem persists, please report it at:${c.reset}`);
    console.log(`    ${c.purple}https://github.com/codyde/hatchway/issues${c.reset}`);
  console.log();
}

// Check for quiet mode (used during auto-update to avoid banner spam)
const isQuietMode = process.env.HATCHWAY_QUIET_INSTALL === '1';

// Helper to conditionally log (respects quiet mode)
function log(message) {
  if (!isQuietMode) {
    console.log(message);
  }
}

// Main installer
async function main() {
  // Skip banner and header in quiet mode (auto-update) to avoid noise
  if (!isQuietMode) {
    printBanner();
    console.log(`  ${c.dim}Installing Hatchway CLI${c.reset}`);
    console.log();
  }
  
  try {
    // Check prerequisites
    checkNodeVersion();
    
    // Get latest version
    const version = await getLatestVersion();
    
    // Install
    log('');
    await installCLI(version);
    
    // Verify
    verifyInstallation();
    
    // Success!
    printSuccess();
    
  } catch (error) {
    printFailure(error);
    process.exit(1);
  }
}

// Run
main().then(() => {
  // Explicitly exit to ensure the process terminates
  // This is important when the script is piped via curl | bash
  process.exit(0);
}).catch((error) => {
  console.error(`\n  ${S.error} Unexpected error: ${error.message}\n`);
  process.exit(1);
});
