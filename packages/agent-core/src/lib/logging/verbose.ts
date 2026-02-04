const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'verbose']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

let cachedVerboseFlag: boolean | null = null;

function parseFlag(value?: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function detectVerboseFromEnv(): boolean | null {
  if (typeof process === 'undefined') return null;
  const candidates = [
    process.env.HATCHWAY_VERBOSE_LOGS,
    process.env.VERBOSE_LOGS,
    process.env.VERBOSE,
  ];

  for (const candidate of candidates) {
    const parsed = parseFlag(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function detectVerboseFromArgs(): boolean {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return false;
  }
  return process.argv.some((arg) => arg === '--verbose' || arg === '-v');
}

function computeVerboseFlag(): boolean {
  const envValue = detectVerboseFromEnv();
  if (envValue !== null) {
    return envValue;
  }
  return detectVerboseFromArgs();
}

export function isVerboseLoggingEnabled(): boolean {
  if (cachedVerboseFlag === null) {
    cachedVerboseFlag = computeVerboseFlag();
  }
  return cachedVerboseFlag;
}

export function setVerboseLogging(enabled: boolean) {
  cachedVerboseFlag = enabled;
}

export function createScopedLogger(scope: string) {
  return (message?: unknown, ...args: unknown[]) => {
    // Suppress all output in TUI mode (SILENT_MODE=1)
    if (process.env.SILENT_MODE === '1') return;
    if (!isVerboseLoggingEnabled()) return;
    if (typeof message === 'string' || typeof message === 'number') {
      console.log(`[${scope}] ${String(message)}`, ...args);
    } else if (message !== undefined) {
      console.log(`[${scope}]`, message, ...args);
    } else {
      console.log(`[${scope}]`);
    }
  };
}
