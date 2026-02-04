import chalk from 'chalk';
import { performOAuthLogin, hasStoredToken, getStoredToken, storeToken } from '../utils/cli-auth.js';
import { logger } from '../utils/logger.js';

interface LoginOptions {
  url?: string;
  force?: boolean;
}

/**
 * Login command - authenticate with Hatchway via OAuth
 *
 * Usage:
 *   hatchway login [--url <server-url>] [--force]
 * 
 * This command:
 * 1. Opens a browser for OAuth authentication (GitHub or Sentry)
 * 2. Creates a runner token automatically
 * 3. Stores the token locally for future use
 */
export async function loginCommand(options: LoginOptions = {}) {
  const apiUrl = options.url || 'https://hatchway.sh';

  logger.section('Hatchway Login');
  
  // Check if already logged in
  if (!options.force && hasStoredToken()) {
    const existingToken = getStoredToken();
    logger.info(`Already logged in with token: ${chalk.cyan(existingToken?.substring(0, 12) + '...')}`);
    logger.info('');
    logger.info('Use --force to re-authenticate, or run:');
    logger.info(`  ${chalk.cyan('hatchway logout')} to clear credentials`);
    logger.info(`  ${chalk.cyan('hatchway runner')} to start the runner`);
    return;
  }
  
  logger.info(`Server: ${chalk.cyan(apiUrl)}`);
  logger.info('');
  
  // Perform OAuth flow
  const result = await performOAuthLogin({
    apiUrl,
    silent: false,
  });
  
  if (result.success && result.token) {
    // Store the token
    storeToken(result.token, apiUrl);
    
    logger.log('');
    logger.success('Authentication successful!');
    logger.info('');
    logger.info(`Token stored: ${chalk.cyan(result.token.substring(0, 12) + '...')}`);
    logger.info('');
    logger.info('You can now run:');
    logger.info(`  ${chalk.cyan('hatchway runner')} to start the runner`);
  } else {
    logger.error(result.error || 'Authentication failed');
    process.exit(1);
  }
}
