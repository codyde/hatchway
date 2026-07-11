const MAX_LOG_ENTRIES = 1000;

type LogStreamEvent =
  | { type: 'log'; entry: LogEntry }
  | { type: 'exit'; payload?: { code?: number | null; signal?: string | null } };

export interface LogEntry {
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
}

interface RunnerLogStore {
  logBuffers: Map<string, LogEntry[]>;
  listeners: Map<string, Set<(event: LogStreamEvent) => void>>;
}

declare global {
  var __runnerLogStore: RunnerLogStore | undefined;
}

// Next.js can bundle the runner-events and project-logs routes separately. A
// process-global store keeps both routes attached to the same buffers.
const store = globalThis.__runnerLogStore ?? {
  logBuffers: new Map<string, LogEntry[]>(),
  listeners: new Map<string, Set<(event: LogStreamEvent) => void>>(),
};
globalThis.__runnerLogStore = store;

const { logBuffers, listeners } = store;

function getBuffer(projectId: string) {
  if (!logBuffers.has(projectId)) {
    logBuffers.set(projectId, []);
  }
  return logBuffers.get(projectId)!;
}

export function appendRunnerLog(projectId: string, entry: LogEntry) {
  const buffer = getBuffer(projectId);
  buffer.push(entry);
  if (buffer.length > MAX_LOG_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_LOG_ENTRIES);
  }
  
  console.log(`[log-store] Appended log for project ${projectId}, buffer size: ${buffer.length}, listeners: ${listeners.get(projectId)?.size || 0}`);

  const projectListeners = listeners.get(projectId);
  if (projectListeners) {
    for (const listener of projectListeners) {
      listener({ type: 'log', entry });
    }
  }
}

export function markRunnerLogExit(
  projectId: string,
  payload?: { code?: number | null; signal?: string | null }
) {
  const projectListeners = listeners.get(projectId);
  if (projectListeners) {
    for (const listener of projectListeners) {
      listener({ type: 'exit', payload });
    }
  }
}

export function subscribeToRunnerLogs(
  projectId: string,
  listener: (event: LogStreamEvent) => void
) {
  const set = listeners.get(projectId);
  if (set) {
    set.add(listener);
  } else {
    listeners.set(projectId, new Set([listener]));
  }

  // Register first, then replay synchronously so a log cannot arrive between
  // taking the snapshot and attaching the live listener.
  for (const entry of getRunnerLogs(projectId)) {
    listener({ type: 'log', entry });
  }

  return () => {
    const current = listeners.get(projectId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(projectId);
    }
  };
}

export function getRunnerLogs(projectId: string, limit?: number): LogEntry[] {
  const buffer = logBuffers.get(projectId);
  if (!buffer || buffer.length === 0) {
    return [];
  }
  if (!limit || limit >= buffer.length) {
    return [...buffer];
  }
  return buffer.slice(buffer.length - limit);
}
