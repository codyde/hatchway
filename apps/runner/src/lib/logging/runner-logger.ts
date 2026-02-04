/**
 * RunnerLogger - Unified logging for the Hatchway Runner
 * 
 * Provides structured logging with:
 * - Verbose mode filtering
 * - Build lifecycle tracking
 * - Tool call logging with truncated args
 * - Event emission for TUI components
 * - File persistence via LogBuffer
 */

import { EventEmitter } from 'node:events';
import chalk from 'chalk';
import { LogBuffer, getLogBuffer, createLogBuffer } from './log-buffer.js';
import type {
  LogEntry,
  LogLevel,
  LogCategory,
  BuildInfo,
  TodoItem,
  BuildCompletionStats,
  LoggerEvents,
} from './types.js';

const MAX_ARG_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 80;

export interface RunnerLoggerOptions {
  verbose?: boolean;
  tuiMode?: boolean;
  logDir?: string;
}

export class RunnerLogger extends EventEmitter {
  private verbose: boolean;
  private tuiMode: boolean;
  private buffer: LogBuffer;
  private builds: Map<string, BuildInfo> = new Map();
  private currentBuildId: string | null = null;
  private connected: boolean = false;

  constructor(options?: RunnerLoggerOptions) {
    super();
    this.verbose = options?.verbose ?? false;
    this.tuiMode = options?.tuiMode ?? true;
    this.buffer = options?.logDir 
      ? createLogBuffer({ logDir: options.logDir })
      : getLogBuffer();
  }

  // ============================================
  // Configuration
  // ============================================

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
    this.emit('verboseChange', verbose);
  }

  isVerbose(): boolean {
    return this.verbose;
  }

  setTuiMode(tuiMode: boolean): void {
    this.tuiMode = tuiMode;
  }

  // ============================================
  // Connection Status
  // ============================================

  setConnected(connected: boolean): void {
    this.connected = connected;
    if (connected) {
      this.success('system', 'Connected to server');
      this.emit('connected');
    } else {
      this.warn('system', 'Disconnected from server');
      this.emit('disconnected');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================
  // Startup / Header
  // ============================================

  /**
   * Print the startup header with runner configuration
   */
  header(config: {
    runnerId: string;
    serverUrl: string;
    workspace: string;
    apiUrl?: string;
  }): void {
    if (this.tuiMode) {
      // In TUI mode, header is rendered by the dashboard
      // Just emit the config for the TUI to use
      this.emit('config', config);
      return;
    }

    // Plain text mode - print formatted header
    const line = '━'.repeat(60);
    console.log(chalk.cyan(line));
    console.log(chalk.cyan.bold(' Hatchway Runner'));
    console.log(chalk.cyan(line));
    console.log(chalk.gray(' Runner ID  '), chalk.white(config.runnerId));
    console.log(chalk.gray(' Server     '), chalk.white(config.serverUrl));
    console.log(chalk.gray(' Workspace  '), chalk.white(config.workspace));
    if (config.apiUrl) {
      console.log(chalk.gray(' API        '), chalk.white(config.apiUrl));
    }
    console.log(chalk.cyan(line));
    console.log();
  }

  // ============================================
  // Generic Log Methods
  // ============================================

  info(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('info', category, message, data);
  }

  success(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('success', category, message, data);
  }

  warn(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('warn', category, message, data);
  }

  error(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('error', category, message, data);
  }

  debug(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('debug', category, message, data, true);
  }

  // ============================================
  // Build Lifecycle
  // ============================================

  /**
   * Log when a build command is received
   */
  buildReceived(build: {
    commandId: string;
    projectId: string;
    projectSlug: string;
    projectName?: string;
    prompt: string;
    operation: string;
    agent: string;
    model: string;
  }): void {
    const buildInfo: BuildInfo = {
      id: build.commandId,
      projectId: build.projectId,
      projectSlug: build.projectSlug,
      projectName: build.projectName,
      prompt: build.prompt,
      operation: build.operation,
      agent: build.agent,
      model: build.model,
      startTime: Date.now(),
      status: 'pending',
      todos: [],
      toolCallCount: 0,
    };

    this.builds.set(build.commandId, buildInfo);
    this.currentBuildId = build.commandId;

    // Log the build received event
    this.info('build', `Build received: ${build.projectSlug}`, { buildId: build.commandId });
    
    // Log the prompt (truncated in normal mode, full in verbose)
    const truncatedPrompt = this.truncate(build.prompt, this.verbose ? 200 : 60);
    this.log('info', 'build', `Prompt: "${truncatedPrompt}"`, undefined, !this.verbose && build.prompt.length > 60);
    
    this.log('info', 'build', `Operation: ${build.operation}`, undefined, true);

    this.emit('buildStart', buildInfo);
  }

  /**
   * Log template selection and download
   */
  template(info: {
    name: string;
    id?: string;
    source?: string;
    fileCount?: number;
    status: 'selected' | 'downloading' | 'downloaded';
  }): void {
    switch (info.status) {
      case 'selected':
        this.info('template', `Template: ${info.name}${info.id ? ` (${info.id})` : ''}`);
        break;
      case 'downloading':
        this.log('info', 'template', `Downloading from ${info.source}...`, undefined, true);
        break;
      case 'downloaded':
        this.info('template', `Downloaded (${info.fileCount} files)`);
        break;
    }

    if (this.currentBuildId) {
      const build = this.builds.get(this.currentBuildId);
      if (build) {
        build.template = info.name;
        build.templateId = info.id;
        this.emit('buildUpdate', build);
      }
    }
  }

  /**
   * Log when build execution starts
   */
  buildStart(info?: { agent?: string; model?: string; directory?: string }): void {
    this.info('build', 'Build started');
    
    if (info?.agent) {
      this.log('info', 'build', `Agent: ${info.agent}${info.model ? ` (${info.model})` : ''}`, undefined, true);
    }
    
    if (info?.directory) {
      this.log('info', 'build', `Directory: ${info.directory}`, undefined, true);
    }

    if (this.currentBuildId) {
      const build = this.builds.get(this.currentBuildId);
      if (build) {
        build.status = 'running';
        build.directory = info?.directory;
        this.emit('buildUpdate', build);
      }
    }
  }

  /**
   * Log build completion
   */
  buildComplete(stats: BuildCompletionStats): void {
    const elapsed = this.formatDuration(stats.elapsedTime);
    this.success('build', `Build complete (${elapsed})`);
    this.info('build', `Tool calls: ${stats.toolCallCount} | Tokens: ${stats.totalTokens.toLocaleString()}`);
    this.log('info', 'build', `Directory: ${stats.directory}`, undefined, true);

    if (this.currentBuildId) {
      const build = this.builds.get(this.currentBuildId);
      if (build) {
        build.status = 'completed';
        build.endTime = Date.now();
        build.totalTokens = stats.totalTokens;
        this.emit('buildComplete', build, stats);
      }
      this.currentBuildId = null;
    }
  }

  /**
   * Log build failure
   */
  buildFailed(error: string | Error): void {
    const message = error instanceof Error ? error.message : error;
    this.error('build', `Build failed: ${message}`);

    if (this.currentBuildId) {
      const build = this.builds.get(this.currentBuildId);
      if (build) {
        build.status = 'failed';
        build.endTime = Date.now();
        build.error = message;
        this.emit('buildComplete', build, {
          elapsedTime: (build.endTime - build.startTime) / 1000,
          toolCallCount: build.toolCallCount,
          totalTokens: build.totalTokens ?? 0,
          directory: build.directory ?? '',
        });
      }
      this.currentBuildId = null;
    }
  }

  // ============================================
  // Tool Calls
  // ============================================

  /**
   * Log a tool call with truncated arguments
   */
  tool(toolName: string, args?: Record<string, unknown> | string): void {
    const truncatedArgs = this.formatToolArgs(toolName, args);
    
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level: 'info',
      category: 'tool',
      message: `${toolName}${truncatedArgs ? ` ${truncatedArgs}` : ''}`,
      toolName,
      toolArgs: truncatedArgs,
      buildId: this.currentBuildId ?? undefined,
    };

    this.buffer.add(entry);
    
    // Increment tool count
    if (this.currentBuildId) {
      const build = this.builds.get(this.currentBuildId);
      if (build) {
        build.toolCallCount++;
        this.emit('buildUpdate', build);
      }
    }

    if (!this.tuiMode) {
      this.printEntry(entry);
    }

    this.emit('log', entry);
  }

  /**
   * Format tool arguments for display
   */
  private formatToolArgs(toolName: string, args?: Record<string, unknown> | string): string {
    if (!args) return '';
    
    // If already a string, just truncate it
    if (typeof args === 'string') {
      return `(${this.truncate(args, MAX_ARG_LENGTH)})`;
    }

    // Format based on tool type
    switch (toolName) {
      case 'Read':
      case 'read':
      case 'Write':
      case 'write':
      case 'Edit':
      case 'edit':
        // Try various path field names used by different SDKs
        const pathValue = args.filePath || args.file_path || args.path || args.target || args.file;
        if (pathValue) {
          const path = String(pathValue);
          // Show just the filename or last part of path
          const fileName = path.split('/').pop() || path;
          return fileName;
        }
        break;
      
      case 'Bash':
        if (args.command) {
          return `(${this.truncate(String(args.command), MAX_ARG_LENGTH)})`;
        }
        break;
      
      case 'Glob':
      case 'Grep':
        if (args.pattern) {
          return `(${this.truncate(String(args.pattern), MAX_ARG_LENGTH)})`;
        }
        break;
      
      case 'TodoWrite':
        if (Array.isArray(args.todos)) {
          return `(${args.todos.length} items)`;
        }
        break;
      
      default:
        // For other tools, try to show the first string value
        for (const [key, value] of Object.entries(args)) {
          if (typeof value === 'string' && value.length > 0) {
            return `(${this.truncate(value, MAX_ARG_LENGTH)})`;
          }
        }
    }

    return '';
  }

  // ============================================
  // Agent Messages
  // ============================================

  /**
   * Log agent thinking/message
   */
  agent(message: string): void {
    const truncated = this.truncate(message, MAX_MESSAGE_LENGTH);
    this.log('info', 'agent', truncated, undefined, message.length > MAX_MESSAGE_LENGTH);
  }

  // ============================================
  // Todo List Updates
  // ============================================

  /**
   * Update the todo list for the current build
   */
  updateTodos(todos: TodoItem[]): void {
    if (!this.currentBuildId) return;

    const build = this.builds.get(this.currentBuildId);
    if (build) {
      build.todos = todos;
      this.emit('todoUpdate', this.currentBuildId, todos);
      this.emit('buildUpdate', build);
    }
  }

  // ============================================
  // Dev Server / Tunnel
  // ============================================

  devServer(info: { port: number; status: 'starting' | 'started' | 'stopped' | 'error'; url?: string; error?: string }): void {
    switch (info.status) {
      case 'starting':
        this.info('server', `Starting dev server on port ${info.port}...`);
        break;
      case 'started':
        this.success('server', `Dev server running on port ${info.port}`);
        if (info.url) {
          this.info('server', `URL: ${info.url}`);
        }
        break;
      case 'stopped':
        this.info('server', 'Dev server stopped');
        break;
      case 'error':
        this.error('server', `Dev server error: ${info.error}`);
        break;
    }
  }

  tunnel(info: { port: number; url?: string; status: 'creating' | 'created' | 'closed' | 'error'; error?: string }): void {
    switch (info.status) {
      case 'creating':
        this.log('info', 'server', `Creating tunnel for port ${info.port}...`, undefined, true);
        break;
      case 'created':
        this.success('server', `Tunnel: ${info.url} → localhost:${info.port}`);
        break;
      case 'closed':
        this.info('server', 'Tunnel closed');
        break;
      case 'error':
        this.error('server', `Tunnel error: ${info.error}`);
        break;
    }
  }

  // ============================================
  // Build Access
  // ============================================

  getCurrentBuild(): BuildInfo | null {
    if (!this.currentBuildId) return null;
    return this.builds.get(this.currentBuildId) ?? null;
  }

  getAllBuilds(): BuildInfo[] {
    return Array.from(this.builds.values());
  }

  getBuild(buildId: string): BuildInfo | null {
    return this.builds.get(buildId) ?? null;
  }

  // ============================================
  // Buffer Access
  // ============================================

  getBuffer(): LogBuffer {
    return this.buffer;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    verbose: boolean = false,
  ): void {
    // Skip verbose logs when not in verbose mode
    if (verbose && !this.verbose) {
      return;
    }

    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      buildId: this.currentBuildId ?? undefined,
      verbose,
    };

    this.buffer.add(entry);

    if (!this.tuiMode) {
      this.printEntry(entry);
    }

    this.emit('log', entry);
  }

  private printEntry(entry: LogEntry): void {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

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
      // Tool calls get special formatting
      console.log(
        chalk.gray(time),
        '  ',
        chalk.cyan('🔧'),
        chalk.white(entry.toolName),
        entry.toolArgs ? chalk.gray(entry.toolArgs) : '',
      );
    } else {
      // Regular log entries
      console.log(
        chalk.gray(time),
        style(icon),
        style(entry.message),
      );
    }
  }

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// Singleton instance
let instance: RunnerLogger | null = null;

export function getRunnerLogger(): RunnerLogger {
  if (!instance) {
    instance = new RunnerLogger();
  }
  return instance;
}

export function createRunnerLogger(options?: RunnerLoggerOptions): RunnerLogger {
  instance = new RunnerLogger(options);
  return instance;
}
