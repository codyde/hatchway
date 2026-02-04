import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { configManager } from '../utils/config-manager.js';
import { setupDatabase, pushDatabaseSchema } from '../utils/database-setup.js';
import { prompts } from '../utils/prompts.js';

export async function databaseCommand() {
  logger.section('Database Setup');
  logger.log('');

  // Check if monorepo is configured
  const config = configManager.get();
  const monorepoPath = config.monorepoPath;

  if (!monorepoPath) {
    logger.error('Monorepo path not found in config');
    logger.info('Run "hatchway init" first to set up the repository');
    process.exit(1);
  }

  // Step 1: Setup new database
  logger.info('Setting up new Neon PostgreSQL database...');
  logger.log('');

  const databaseUrl = await setupDatabase(monorepoPath);

  if (!databaseUrl) {
    logger.error('Failed to create database');
    logger.log('');
    logger.info('You can manually set a database URL with:');
    logger.log(`  ${chalk.cyan('hatchway config set databaseUrl <url>')}`);
    process.exit(1);
  }

  logger.log('');
  logger.success('Database created!');
  logger.info(`Connection string saved to config`);
  logger.log('');

  // Save to config
  configManager.set('databaseUrl', databaseUrl);

  // Step 2: Push schema
  logger.info('Initializing database schema...');
  logger.log('');

  const pushed = await pushDatabaseSchema(monorepoPath, databaseUrl);

  if (!pushed) {
    logger.warn('Failed to push database schema');
    logger.log('');
    logger.info('You can try manually:');
    logger.log(`  ${chalk.cyan('cd apps/hatchway')}`);
    logger.log(`  ${chalk.cyan('npx drizzle-kit push --config=drizzle.config.ts')}`);
    logger.log('');
    process.exit(1);
  }

  // Success!
  logger.log('');
  logger.success('Database setup complete! 🎉');
  logger.log('');
  logger.info('Database is ready for use');
  logger.info(`You can now run: ${chalk.cyan('hatchway run')}`);
  logger.log('');
}
