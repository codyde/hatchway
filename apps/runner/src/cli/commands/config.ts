import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { configManager } from '../utils/config-manager.js';
import { prompts } from '../utils/prompts.js';

export async function configCommand(action: string, key?: string, value?: string) {
  switch (action) {
    case 'get':
      if (!key) {
        logger.error('Key is required for get action');
        logger.info('Usage: hatchway config get <key>');
        process.exit(1);
      }
      handleGet(key);
      break;

    case 'set':
      if (!key || !value) {
        logger.error('Key and value are required for set action');
        logger.info('Usage: hatchway config set <key> <value>');
        process.exit(1);
      }
      handleSet(key, value);
      break;

    case 'list':
      handleList();
      break;

    case 'path':
      handlePath();
      break;

    case 'validate':
      handleValidate();
      break;

    case 'reset':
      await handleReset();
      break;

    default:
      logger.error(`Unknown action: ${action}`);
      logger.info('Available actions: get, set, list, path, validate, reset');
      process.exit(1);
  }
}

function handleGet(key: string) {
  try {
    const value = configManager.get(key as any);
    if (value === undefined) {
      logger.warn(`Key not found: ${key}`);
      process.exit(1);
    }

    if (typeof value === 'object') {
      logger.log(JSON.stringify(value, null, 2));
    } else {
      logger.log(String(value));
    }
  } catch (error) {
    logger.error('Failed to get config value');
    logger.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function handleSet(key: string, value: string) {
  try {
    // Try to parse as JSON for objects/arrays
    let parsedValue: any = value;
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Keep as string if not valid JSON
      }
    }

    configManager.set(key as any, parsedValue);
    logger.success(`Set ${chalk.cyan(key)} = ${chalk.green(value)}`);
  } catch (error) {
    logger.error('Failed to set config value');
    logger.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function handleList() {
  const config = configManager.get();

  logger.section('Current Configuration');
  logger.log('');

  // Workspace
  logger.info(`${chalk.bold('Workspace:')}`);
  logger.log(`  ${config.workspace}`);
  logger.log('');

  // API
  logger.info(`${chalk.bold('API:')}`);
  logger.log(`  URL: ${config.apiUrl || 'not set'}`);
  logger.log('');

  // Broker
  logger.info(`${chalk.bold('Broker:')}`);
  logger.log(`  WebSocket URL: ${config.broker?.url || 'not set'}`);
  logger.log(`  HTTP URL: ${config.broker?.httpUrl || 'not set'}`);
  logger.log(`  Secret: ${config.broker?.secret ? '***' : 'not set'}`);
  logger.log('');

  // Runner
  logger.info(`${chalk.bold('Runner:')}`);
  logger.log(`  ID: ${config.runner?.id || 'not set'}`);
  logger.log(`  Reconnect Attempts: ${config.runner?.reconnectAttempts || 5}`);
  logger.log(`  Heartbeat Interval: ${config.runner?.heartbeatInterval || 15000}ms`);
  logger.log('');

  // Database
  if (config.databaseUrl) {
    logger.info(`${chalk.bold('Database:')}`);
    logger.log(`  URL: ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}`); // Mask password
    logger.log('');
  }

  // Monorepo
  if (config.monorepoPath) {
    logger.info(`${chalk.bold('Monorepo:')}`);
    logger.log(`  Path: ${config.monorepoPath}`);
    logger.log('');
  }

  // Tunnel
  if (config.tunnel) {
    logger.info(`${chalk.bold('Tunnel:')}`);
    logger.log(`  Provider: ${config.tunnel.provider}`);
    logger.log(`  Auto Create: ${config.tunnel.autoCreate}`);
    logger.log('');
  }
}

function handlePath() {
  logger.info(`Config file: ${chalk.cyan(configManager.path)}`);
}

function handleValidate() {
  const validation = configManager.validate();

  if (validation.valid) {
    logger.success('Configuration is valid');
  } else {
    logger.error('Configuration validation failed:');
    validation.errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }
}

async function handleReset() {
  logger.warn('This will delete all configuration and reset to defaults');
  const confirmed = await prompts.confirm('Are you sure?', false);

  if (!confirmed) {
    logger.info('Reset cancelled');
    return;
  }

  try {
    configManager.reset();
    logger.success('Configuration reset to defaults');
    logger.info('Run "hatchway init" to reconfigure');
  } catch (error) {
    logger.error('Failed to reset configuration');
    logger.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
