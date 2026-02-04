import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';
import { spinner } from './spinner.js';
import { prompts } from './prompts.js';

/**
 * Read DATABASE_URL from .env file in monorepo root
 */
export async function readDatabaseUrlFromEnv(monorepoPath: string): Promise<string | null> {
  const envPath = join(monorepoPath, '.env');

  if (!existsSync(envPath)) {
    return null;
  }

  try {
    const content = await readFile(envPath, 'utf-8');
    const match = content.match(/^DATABASE_URL\s*=\s*['"]?([^'"\n]+)['"]?/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Clear DATABASE_URL from .env file (removes stale value)
 */
export async function clearDatabaseUrlFromEnv(monorepoPath: string): Promise<void> {
  const envPath = join(monorepoPath, '.env');

  if (!existsSync(envPath)) {
    return;
  }

  try {
    const content = await readFile(envPath, 'utf-8');
    const updated = content
      .split('\n')
      .filter(line => !line.trim().startsWith('DATABASE_URL'))
      .join('\n');
    await writeFile(envPath, updated, 'utf-8');
  } catch (error) {
    logger.warn('Could not clear DATABASE_URL from .env');
  }
}

/**
 * Run neondb setup to create a database and get the connection string
 * Returns the DATABASE_URL if successful
 */
export async function setupDatabase(monorepoPath: string, silent: boolean = false): Promise<string | null> {
  // Clear any stale DATABASE_URL first
  await clearDatabaseUrlFromEnv(monorepoPath);

  if (!silent) {
    spinner.start('Setting up Neon PostgreSQL database...');
  }

  return new Promise((resolve) => {
    const proc = spawn('npx', ['neondb', '-y'], {
      cwd: monorepoPath, // Run in monorepo root so .env is created there
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let databaseUrl: string | null = null;
    let output = '';

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;

      // Look for DATABASE_URL in the output
      const match = text.match(/DATABASE_URL[=:]?\s*['"]?([^'"\s]+)['"]?/);
      if (match && match[1]) {
        databaseUrl = match[1];
      }

      // Also check for postgres:// connection strings
      const connMatch = text.match(/(postgres(?:ql)?:\/\/[^\s'"]+)/);
      if (connMatch && connMatch[1]) {
        databaseUrl = connMatch[1];
      }
    });

    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      // Only log actual errors (and only if not silent)
      if (!silent && (text.includes('error') || text.includes('Error'))) {
        logger.debug(text.trim());
      }
    });

    proc.on('exit', async (code) => {
      if (code === 0) {
        // Try to read DATABASE_URL from .env file (neondb writes it there)
        const urlFromEnv = await readDatabaseUrlFromEnv(monorepoPath);

        if (urlFromEnv) {
          databaseUrl = urlFromEnv;
          if (!silent) {
            spinner.succeed('Database created successfully');
          }
          resolve(databaseUrl);
        } else if (databaseUrl) {
          // Fallback to what we parsed from output
          if (!silent) {
            spinner.succeed('Database created successfully');
          }
          resolve(databaseUrl);
        } else {
          if (!silent) {
            spinner.warn('Database command completed but DATABASE_URL not found');
            logger.info('Check .env file in monorepo root for DATABASE_URL');
          }
          resolve(null);
        }
      } else {
        if (!silent) {
          spinner.fail('Failed to create database');
        }
        resolve(null);
      }
    });

    proc.on('error', (error) => {
      if (!silent) {
        spinner.fail('Failed to run neondb');
        logger.error(`Error: ${error.message}`);
      }
      resolve(null);
    });
  });
}

/**
 * Check if neondb is available
 */
export async function isNeondbAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['neondb', '--version'], {
      stdio: 'ignore',
      shell: true,
    });

    proc.on('exit', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Push database schema using drizzle-kit
 */
export async function pushDatabaseSchema(monorepoPath: string, databaseUrl: string, silent: boolean = false): Promise<boolean> {
  const { join } = await import('path');
  const { existsSync } = await import('fs');

  const hatchwayAppPath = join(monorepoPath, 'apps/hatchway');
  const configPath = join(hatchwayAppPath, 'drizzle.config.ts');

  // Verify paths exist
  if (!existsSync(hatchwayAppPath)) {
    if (!silent) {
      logger.error(`Directory not found: ${hatchwayAppPath}`);
    }
    return false;
  }

  if (!existsSync(configPath)) {
    if (!silent) {
      logger.error(`Drizzle config not found: ${configPath}`);
    }
    return false;
  }

  if (!silent) {
    spinner.start('Ensuring hatchway dependencies are installed...');
  }

  try {
    execFileSync('pnpm', ['install'], {
      cwd: hatchwayAppPath,
      stdio: 'pipe',
    });
    execFileSync('pnpm', ['--filter', '@hatchway/agent-core', 'build'], {
      cwd: monorepoPath,
      stdio: 'pipe',
    });
    if (!silent) {
      spinner.succeed('Dependencies ready');
    }
  } catch (error) {
    if (!silent) {
      spinner.warn('Dependency installation failed, trying schema push anyway');
    }
  }

  if (!silent) {
    spinner.start('Initializing database schema (this may take a moment)...');
  }

  return new Promise((resolve) => {
    const proc = spawn('npx', ['drizzle-kit', 'push', '--config=drizzle.config.ts'], {
      cwd: hatchwayAppPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl, // Ensure drizzle-kit has access
      },
    });

    let allOutput = '';

    // Capture all output for debugging
    proc.stdout?.on('data', (data) => {
      allOutput += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      allOutput += data.toString();
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        if (!silent) {
          spinner.succeed('Database schema initialized successfully');
        }
        resolve(true);
      } else {
        if (!silent) {
          spinner.fail('Failed to push database schema');
          // Show all output when it fails so user can see what went wrong
          if (allOutput.trim()) {
            logger.log(''); // Blank line
            logger.log('Output from drizzle-kit push:');
            logger.log(allOutput.trim());
            logger.log(''); // Blank line
          }
        }
        resolve(false);
      }
    });

    proc.on('error', (error) => {
      if (!silent) {
        spinner.fail('Failed to run drizzle-kit');
        logger.error(`Error: ${error.message}`);
      }
      resolve(false);
    });
  });
}

/**
 * Connect to an existing database manually by prompting for connection string
 */
export async function connectManualDatabase(): Promise<string | null> {
  logger.log('');

  // Ask user what type of connection they want
  const connectionType = await prompts.select(
    'How would you like to connect your database?',
    [
      'Connect an existing Hatchway database',
      'Provide a connection string directly',
    ]
  );

  logger.log('');

  // Prompt for the connection string
  let message: string;
  if (connectionType === 'Connect an existing Hatchway database') {
    message = 'Enter your Hatchway database connection string:';
  } else {
    message = 'Enter your PostgreSQL connection string:';
  }

  const connectionString = await prompts.input(message);

  // Basic validation
  if (!connectionString || connectionString.trim() === '') {
    logger.error('Connection string cannot be empty');
    return null;
  }

  // Validate it looks like a PostgreSQL connection string
  if (!connectionString.match(/^postgres(?:ql)?:\/\//)) {
    logger.error('Connection string must start with postgres:// or postgresql://');
    return null;
  }

  return connectionString.trim();
}
