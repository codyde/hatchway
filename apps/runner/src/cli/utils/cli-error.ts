/**
 * CLI Error handling with context and actionable suggestions
 * Replaces scattered process.exit() calls throughout the codebase
 */

export type ErrorCode =
  // Initialization errors
  | 'INIT_FAILED'
  | 'MONOREPO_NOT_FOUND'
  | 'MONOREPO_CLONE_FAILED'
  | 'DEPENDENCIES_INSTALL_FAILED'
  | 'BUILD_FAILED'

  // Configuration errors
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_CREATE_FAILED'

  // Database errors
  | 'DB_CONNECTION_FAILED'
  | 'DB_MIGRATION_FAILED'
  | 'DB_URL_INVALID'

  // Network/Port errors
  | 'PORT_IN_USE'
  | 'BROKER_CONNECTION_FAILED'
  | 'TUNNEL_CREATION_FAILED'

  // Runtime errors
  | 'SERVICE_START_FAILED'
  | 'SERVICE_CRASHED'
  | 'PROCESS_KILL_FAILED'

  // User errors
  | 'INVALID_ARGUMENT'
  | 'MISSING_REQUIRED_CONFIG'
  | 'PERMISSION_DENIED'

  // Upgrade errors
  | 'UPGRADE_NOT_IN_REPO'
  | 'UPGRADE_CLONE_FAILED'
  | 'UPGRADE_INSTALL_FAILED'
  | 'UPGRADE_BUILD_FAILED'

  // Unknown
  | 'UNKNOWN_ERROR';

export interface CLIErrorOptions {
  code: ErrorCode;
  message: string;
  context?: Record<string, unknown>;
  suggestions?: string[];
  fatal?: boolean;
  cause?: Error;
  docs?: string; // Link to documentation
}

/**
 * Custom error class for CLI operations
 * Provides context, suggestions, and proper exit codes
 */
export class CLIError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, unknown>;
  public readonly suggestions: string[];
  public readonly fatal: boolean;
  public readonly cause?: Error;
  public readonly docs?: string;

  constructor(options: CLIErrorOptions) {
    super(options.message);
    this.name = 'CLIError';
    this.code = options.code;
    this.context = options.context;
    this.suggestions = options.suggestions || [];
    this.fatal = options.fatal !== false; // Default true
    this.cause = options.cause;
    this.docs = options.docs;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get exit code based on error type
   */
  getExitCode(): number {
    // Map error codes to exit codes
    const exitCodes: Partial<Record<ErrorCode, number>> = {
      'CONFIG_INVALID': 78,           // EX_CONFIG
      'CONFIG_NOT_FOUND': 78,
      'PERMISSION_DENIED': 77,        // EX_NOPERM
      'INVALID_ARGUMENT': 64,         // EX_USAGE
      'DB_CONNECTION_FAILED': 69,     // EX_UNAVAILABLE
      'BROKER_CONNECTION_FAILED': 69,
      'PORT_IN_USE': 69,
    };

    return exitCodes[this.code] || 1; // Default generic error
  }
}

/**
 * Common error factory functions
 * Use these instead of throwing raw CLIError
 */
export const errors = {
  portInUse: (port: number, process?: string): CLIError => {
    return new CLIError({
      code: 'PORT_IN_USE',
      message: `Port ${port} is already in use`,
      context: { port, process },
      suggestions: [
        `Stop the existing process: lsof -ti:${port} | xargs kill`,
        `Or let Hatchway kill it: hatchway run --force`,
        process ? `The port is being used by: ${process}` : 'Check what process is using the port: lsof -i:' + port,
      ],
    });
  },

  databaseConnectionFailed: (url: string, cause: Error): CLIError => {
    // Parse URL to get host (safely)
    let host = 'database server';
    try {
      const parsed = new URL(url);
      host = parsed.host;
    } catch {
      // URL might be invalid
    }

    return new CLIError({
      code: 'DB_CONNECTION_FAILED',
      message: 'Could not connect to database',
      context: { host, error: cause.message },
      cause,
      suggestions: [
        'Verify your connection string: hatchway config get databaseUrl',
        'Test the connection manually: psql <connection-string>',
        'Reset database setup: hatchway db setup --force',
      ],
      docs: 'https://github.com/codyde/hatchway#database-setup',
    });
  },

  monorepoNotFound: (searchedPaths: string[]): CLIError => {
    return new CLIError({
      code: 'MONOREPO_NOT_FOUND',
      message: 'Hatchway monorepo not found',
      context: { searchedPaths },
      suggestions: [
        'Run initialization: hatchway init',
        'Or specify path: hatchway run --monorepo ~/hatchway',
      ],
    });
  },

  configNotFound: (): CLIError => {
    return new CLIError({
      code: 'CONFIG_NOT_FOUND',
      message: 'Configuration not found',
      suggestions: [
        'Initialize Hatchway: hatchway init',
        'This will create your configuration file',
      ],
      docs: 'https://github.com/codyde/hatchway#getting-started',
    });
  },

  workspaceNotFound: (path: string): CLIError => {
    return new CLIError({
      code: 'WORKSPACE_NOT_FOUND',
      message: `Workspace directory does not exist: ${path}`,
      context: { path },
      suggestions: [
        'Create the directory: mkdir -p ' + path,
        'Or reconfigure workspace: hatchway config set workspace <path>',
        'Or re-run init: hatchway init',
      ],
    });
  },

  serviceStartFailed: (service: string, cause: Error): CLIError => {
    return new CLIError({
      code: 'SERVICE_START_FAILED',
      message: `Failed to start ${service}`,
      context: { service },
      cause,
      suggestions: [
        'Check if dependencies are installed: cd ~/.hatchway-monorepo && pnpm install',
        'Check if ports are available: lsof -i:3000 -i:4000',
        'Try restarting: hatchway run --force',
      ],
    });
  },

  invalidArgument: (arg: string, reason: string): CLIError => {
    return new CLIError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid argument: ${arg}`,
      context: { argument: arg, reason },
      suggestions: [
        'Check the command usage: hatchway --help',
      ],
    });
  },
};
