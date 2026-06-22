/**
 * File-based logger for debugging when TUI console interception interferes
 * Writes to /logs directory for easy tail -f monitoring
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceRoot } from './workspace.js';

// Stable, predictable location beside the built apps (the workspace root),
// instead of process.cwd() which varies with where the runner is launched.
const LOGS_DIR = join(getWorkspaceRoot(), 'logs');
const RUNNER_LOG = join(LOGS_DIR, 'runner.log');
const STREAM_LOG = join(LOGS_DIR, 'stream.log');
const ERRORS_LOG = join(LOGS_DIR, 'errors.log');

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLog(file: string, level: string, ...args: unknown[]): void {
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');

  const logLine = `[${timestamp()}] [${level}] ${message}\n`;

  try {
    appendFileSync(file, logLine);
  } catch (err) {
    // Silently fail - don't want logging to crash the app
    console.error('Failed to write log:', err);
  }
}

/**
 * General runner logs - everything goes here
 */
export const fileLog = {
  info: (...args: unknown[]) => writeLog(RUNNER_LOG, 'INFO', ...args),
  warn: (...args: unknown[]) => writeLog(RUNNER_LOG, 'WARN', ...args),
  error: (...args: unknown[]) => {
    writeLog(RUNNER_LOG, 'ERROR', ...args);
    writeLog(ERRORS_LOG, 'ERROR', ...args);
  },
  debug: (...args: unknown[]) => writeLog(RUNNER_LOG, 'DEBUG', ...args),
};

/**
 * Stream-specific logs - for tracking AI SDK events
 */
export const streamLog = {
  info: (...args: unknown[]) => writeLog(STREAM_LOG, 'INFO', ...args),
  warn: (...args: unknown[]) => writeLog(STREAM_LOG, 'WARN', ...args),
  event: (eventNumber: number, eventType: string, data: unknown) => {
    writeLog(STREAM_LOG, 'EVENT', `#${eventNumber} type="${eventType}"`, data);
  },
  yield: (messageType: string, data: unknown) => {
    writeLog(STREAM_LOG, 'YIELD', `type="${messageType}"`, data);
  },
  error: (...args: unknown[]) => {
    writeLog(STREAM_LOG, 'ERROR', ...args);
    writeLog(ERRORS_LOG, 'ERROR', ...args);
  },
};

// TUI mode flag - when true, don't output to terminal (only to file)
let tuiModeEnabled = false;

/**
 * Enable TUI mode - suppresses terminal output, only writes to files
 * Also sets SILENT_MODE env var to suppress agent-core build-logger output
 */
export function setFileLoggerTuiMode(enabled: boolean): void {
  tuiModeEnabled = enabled;
  // Set env var so agent-core's build-logger also silences itself
  if (enabled) {
    process.env.SILENT_MODE = '1';
  } else {
    delete process.env.SILENT_MODE;
  }
}

// Intercept console methods to also write to file
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

// Export original console for when we need direct output
export { originalConsole };

// Helper to check if we should suppress terminal output
// Check both the runtime flag AND the environment variable (set early in CLI)
function shouldSuppressTerminal(): boolean {
  return tuiModeEnabled || process.env.SILENT_MODE === '1';
}

// Override console methods to write to file (and optionally terminal)
console.log = (...args: unknown[]) => {
  if (!shouldSuppressTerminal()) {
    originalConsole.log(...args);
  }
  fileLog.info(...args);
};

console.error = (...args: unknown[]) => {
  if (!shouldSuppressTerminal()) {
    originalConsole.error(...args);
  }
  fileLog.error(...args);
};

console.warn = (...args: unknown[]) => {
  if (!shouldSuppressTerminal()) {
    originalConsole.warn(...args);
  }
  fileLog.warn(...args);
};

console.info = (...args: unknown[]) => {
  if (!shouldSuppressTerminal()) {
    originalConsole.info(...args);
  }
  fileLog.info(...args);
};

console.debug = (...args: unknown[]) => {
  if (!shouldSuppressTerminal()) {
    originalConsole.debug(...args);
  }
  fileLog.debug(...args);
};

// Log startup
fileLog.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
fileLog.info('Runner started - console interception enabled');
fileLog.info('Log files:');
fileLog.info(`  - General: ${RUNNER_LOG}`);
fileLog.info(`  - Stream:  ${STREAM_LOG}`);
fileLog.info(`  - Errors:  ${ERRORS_LOG}`);
fileLog.info('All console.log/error/warn/info/debug will be captured here');
fileLog.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
