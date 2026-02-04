import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { configManager } from '../utils/config-manager.js';

export async function statusCommand() {
  logger.section('Hatchway Runner Status');

  // Check if initialized
  const isInitialized = configManager.isInitialized();
  logger.log('');
  logger.info(`${chalk.bold('Status:')} ${isInitialized ? chalk.green('Initialized') : chalk.yellow('Not initialized')}`);

  if (!isInitialized) {
    logger.log('');
    logger.warn('Run "hatchway init" to initialize');
    return;
  }

  // Get configuration
  const config = configManager.get();
  logger.log('');

  // Config file
  logger.info(`${chalk.bold('Config File:')}`);
  logger.log(`  ${configManager.path}`);
  logger.log('');

  // Workspace
  logger.info(`${chalk.bold('Workspace:')}`);
  logger.log(`  Path: ${config.workspace}`);

  const workspaceExists = existsSync(config.workspace);
  logger.log(`  Exists: ${workspaceExists ? chalk.green('Yes') : chalk.red('No')}`);

  if (workspaceExists) {
    try {
      const entries = await readdir(config.workspace);
      const projects = [];

      for (const entry of entries) {
        const entryPath = `${config.workspace}/${entry}`;
        const stats = await stat(entryPath);
        if (stats.isDirectory()) {
          projects.push(entry);
        }
      }

      logger.log(`  Projects: ${projects.length}`);
      if (projects.length > 0 && projects.length <= 10) {
        projects.forEach(p => logger.log(`    - ${p}`));
      } else if (projects.length > 10) {
        projects.slice(0, 10).forEach(p => logger.log(`    - ${p}`));
        logger.log(`    ... and ${projects.length - 10} more`);
      }
    } catch (error) {
      logger.log(`  Projects: ${chalk.yellow('Unable to read')}`);
    }
  }
  logger.log('');

  // Server
  logger.info(`${chalk.bold('Server:')}`);
  logger.log(`  WebSocket URL: ${config.server?.wsUrl || 'not set'}`);
  logger.log(`  API URL: ${config.apiUrl || 'not set'}`);
  logger.log(`  Secret: ${config.server?.secret ? chalk.green('Set') : chalk.red('Not set')}`);
  logger.log('');

  // Runner
  logger.info(`${chalk.bold('Runner:')}`);
  logger.log(`  ID: ${config.runner?.id || 'not set'}`);
  logger.log(`  Reconnect Attempts: ${config.runner?.reconnectAttempts || 5}`);
  logger.log(`  Heartbeat Interval: ${config.runner?.heartbeatInterval || 15000}ms`);
  logger.log('');

  // Validate configuration
  const validation = configManager.validate();
  logger.info(`${chalk.bold('Validation:')}`);
  if (validation.valid) {
    logger.log(`  ${chalk.green('✓')} Configuration is valid`);
  } else {
    logger.log(`  ${chalk.red('✗')} Configuration has errors:`);
    validation.errors.forEach((err) => logger.log(`    - ${chalk.red(err)}`));
  }
  logger.log('');

  // Next steps
  if (validation.valid) {
    logger.info('Ready to run! Use:');
    logger.log(`  ${chalk.cyan('hatchway run')}     - Start local full stack`);
    logger.log(`  ${chalk.cyan('hatchway runner')} - Connect to remote server`);
  } else {
    logger.info('Fix configuration errors with:');
    logger.log(`  ${chalk.cyan('hatchway config set <key> <value>')}`);
    logger.log(`  or ${chalk.cyan('hatchway init')} to reconfigure`);
  }
  logger.log('');
}
