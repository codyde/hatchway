/**
 * Enhanced init command with @clack/prompts and friction-free -y mode
 * Provides beautiful interactive setup or completely automated installation
 * 
 * For -y mode: Uses a beautiful centered TUI with animated progress
 */

import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as p from '@clack/prompts';
import pc from 'picocolors';
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
  connectManualDatabase
} from '../utils/database-setup.js';
import { CLIError, errors } from '../utils/cli-error.js';
import { initTUICommand } from './init-tui.js';

/**
 * Generate a secure random secret
 */
function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Check if a path is or contains the current working directory
 * Prevents accidental deletion of the directory we're running from
 */
function isCurrentWorkingDirectory(targetPath: string): boolean {
  try {
    const cwd = realpathSync(process.cwd());
    const target = realpathSync(resolve(targetPath));
    // Check if target is cwd or if cwd is inside target
    return cwd === target || cwd.startsWith(target + '/');
  } catch {
    // If we can't resolve paths, be safe and assume it might be cwd
    const cwd = process.cwd();
    const target = resolve(targetPath);
    return cwd === target || cwd.startsWith(target + '/');
  }
}

/**
 * Safely remove a directory, but never the current working directory
 */
function safeRemoveDirectory(targetPath: string, rmSync: typeof import('fs').rmSync): boolean {
  if (isCurrentWorkingDirectory(targetPath)) {
    console.error(`\n⚠️  Cannot remove ${targetPath} - it is the current working directory`);
    console.error('   Please run this command from a different directory.\n');
    return false;
  }
  rmSync(targetPath, { recursive: true, force: true });
  return true;
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

interface InitOptions {
  workspace?: string;
  url?: string;
  secret?: string;
  branch?: string;
  database?: string | boolean; // Can be: undefined (neon), or a PostgreSQL connection string
  yes?: boolean;
  nonInteractive?: boolean;
}

export async function initCommand(options: InitOptions) {
  const isNonInteractive = options.nonInteractive || options.yes;

  // ========================================
  // NON-INTERACTIVE MODE: Use beautiful TUI
  // ========================================
  if (isNonInteractive) {
    return initTUICommand(options);
  }

  // ========================================
  // INTERACTIVE MODE (Beautiful @clack/prompts)
  // ========================================
  // Handle Ctrl+C gracefully
  const handleCancel = () => {
    p.cancel('Setup cancelled');
    process.exit(0);
  };

  try {
    {
      // Keep banner visible - don't clear screen
      console.log(); // Just add spacing

      p.intro(pc.bgCyan(pc.black(' Hatchway Setup ')));

      // Step 1: Check if already initialized
      if (configManager.isInitialized()) {
        const shouldReset = await p.confirm({
          message: 'Configuration already exists. Reset and reconfigure?',
          initialValue: true,
        });

        if (p.isCancel(shouldReset)) {
          handleCancel();
          return;
        }

        if (!shouldReset) {
          p.cancel('Setup cancelled');
          return;
        }

        configManager.reset();
        p.log.success('Configuration reset');
      }

      // Step 2: Check for monorepo
      const s = p.spinner();
      s.start('Checking for Hatchway repository');

      const repoCheck = await isInsideMonorepo();
      let monorepoPath: string | undefined;

      if (repoCheck.inside && repoCheck.root) {
        s.stop(pc.green('✓') + ' Found repository at: ' + pc.cyan(repoCheck.root));
        monorepoPath = repoCheck.root;
      } else {
        s.stop('Repository not found in current directory');

        const shouldClone = await p.confirm({
          message: 'Clone Hatchway repository?',
          initialValue: true,
        });

        if (p.isCancel(shouldClone)) {
          handleCancel();
          return;
        }

        if (shouldClone) {
          // Check for pnpm
          const hasPnpm = await isPnpmInstalled();
          if (!hasPnpm) {
            throw new CLIError({
              code: 'DEPENDENCIES_INSTALL_FAILED',
              message: 'pnpm is not installed',
              suggestions: [
                'Install pnpm: npm install -g pnpm',
                'Or visit: https://pnpm.io/installation',
              ],
            });
          }

          const clonePath = await p.text({
            message: 'Where should the repository be cloned?',
            placeholder: getDefaultMonorepoPath(),
            defaultValue: getDefaultMonorepoPath(),
            validate: (value) => {
              if (!value) return 'Path is required';
            },
          });

          if (p.isCancel(clonePath)) {
            handleCancel();
            return;
          }

          // Check if path exists
          const defaultWorkspace = getDefaultWorkspace();
          const existingInstallation = existsSync(clonePath as string) || existsSync(defaultWorkspace);

          if (existingInstallation) {
            const shouldOverwrite = await p.confirm({
              message: `Existing Hatchway installation found. Replace it with fresh install?`,
              initialValue: true,
            });

            if (p.isCancel(shouldOverwrite)) {
              handleCancel();
              return;
            }

            if (shouldOverwrite) {
              s.start('Removing existing installation');
              const { rmSync } = await import('fs');

              // Safety check: never delete the current working directory
              if (existsSync(clonePath as string)) {
                if (!safeRemoveDirectory(clonePath as string, rmSync)) {
                  s.stop(pc.red('✗') + ' Cannot remove current working directory');
                  p.cancel('Please run hatchway init from a different directory');
                  return;
                }
              }

              // Delete workspace directory
              if (existsSync(defaultWorkspace)) {
                if (!safeRemoveDirectory(defaultWorkspace, rmSync)) {
                  s.stop(pc.red('✗') + ' Cannot remove current working directory');
                  p.cancel('Please run hatchway init from a different directory');
                  return;
                }
              }

              s.stop(pc.green('✓') + ' Existing installation removed');
            } else {
              p.cancel('Setup cancelled');
              return;
            }
          }

          // Clone, install, build
          try {
            s.start('Cloning repository from GitHub');
            monorepoPath = await cloneRepository({
              targetPath: clonePath as string,
              branch: options.branch || 'main',
            });
            s.stop(pc.green('✓') + ' Repository cloned');

            s.start('Installing dependencies (this may take a few minutes)');
            await installDependencies(monorepoPath);
            s.stop(pc.green('✓') + ' Dependencies installed');

            s.start('Building @hatchway/agent-core');
            await buildAgentCore(monorepoPath);
            s.stop(pc.green('✓') + ' Build complete');

            // Ask about pre-building services
            const shouldPreBuild = await p.confirm({
              message: 'Pre-build all services for production performance?',
              initialValue: true,
            });

            if (p.isCancel(shouldPreBuild)) {
              handleCancel();
              return;
            }

            if (shouldPreBuild) {
              s.start('Building all services (this may take a minute)');
              const { spawn } = await import('child_process');

              try {
                await new Promise<void>((resolve, reject) => {
                  const buildProcess = spawn('pnpm', ['build:all'], {
                    cwd: monorepoPath,
                    stdio: 'pipe',
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

                s.stop(pc.green('✓') + ' All services built for production');
              } catch (error) {
                s.stop(pc.yellow('⚠') + ' Build failed (you can build later with: pnpm build:all)');
              }
            }
          } catch (error) {
            throw new CLIError({
              code: 'MONOREPO_CLONE_FAILED',
              message: 'Failed to setup repository',
              cause: error instanceof Error ? error : new Error(String(error)),
              suggestions: [
                'Check your internet connection',
                'Verify you have git installed: git --version',
                'Try cloning manually: git clone https://github.com/codyde/hatchway.git',
              ],
            });
          }
        } else {
          p.note(
            'Setup will continue in runner-only mode.\nYou can add the repository path later with:\n  hatchway config set monorepoPath <path>',
            'Repository setup skipped'
          );
        }
      }

      // Step 3: Workspace configuration
      p.log.step(pc.cyan('Workspace Configuration'));

      const workspace = await p.text({
        message: 'Where should generated projects be stored?',
        placeholder: getDefaultWorkspace(),
        defaultValue: getDefaultWorkspace(),
        validate: (value) => {
          if (!value) return 'Workspace path is required';
        },
      });

      if (p.isCancel(workspace)) {
        handleCancel();
        return;
      }

      // Create workspace directory
      try {
        if (!existsSync(workspace as string)) {
          await mkdir(workspace as string, { recursive: true });
        }
      } catch (error) {
        throw errors.workspaceNotFound(workspace as string);
      }

      // Step 4: Connection configuration
      p.log.step(pc.cyan('Connection Configuration'));

      const wsUrl = await p.text({
        message: 'Server WebSocket URL',
        placeholder: 'ws://localhost:3000/ws/runner',
        defaultValue: 'ws://localhost:3000/ws/runner',
      });

      if (p.isCancel(wsUrl)) {
        handleCancel();
        return;
      }

      const apiUrl = await p.text({
        message: 'API base URL',
        placeholder: 'http://localhost:3000',
        defaultValue: options.url || 'http://localhost:3000',
      });

      if (p.isCancel(apiUrl)) {
        handleCancel();
        return;
      }

      // Step 5: Security
      const secret = await p.text({
        message: 'Shared secret (press Enter to generate)',
        placeholder: 'Generated automatically',
        defaultValue: options.secret || generateSecret(),
      });

      if (p.isCancel(secret)) {
        handleCancel();
        return;
      }

      const runnerId = await p.text({
        message: 'Runner ID',
        placeholder: 'local',
        defaultValue: 'local',
      });

      if (p.isCancel(runnerId)) {
        handleCancel();
        return;
      }

      // Step 6: Database setup (if monorepo available)
      let databaseUrl: string | undefined;

      if (monorepoPath) {
        p.log.step(pc.cyan('Database Setup'));

        const dbChoice = await p.select({
          message: 'Database configuration',
          options: [
            {
              value: 'neon',
              label: 'Create Neon database (recommended)',
              hint: 'Free tier, persistent storage'
            },
            {
              value: 'existing',
              label: 'Use existing PostgreSQL',
              hint: 'Provide connection string'
            },
          ],
        });

        if (p.isCancel(dbChoice)) {
          handleCancel();
          return;
        }

        if (dbChoice === 'neon') {
          p.note(
            'Opening Neon in your browser...\nCreate a database and paste the connection string below.',
            pc.cyan('Database Setup')
          );
          databaseUrl = await setupDatabase(monorepoPath) || undefined;
          
          // Push schema if we have a database
          if (databaseUrl) {
            s.start('Pushing database schema');
            const pushed = await pushDatabaseSchema(monorepoPath, databaseUrl);
            if (pushed) {
              s.stop(pc.green('✓') + ' Schema initialized');
            } else {
              s.stop(pc.yellow('⚠') + ' Schema push failed (you can retry later)');
            }
          }
        } else if (dbChoice === 'existing') {
          databaseUrl = await connectManualDatabase() || undefined;
          
          // Push schema if we have a database
          if (databaseUrl) {
            s.start('Pushing database schema');
            const pushed = await pushDatabaseSchema(monorepoPath, databaseUrl);
            if (pushed) {
              s.stop(pc.green('✓') + ' Schema initialized');
            } else {
              s.stop(pc.yellow('⚠') + ' Schema push failed (you can retry later)');
            }
          }
        }
      }

      // Step 7: Save configuration
      try {
        configManager.set('workspace', workspace);
        if (monorepoPath) {
          configManager.set('monorepoPath', monorepoPath);
        }
        if (databaseUrl) {
          configManager.set('databaseUrl', databaseUrl);
        }
        configManager.set('apiUrl', normalizeUrl(apiUrl as string));
        configManager.set('server', {
          wsUrl: wsUrl,
          secret: secret,
        });
        configManager.set('runner', {
          id: runnerId,
          reconnectAttempts: 5,
          heartbeatInterval: 15000,
        });
        configManager.set('tunnel', {
          provider: 'cloudflare',
          autoCreate: true,
        });
      } catch (error) {
        throw new CLIError({
          code: 'CONFIG_INVALID',
          message: 'Failed to save configuration',
          cause: error instanceof Error ? error : new Error(String(error)),
          suggestions: [
            'Check file permissions on config directory',
            'Try running with sudo (not recommended)',
          ],
        });
      }

      // Validate
      const validation = configManager.validate();
      if (!validation.valid) {
        throw new CLIError({
          code: 'CONFIG_INVALID',
          message: 'Configuration validation failed',
          context: { errors: validation.errors },
          suggestions: validation.errors,
        });
      }

      // Success!
      p.outro(pc.green('✨ Hatchway is ready!'));

      p.note(
        `${pc.cyan('hatchway run')}\n\nThen open: ${pc.cyan('http://localhost:3000')}`,
        'Next Steps'
      );

      return;
    }
  } catch (error) {
    // Handle cancellation gracefully
    if (error && typeof error === 'object' && 'name' in error) {
      if ((error as { name: string }).name === 'ExitPromptError' || (error as { code?: string }).code === 'CLACK_CANCEL') {
        handleCancel();
        return;
      }
    }

    // Re-throw for global error handler
    throw error;
  }
}
