import chalk from 'chalk';
import { hasStoredToken, clearToken } from '../utils/cli-auth.js';
import { logger } from '../utils/logger.js';

/**
 * Logout command - clear stored credentials
 *
 * Usage:
 *   hatchway logout
 *
 * This command clears the locally stored runner token.
 * The token remains valid on the server - you can revoke it
 * from the Hatchway dashboard if needed.
 */
export async function logoutCommand() {
  logger.section('Hatchway Logout');
  
  if (!hasStoredToken()) {
    logger.info('Not currently logged in.');
    return;
  }
  
  clearToken();
  
  logger.success('Logged out successfully.');
  logger.info('');
  logger.info('Note: The runner token is still valid on the server.');
  logger.info('To revoke it, visit your Hatchway dashboard.');
  logger.info('');
  logger.info(`Run ${chalk.cyan('hatchway login')} to authenticate again.`);
}
