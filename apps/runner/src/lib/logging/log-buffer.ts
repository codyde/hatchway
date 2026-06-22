/**
 * LogBuffer - File-backed circular buffer for log entries
 * 
 * Maintains an in-memory buffer of the most recent 100 entries
 * and persists all logs to a file for full history access.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { getWorkspaceRoot } from '../workspace.js';
import type { LogEntry, LogFilter } from './types.js';

const DEFAULT_BUFFER_SIZE = 100;
// Stable, absolute logs dir beside the built apps (workspace root) — a relative
// 'logs' resolved against process.cwd(), so writing/reading diverged when the
// runner was launched from different directories (TUI copy showed 0 lines).
const LOG_DIR = join(getWorkspaceRoot(), 'logs');
const LOG_FILE = 'runner-tui.log';

export class LogBuffer extends EventEmitter {
  private buffer: LogEntry[] = [];
  private maxSize: number;
  private logFilePath: string;
  private sessionStartTime: number;

  constructor(options?: { maxSize?: number; logDir?: string }) {
    super();
    this.maxSize = options?.maxSize ?? DEFAULT_BUFFER_SIZE;
    this.sessionStartTime = Date.now();
    
    // Set up log file path
    const logDir = options?.logDir ?? LOG_DIR;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    this.logFilePath = join(logDir, LOG_FILE);
    
    // Write session start marker
    this.writeToFile(`\n${'='.repeat(60)}\n`);
    this.writeToFile(`SESSION START: ${new Date().toISOString()}\n`);
    this.writeToFile(`${'='.repeat(60)}\n\n`);
  }

  /**
   * Add a log entry to the buffer and file
   */
  add(entry: LogEntry): void {
    // Add to in-memory buffer (circular)
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    // Write to file
    this.writeToFile(this.formatEntryForFile(entry));

    // Emit event for subscribers (TUI components)
    this.emit('log', entry);
  }

  /**
   * Get the most recent N entries from memory
   */
  getRecent(count?: number): LogEntry[] {
    const n = count ?? this.maxSize;
    return this.buffer.slice(-n);
  }

  /**
   * Get all entries currently in memory
   */
  getAll(): LogEntry[] {
    return [...this.buffer];
  }

  /**
   * Get filtered entries from memory
   */
  getFiltered(filter: LogFilter): LogEntry[] {
    return this.buffer.filter(entry => this.matchesFilter(entry, filter));
  }

  /**
   * Read entries from the log file (for full history)
   * Returns parsed log entries from the current session
   */
  readFromFile(maxLines?: number): LogEntry[] {
    if (!existsSync(this.logFilePath)) {
      return [];
    }

    try {
      const content = readFileSync(this.logFilePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Find the last session marker and only read from there
      let sessionStart = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('SESSION START:')) {
          sessionStart = i + 1;
          break;
        }
      }

      const sessionLines = lines.slice(sessionStart);
      const entries: LogEntry[] = [];

      for (const line of sessionLines) {
        const parsed = this.parseLogLine(line);
        if (parsed) {
          entries.push(parsed);
        }
      }

      if (maxLines && entries.length > maxLines) {
        return entries.slice(-maxLines);
      }

      return entries;
    } catch (error) {
      console.error('Failed to read log file:', error);
      return [];
    }
  }

  /**
   * Get the log file path for external access
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Convert buffer contents to plain text (for copying)
   */
  toText(entries?: LogEntry[]): string {
    const items = entries ?? this.buffer;
    return items.map(entry => this.formatEntryForDisplay(entry)).join('\n');
  }

  /**
   * Clear the in-memory buffer (file is preserved)
   */
  clear(): void {
    this.buffer = [];
    this.emit('clear');
  }

  /**
   * Subscribe to new log entries
   */
  onLog(callback: (entry: LogEntry) => void): () => void {
    this.on('log', callback);
    return () => this.off('log', callback);
  }

  // Private methods

  private writeToFile(content: string): void {
    try {
      appendFileSync(this.logFilePath, content);
    } catch (error) {
      // Silently fail - don't break logging if file write fails
    }
  }

  private formatEntryForFile(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(7);
    const category = entry.category.padEnd(12);
    
    let line = `[${timestamp}] [${level}] [${category}] ${entry.message}`;
    
    if (entry.toolName) {
      line += ` | tool=${entry.toolName}`;
      if (entry.toolArgs) {
        line += ` args=${entry.toolArgs}`;
      }
    }
    
    if (entry.buildId) {
      line += ` | build=${entry.buildId}`;
    }
    
    if (entry.data && Object.keys(entry.data).length > 0) {
      line += ` | data=${JSON.stringify(entry.data)}`;
    }
    
    return line + '\n';
  }

  private formatEntryForDisplay(entry: LogEntry): string {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    
    const levelIcon = {
      debug: '  ',
      info: '●',
      success: '✓',
      warn: '⚠',
      error: '✗',
    }[entry.level];

    if (entry.toolName) {
      return `${time}   🔧 ${entry.toolName}${entry.toolArgs ? ` ${entry.toolArgs}` : ''}`;
    }

    return `${time} ${levelIcon} ${entry.message}`;
  }

  private parseLogLine(line: string): LogEntry | null {
    // Parse format: [ISO_TIMESTAMP] [LEVEL  ] [CATEGORY    ] message | key=value...
    const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] (.+)$/);
    if (!match) {
      return null;
    }

    const [, timestamp, levelRaw, categoryRaw, rest] = match;
    const level = levelRaw.trim().toLowerCase() as LogEntry['level'];
    const category = categoryRaw.trim() as LogEntry['category'];

    // Parse message and optional fields
    const parts = rest.split(' | ');
    const message = parts[0];

    const entry: LogEntry = {
      id: `${Date.parse(timestamp)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.parse(timestamp),
      level,
      category,
      message,
    };

    // Parse optional key=value pairs
    for (let i = 1; i < parts.length; i++) {
      const [key, ...valueParts] = parts[i].split('=');
      const value = valueParts.join('=');
      
      switch (key) {
        case 'tool':
          entry.toolName = value;
          break;
        case 'args':
          entry.toolArgs = value;
          break;
        case 'build':
          entry.buildId = value;
          break;
        case 'data':
          try {
            entry.data = JSON.parse(value);
          } catch {
            // Ignore parse errors
          }
          break;
      }
    }

    return entry;
  }

  private matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
    if (filter.levels && !filter.levels.includes(entry.level)) {
      return false;
    }
    
    if (filter.categories && !filter.categories.includes(entry.category)) {
      return false;
    }
    
    if (filter.buildId && entry.buildId !== filter.buildId) {
      return false;
    }
    
    if (filter.verbose === false && entry.verbose) {
      return false;
    }
    
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const messageMatch = entry.message.toLowerCase().includes(searchLower);
      const toolMatch = entry.toolName?.toLowerCase().includes(searchLower);
      const argsMatch = entry.toolArgs?.toLowerCase().includes(searchLower);
      
      if (!messageMatch && !toolMatch && !argsMatch) {
        return false;
      }
    }
    
    return true;
  }
}

// Singleton instance
let instance: LogBuffer | null = null;

export function getLogBuffer(): LogBuffer {
  if (!instance) {
    instance = new LogBuffer();
  }
  return instance;
}

export function createLogBuffer(options?: { maxSize?: number; logDir?: string }): LogBuffer {
  instance = new LogBuffer(options);
  return instance;
}
