/**
 * TUI-based init command with beautiful centered interface
 * Uses Ink for React-based terminal rendering
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runInitTUI } from '../tui/App.js';
import type { InitCallbacks, InitConfig } from '../tui/screens/index.js';
import { configManager } from '../utils/config-manager.js';
import { isInsideMonorepo } from '../utils/repo-detector.js';
import {
  cloneRepository,
  installDependencies,
  isPnpmInstalled,
  buildAgentCore
} from '../utils/repo-cloner.js';
import {
  setupDatabase,
  pushDatabaseSchema,
} from '../utils/database-setup.js';
import { CLIError } from '../utils/cli-error.js';
import { layout } from '../tui/theme.js';

/**
 * Generate a secure random secret
 */
function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Check if a path is or contains the current working directory
 */
function isCurrentWorkingDirectory(targetPath: string): boolean {
  try {
    const cwd = realpathSync(process.cwd());
    const target = realpathSync(resolve(targetPath));
    return cwd === target || cwd.startsWith(target + '/');
  } catch {
    const cwd = process.cwd();
    const target = resolve(targetPath);
    return cwd === target || cwd.startsWith(target + '/');
  }
}

/**
 * Normalize URL by adding protocol if missing
 */
function normalizeUrl(url: string): string {
  if (!url) return url;
  if (url.match(/^https?:\/\//i)) return url;
  if (url.match(/^(localhost|127\.0\.0\.1)(:|\/|$)/i)) {
    return `http://${url}`;
  }
  return `https://${url}`;
}

/**
 * Get default workspace path
 */
function getDefaultWorkspace(): string {
  return join(process.cwd(), 'hatchway-workspace');
}

/**
 * Get default monorepo clone path
 */
function getDefaultMonorepoPath(): string {
  return join(process.cwd(), 'hatchway');
}

/**
 * Sleep utility for deliberate pacing
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface InitOptions {
  workspace?: string;
  url?: string;
  secret?: string;
  branch?: string;
  database?: string | boolean;
  yes?: boolean;
  nonInteractive?: boolean;
}

/**
 * Run the TUI-based init command
 */
export async function initTUICommand(options: InitOptions): Promise<void> {
  // Clear screen for fullscreen experience
  console.clear();

  try {
    const { shouldStart } = await runInitTUI({
      onInit: async (callbacks: InitCallbacks) => {
        return executeInitFlow(options, callbacks);
      },
    });

    if (shouldStart) {
      console.clear();
      console.log('\n  Starting Hatchway...\n');
      // Import and run the start command (full TUI with web app + runner)
      const { startCommand } = await import('./start.js');
      await startCommand({});
    } else {
      console.clear();
      console.log('\n  ✨ Hatchway is ready!\n');
      console.log('  To start later, run:\n');
      console.log('    hatchway run\n');
      console.log('  Then open: http://localhost:3000\n');
    }
    
  } catch (error) {
    // Error was already displayed in TUI
    console.log('\n');
    process.exit(1);
  }
}



/**
 * Execute the init flow, calling callbacks to update UI
 */
async function executeInitFlow(
  options: InitOptions,
  callbacks: InitCallbacks
): Promise<InitConfig> {
  const { activateStep, completeStep, failStep, startTask, completeTask, failTask, setError, setBuildError } = callbacks;

  let monorepoPath: string | undefined;
  let databaseUrl: string | undefined;
  const workspace = options.workspace || getDefaultWorkspace();
  const generatedSecret = options.secret || generateSecret();
  const apiUrl = normalizeUrl(options.url || 'http://localhost:3000');

  // ============================================
  // PHASE 1: Repository
  // ============================================
  activateStep('repo');
  await sleep(layout.stepTransitionDelay);

  // Reset config if exists
  if (configManager.isInitialized()) {
    configManager.reset();
  }

  // Check for existing monorepo
  startTask('clone', 'Checking for repository...');
  await sleep(300);

  const repoCheck = await isInsideMonorepo();

  if (repoCheck.inside && repoCheck.root) {
    monorepoPath = repoCheck.root;
    completeTask('clone');
    await sleep(layout.taskCompletionDelay);
  } else {
    // Need to clone
    const hasPnpm = await isPnpmInstalled();
    if (!hasPnpm) {
      failTask('clone', 'pnpm not found');
      failStep('repo');
      setError('pnpm is required', [
        'Install pnpm:  npm install -g pnpm',
        'Then retry:    hatchway init -y',
      ]);
      throw new CLIError({
        code: 'DEPENDENCIES_INSTALL_FAILED',
        message: 'pnpm is not installed',
      });
    }

    const clonePath = getDefaultMonorepoPath();

    // Clean up existing installation
    if (existsSync(clonePath)) {
      if (isCurrentWorkingDirectory(clonePath)) {
        failTask('clone', 'Cannot remove current directory');
        failStep('repo');
        setError('Cannot remove current directory', [
          'Run from a different directory',
          'Or manually remove: rm -rf ' + clonePath,
        ]);
        throw new CLIError({
          code: 'CONFIG_INVALID',
          message: 'Cannot remove current working directory',
        });
      }
      rmSync(clonePath, { recursive: true, force: true });
    }

    try {
      // Clone repository
      startTask('clone', 'Cloning from GitHub...');
      monorepoPath = await cloneRepository({
        targetPath: clonePath,
        branch: options.branch || 'main',
        silent: true, // Suppress console output in TUI mode
      });
      completeTask('clone');
      await sleep(layout.taskCompletionDelay);
    } catch (error) {
      failTask('clone', 'Clone failed');
      failStep('repo');
      setError('Failed to clone repository', [
        'Check your internet connection',
        'Verify git is installed: git --version',
        'Try: git clone https://github.com/codyde/hatchway.git',
      ]);
      throw error;
    }
  }

  completeStep('repo');
  await sleep(layout.stepTransitionDelay);

  // ============================================
  // PHASE 2: Build
  // ============================================
  activateStep('build');
  await sleep(layout.stepTransitionDelay);

  // Install dependencies
  startTask('deps', 'Running pnpm install...');
  try {
    await installDependencies(monorepoPath!, true); // silent mode
    completeTask('deps');
    await sleep(layout.taskCompletionDelay);
  } catch (error) {
    failTask('deps', 'Install failed');
    failStep('build');
    setError('Failed to install dependencies', [
      'Check pnpm is installed: pnpm --version',
      'Try manually: cd ' + monorepoPath + ' && pnpm install',
    ]);
    throw error;
  }

  // Build packages
  startTask('build', '@hatchway/agent-core');
  try {
    await buildAgentCore(monorepoPath!, true); // silent mode
    completeTask('build');
    await sleep(layout.taskCompletionDelay);
  } catch (error) {
    failTask('build', 'Build failed');
    failStep('build');
    setError('Failed to build packages', [
      'Try manually: cd ' + monorepoPath + ' && pnpm build',
    ]);
    throw error;
  }

  completeStep('build');
  await sleep(layout.stepTransitionDelay);

  // ============================================
  // PHASE 3: Database
  // ============================================
  activateStep('database');
  await sleep(layout.stepTransitionDelay);

  startTask('database', 'Setting up Neon database...');

  // Handle database options
  const dbOption = options.database;
  const isConnectionString = typeof dbOption === 'string' &&
    (dbOption.startsWith('postgres://') || dbOption.startsWith('postgresql://'));

  try {
    if (isConnectionString) {
      databaseUrl = dbOption as string;
      await pushDatabaseSchema(monorepoPath!, databaseUrl, true); // silent mode
    } else {
      // Default: setup Neon database
      databaseUrl = await setupDatabase(monorepoPath!, true) || undefined; // silent mode
      if (databaseUrl) {
        await pushDatabaseSchema(monorepoPath!, databaseUrl, true); // silent mode
      }
    }
    completeTask('database');
    await sleep(layout.taskCompletionDelay);
  } catch (error) {
    // Database setup is optional, don't fail hard
    completeTask('database');
    await sleep(layout.taskCompletionDelay);
  }

  completeStep('database');
  await sleep(layout.stepTransitionDelay);

  // ============================================
  // PHASE 4: Configuration & Ready
  // ============================================
  activateStep('ready');
  await sleep(layout.stepTransitionDelay);

  // Create workspace directory
  if (!existsSync(workspace)) {
    await mkdir(workspace, { recursive: true });
  }

  // Save configuration
  startTask('config', 'Writing configuration...');
  try {
    configManager.set('workspace', workspace);
    if (monorepoPath) {
      configManager.set('monorepoPath', monorepoPath);
    }
    if (databaseUrl) {
      configManager.set('databaseUrl', databaseUrl);
    }
    configManager.set('apiUrl', apiUrl);
    
    const wsProtocol = apiUrl.startsWith('https://') ? 'wss://' : 'ws://';
    const hostPath = apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const wsUrl = `${wsProtocol}${hostPath}/ws/runner`;
    
    configManager.set('server', {
      wsUrl: wsUrl,
      secret: generatedSecret,
    });
    configManager.set('runner', {
      id: 'local',
      reconnectAttempts: 5,
      heartbeatInterval: 15000,
    });
    configManager.set('tunnel', {
      provider: 'cloudflare',
      autoCreate: true,
    });

    // Create .env.local
    if (monorepoPath) {
      const envLocalPath = join(monorepoPath, 'apps', 'hatchway', '.env.local');
      const envContent = [
        '# Auto-generated by hatchway CLI',
        `# Generated at: ${new Date().toISOString()}`,
        '',
        'HATCHWAY_LOCAL_MODE=true',
        `RUNNER_SHARED_SECRET=${generatedSecret}`,
        `WORKSPACE_ROOT=${workspace}`,
        'RUNNER_ID=local',
        'RUNNER_DEFAULT_ID=local',
        `DATABASE_URL=${databaseUrl || ''}`,
        '',
      ].join('\n');
      
      await writeFile(envLocalPath, envContent);
    }

    completeTask('config');
    await sleep(layout.taskCompletionDelay);
  } catch (error) {
    failTask('config', 'Config save failed');
    failStep('ready');
    setError('Failed to save configuration', [
      'Check file permissions',
      'Try running from a different directory',
    ]);
    throw error;
  }

  // Build all services for production
  if (monorepoPath) {
    startTask('services', 'Building services (this may take a minute)...');
    
    // Track build output for error reporting (capture both stdout and stderr)
    let buildOutput = '';
    let buildError = '';
    
    try {
      const { spawn } = await import('child_process');
      
      await new Promise<void>((resolve, reject) => {
        const buildProcess = spawn('pnpm', ['build:all'], {
          cwd: monorepoPath,
          stdio: 'pipe',
          shell: true,
        });
        
        // Capture stdout - many build tools output errors here
        buildProcess.stdout?.on('data', (data: Buffer) => {
          buildOutput += data.toString();
        });
        
        // Capture stderr
        buildProcess.stderr?.on('data', (data: Buffer) => {
          buildError += data.toString();
        });
        
        buildProcess.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Build failed with code ${code}`));
        });
        buildProcess.on('error', reject);
      });
      completeTask('services');
      await sleep(layout.taskCompletionDelay);
    } catch (error) {
      // Build failed - surface the error to the user
      failTask('services', 'Build failed');
      failStep('ready');
      
      // Combine all output for analysis
      const allOutput = (buildOutput + '\n' + buildError).trim();
      const allLines = allOutput.split('\n');
      
      // Find the most relevant error lines with better patterns
      const errorPatterns = [
        /error TS\d+:/i,           // TypeScript errors
        /error:/i,                  // General errors
        /Error:/,                   // Error messages
        /ERR!/,                     // npm/pnpm errors
        /failed/i,                  // Failed messages
        /Cannot find/i,             // Module not found
        /Module not found/i,        // Webpack/Next.js errors
        /SyntaxError/i,             // Syntax errors
        /TypeError/i,               // Type errors
        /ReferenceError/i,          // Reference errors
        /ENOENT/i,                  // File not found
        /✖|✗|×/,                   // Error symbols
      ];
      
      // Find lines that match error patterns
      const relevantLines: string[] = [];
      let inErrorBlock = false;
      
      for (let i = 0; i < allLines.length; i++) {
        const line = allLines[i];
        const isErrorLine = errorPatterns.some(pattern => pattern.test(line));
        
        if (isErrorLine) {
          inErrorBlock = true;
          // Include 1 line before for context if available
          if (i > 0 && relevantLines.length === 0) {
            const prevLine = allLines[i - 1].trim();
            if (prevLine && !prevLine.startsWith('>')) {
              relevantLines.push(prevLine);
            }
          }
        }
        
        if (inErrorBlock) {
          relevantLines.push(line.trim());
          // Collect more lines for scrollable view (max 50 lines)
          if (relevantLines.length >= 50) break;
        }
        
        // End error block on empty line or success indicators
        if (inErrorBlock && (line.trim() === '' || /successfully|completed/i.test(line))) {
          // Keep going in case there are more errors
          inErrorBlock = false;
        }
      }
      
      // If no specific errors found, show last 30 lines of output
      const displayLines = relevantLines.length > 0 
        ? relevantLines
        : allLines.slice(-30);
      
      const suggestions = [
        'To debug further, run manually:',
        `  cd ${monorepoPath} && pnpm build:all`,
        '',
        'Common fixes:',
        '  - Run: pnpm install (missing dependencies)',
        '  - Check for TypeScript errors in the files mentioned above',
        '  - Ensure all environment variables are set',
      ];
      
      // Use setBuildError to show full-screen scrollable error view
      setBuildError('Production build failed', displayLines, suggestions);
      
      throw new CLIError({
        code: 'BUILD_FAILED',
        message: 'Failed to build services for production',
        suggestions: [
          `Run manually: cd ${monorepoPath} && pnpm build:all`,
          'Check for TypeScript errors in the output above',
          'Ensure all dependencies are installed: pnpm install',
        ],
      });
    }
  }

  // Validate configuration
  const validation = configManager.validate();
  if (!validation.valid) {
    failStep('ready');
    setError('Configuration invalid', validation.errors);
    throw new CLIError({
      code: 'CONFIG_INVALID',
      message: 'Configuration validation failed',
    });
  }

  completeStep('ready');

  return {
    workspace,
    monorepoPath,
    databaseUrl,
    apiUrl,
    runnerId: 'local',
  };
}
