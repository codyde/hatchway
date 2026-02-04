/**
 * PlainFormatter - Formats log entries for plain-text console output
 * 
 * Used in --no-tui mode to provide clean, readable console output
 * with proper formatting, timestamps, and colors.
 */

import chalk from 'chalk';
import type { LogEntry, BuildInfo, BuildCompletionStats, TodoItem } from './types.js';

/**
 * Format a log entry for console output
 */
export function formatLogEntry(entry: LogEntry): string {
  const time = formatTime(entry.timestamp);

  const levelStyles = {
    debug: chalk.gray,
    info: chalk.blue,
    success: chalk.green,
    warn: chalk.yellow,
    error: chalk.red,
  };

  const levelIcons = {
    debug: '  ',
    info: '●',
    success: '✓',
    warn: '⚠',
    error: '✗',
  };

  const style = levelStyles[entry.level];
  const icon = levelIcons[entry.level];

  if (entry.toolName) {
    // Tool calls get special formatting with indentation
    const args = entry.toolArgs ? chalk.gray(` ${entry.toolArgs}`) : '';
    return `${chalk.gray(time)}   ${chalk.cyan('🔧')} ${chalk.white(entry.toolName)}${args}`;
  }

  // Regular log entries
  return `${chalk.gray(time)} ${style(icon)} ${style(entry.message)}`;
}

/**
 * Format multiple log entries with optional grouping
 */
export function formatLogEntries(entries: LogEntry[]): string {
  return entries.map(formatLogEntry).join('\n');
}

/**
 * Format the startup header
 */
export function formatHeader(config: {
  runnerId: string;
  serverUrl: string;
  workspace: string;
  apiUrl?: string;
}): string {
  const line = '━'.repeat(60);
  const lines = [
    chalk.cyan(line),
    chalk.cyan.bold(' Hatchway Runner'),
    chalk.cyan(line),
    `${chalk.gray(' Runner ID  ')} ${chalk.white(config.runnerId)}`,
    `${chalk.gray(' Server     ')} ${chalk.white(config.serverUrl)}`,
    `${chalk.gray(' Workspace  ')} ${chalk.white(config.workspace)}`,
  ];

  if (config.apiUrl) {
    lines.push(`${chalk.gray(' API        ')} ${chalk.white(config.apiUrl)}`);
  }

  lines.push(chalk.cyan(line), '');

  return lines.join('\n');
}

/**
 * Format build received message
 */
export function formatBuildReceived(build: BuildInfo): string {
  const lines = [
    '',
    `${chalk.gray(formatTime(build.startTime))} ${chalk.blue('●')} ${chalk.blue('Build received:')} ${chalk.white(build.projectSlug)}`,
  ];

  // Show truncated prompt
  const promptPreview = build.prompt.length > 60 
    ? build.prompt.substring(0, 57) + '...'
    : build.prompt;
  lines.push(`${chalk.gray('           ')} ${chalk.gray(`Prompt: "${promptPreview}"`)}`);
  
  lines.push(`${chalk.gray('           ')} ${chalk.gray(`Operation: ${build.operation}`)}`);

  return lines.join('\n');
}

/**
 * Format template info
 */
export function formatTemplate(info: {
  name: string;
  id?: string;
  fileCount?: number;
  status: 'selected' | 'downloading' | 'downloaded';
}): string {
  const time = formatTime(Date.now());

  switch (info.status) {
    case 'selected':
      return `${chalk.gray(time)} ${chalk.blue('●')} ${chalk.blue('Template:')} ${chalk.white(info.name)}`;
    case 'downloading':
      return `${chalk.gray(time)} ${chalk.gray('  ')} ${chalk.gray(`└─ Downloading...`)}`;
    case 'downloaded':
      return `${chalk.gray(time)} ${chalk.gray('  ')} ${chalk.gray(`└─ Downloaded (${info.fileCount} files)`)}`;
    default:
      return '';
  }
}

/**
 * Format build start message
 */
export function formatBuildStart(info: { agent: string; model: string; directory?: string }): string {
  const time = formatTime(Date.now());
  const lines = [
    `${chalk.gray(time)} ${chalk.blue('●')} ${chalk.blue('Build started')}`,
    `${chalk.gray('           ')} ${chalk.gray(`Agent: ${info.agent} (${info.model})`)}`,
  ];

  if (info.directory) {
    lines.push(`${chalk.gray('           ')} ${chalk.gray(`Directory: ${info.directory}`)}`);
  }

  return lines.join('\n');
}

/**
 * Format build completion message
 */
export function formatBuildComplete(stats: BuildCompletionStats, success: boolean = true): string {
  const time = formatTime(Date.now());
  const elapsed = formatDuration(stats.elapsedTime);

  if (success) {
    const lines = [
      '',
      `${chalk.gray(time)} ${chalk.green('✓')} ${chalk.green(`Build complete (${elapsed})`)}`,
      `${chalk.gray('           ')} ${chalk.gray(`Tool calls: ${stats.toolCallCount} | Tokens: ${stats.totalTokens.toLocaleString()}`)}`,
      `${chalk.gray('           ')} ${chalk.gray(`Directory: ${stats.directory}`)}`,
      '',
    ];
    return lines.join('\n');
  } else {
    return `${chalk.gray(time)} ${chalk.red('✗')} ${chalk.red(`Build failed (${elapsed})`)}`;
  }
}

/**
 * Format build failure message
 */
export function formatBuildFailed(error: string): string {
  const time = formatTime(Date.now());
  return `${chalk.gray(time)} ${chalk.red('✗')} ${chalk.red(`Build failed: ${error}`)}`;
}

/**
 * Format todo list for console output
 */
export function formatTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) return '';

  const lines = ['', chalk.gray('  Tasks:')];

  for (const todo of todos) {
    const icon = {
      pending: chalk.gray('○'),
      in_progress: chalk.cyan('⠹'),
      completed: chalk.green('✓'),
      cancelled: chalk.gray('⊘'),
    }[todo.status];

    const style = {
      pending: chalk.gray,
      in_progress: chalk.white,
      completed: chalk.gray,
      cancelled: chalk.gray,
    }[todo.status];

    // Truncate long content
    const content = todo.content.length > 40 
      ? todo.content.substring(0, 37) + '...'
      : todo.content;

    lines.push(`  ${icon} ${style(content)}`);
  }

  return lines.join('\n');
}

/**
 * Format dev server status
 */
export function formatDevServer(info: {
  port: number;
  status: 'starting' | 'started' | 'stopped' | 'error';
  url?: string;
  error?: string;
}): string {
  const time = formatTime(Date.now());

  switch (info.status) {
    case 'starting':
      return `${chalk.gray(time)} ${chalk.blue('●')} ${chalk.blue(`Starting dev server on port ${info.port}...`)}`;
    case 'started':
      const urlPart = info.url ? ` → ${info.url}` : '';
      return `${chalk.gray(time)} ${chalk.green('✓')} ${chalk.green(`Dev server running on port ${info.port}${urlPart}`)}`;
    case 'stopped':
      return `${chalk.gray(time)} ${chalk.gray('●')} ${chalk.gray('Dev server stopped')}`;
    case 'error':
      return `${chalk.gray(time)} ${chalk.red('✗')} ${chalk.red(`Dev server error: ${info.error}`)}`;
    default:
      return '';
  }
}

/**
 * Format tunnel status
 */
export function formatTunnel(info: {
  port: number;
  url?: string;
  status: 'creating' | 'created' | 'closed' | 'error';
  error?: string;
}): string {
  const time = formatTime(Date.now());

  switch (info.status) {
    case 'creating':
      return `${chalk.gray(time)} ${chalk.gray('  ')} ${chalk.gray(`Creating tunnel for port ${info.port}...`)}`;
    case 'created':
      return `${chalk.gray(time)} ${chalk.green('✓')} ${chalk.green(`Tunnel: ${info.url} → localhost:${info.port}`)}`;
    case 'closed':
      return `${chalk.gray(time)} ${chalk.gray('●')} ${chalk.gray('Tunnel closed')}`;
    case 'error':
      return `${chalk.gray(time)} ${chalk.red('✗')} ${chalk.red(`Tunnel error: ${info.error}`)}`;
    default:
      return '';
  }
}

/**
 * Format a separator line
 */
export function formatSeparator(): string {
  return chalk.gray('─'.repeat(60));
}

// Helper functions

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}
