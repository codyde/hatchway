import type { AgentId as CoreAgentId, ClaudeModelId as CoreClaudeModelId } from '../../types/agent';
import type { DesignPreferences } from '../../types/design';
import type { AppliedTag } from '../../types/tags';

export type AgentId = CoreAgentId;
export type ClaudeModelId = CoreClaudeModelId;

export type RunnerCommandType =
  | 'analyze-project'
  | 'start-build'
  | 'cancel-build'
  | 'start-dev-server'
  | 'stop-dev-server'
  | 'start-tunnel'
  | 'stop-tunnel'
  | 'fetch-logs'
  | 'runner-health-check'
  | 'delete-project-files'
  | 'read-file'
  | 'write-file'
  | 'list-files'
  | 'http-proxy-request'
  | 'hmr-connect'
  | 'hmr-message'
  | 'hmr-disconnect'
  | 'github-sync'
  | 'github-push';

export type RunnerEventType =
  | 'ack'
  | 'log-chunk'
  | 'port-detected'
  | 'port-conflict'
  | 'port-reallocated'
  | 'tunnel-created'
  | 'tunnel-closed'
  | 'process-exited'
  | 'build-progress'
  | 'build-completed'
  | 'build-summary'
  | 'build-failed'
  | 'build-cancelled'
  | 'runner-status'
  | 'build-stream'
  | 'project-metadata'
  | 'analysis-started'
  | 'analysis-complete'
  | 'files-deleted'
  | 'file-content'
  | 'file-written'
  | 'file-list'
  | 'dev-server-error'
  | 'autofix-started'
  | 'http-proxy-response'
  | 'http-proxy-chunk'
  | 'http-proxy-error'
  | 'hmr-connected'
  | 'hmr-message'
  | 'hmr-disconnected'
  | 'hmr-error'
  | 'error';

export interface BaseCommand {
  id: string;
  type: RunnerCommandType;
  projectId: string;
  timestamp: string;
  _sentry?: {
    trace?: string;
    baggage?: string;
  };
}

/**
 * Analyze project command - sent before project is created in DB
 * Runner performs AI analysis and returns metadata for project creation
 */
export interface AnalyzeProjectCommand {
  id: string;
  type: 'analyze-project';
  timestamp: string;
  payload: {
    prompt: string;
    operationType: 'initial-build';
    agent: AgentId;
    claudeModel?: ClaudeModelId;
    tags?: AppliedTag[];
    runnerId: string;
  };
  _sentry?: {
    trace?: string;
    baggage?: string;
  };
}

export interface StartBuildCommand extends BaseCommand {
  type: 'start-build';
  payload: {
    sessionId?: string; // Session ID for correlating events
    prompt: string;
    operationType: string;
    projectSlug: string;
    projectName: string;
    context?: Record<string, unknown>;
    templateId?: string | null;
    regenerate?: boolean;
    agent?: AgentId;
    claudeModel?: ClaudeModelId;
    droidModel?: string; // Model ID for factory-droid agent (e.g., 'claude-opus-4-5-20251101', 'gpt-5.2-codex', 'glm-4.7')
    codexThreadId?: string; // For resuming Codex threads
    messageParts?: Array<{
      type: string;
      text?: string;
      image?: string;
      mimeType?: string;
      fileName?: string;
    }>; // Multi-modal content (text, images, etc.)
    template?: {
      id: string;
      name: string;
      framework: string;
      port: number;
      runCommand: string;
      repository: string;
      branch: string;
    }; // NEW: Frontend-selected template metadata
    designPreferences?: DesignPreferences; // User-specified design constraints (deprecated - use tags)
    tags?: AppliedTag[]; // Tag-based configuration system
    conversationHistory?: Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>; // Recent conversation messages for context in enhancements
    isAutoFix?: boolean; // Flag for auto-fix sessions triggered by startup/runtime errors
    autoFixError?: string; // The error message that triggered the auto-fix
  };
}

export interface CancelBuildCommand extends BaseCommand {
  type: 'cancel-build';
  payload: {
    buildCommandId: string; // The command ID of the build to cancel
    sessionId?: string; // Session ID for correlation
    reason?: string; // Optional reason for cancellation
  };
}

export interface StartDevServerCommand extends BaseCommand {
  type: 'start-dev-server';
  payload: {
    runCommand: string;
    workingDirectory: string;
    env?: Record<string, string>;
    preferredPort?: number | null;
    framework?: string;
  };
}

export interface StopDevServerCommand extends BaseCommand {
  type: 'stop-dev-server';
}

export interface StartTunnelCommand extends BaseCommand {
  type: 'start-tunnel';
  payload: {
    port: number;
  };
}

export interface StopTunnelCommand extends BaseCommand {
  type: 'stop-tunnel';
  payload: {
    port: number;
  };
}

export interface FetchLogsCommand extends BaseCommand {
  type: 'fetch-logs';
  payload: {
    cursor?: string;
    limit?: number;
  };
}

export interface RunnerHealthCheckCommand extends BaseCommand {
  type: 'runner-health-check';
}

export interface DeleteProjectFilesCommand extends BaseCommand {
  type: 'delete-project-files';
  payload: {
    slug: string;
  };
}

export interface ReadFileCommand extends BaseCommand {
  type: 'read-file';
  payload: {
    slug: string;
    filePath: string;
  };
}

export interface WriteFileCommand extends BaseCommand {
  type: 'write-file';
  payload: {
    slug: string;
    filePath: string;
    content: string;
  };
}

export interface ListFilesCommand extends BaseCommand {
  type: 'list-files';
  payload: {
    slug: string;
    path?: string;
  };
}

export interface HttpProxyRequestCommand extends BaseCommand {
  type: 'http-proxy-request';
  payload: {
    requestId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string | null; // Base64 encoded for binary
    port: number; // Target dev server port
  };
}

// HMR Proxy Commands - for proxying Vite/webpack HMR WebSocket through our connection
export interface HmrConnectCommand extends BaseCommand {
  type: 'hmr-connect';
  payload: {
    connectionId: string;
    port: number;
    protocol?: string; // e.g., 'vite-hmr'
  };
}

export interface HmrMessageCommand extends BaseCommand {
  type: 'hmr-message';
  payload: {
    connectionId: string;
    message: string; // JSON stringified HMR payload
  };
}

export interface HmrDisconnectCommand extends BaseCommand {
  type: 'hmr-disconnect';
  payload: {
    connectionId: string;
  };
}

// GitHub Integration Commands - for syncing and pushing to GitHub repositories
export interface GithubSyncCommand extends BaseCommand {
  type: 'github-sync';
  payload: {
    slug: string;
    repo: string; // owner/repo format
  };
}

export interface GithubPushCommand extends BaseCommand {
  type: 'github-push';
  payload: {
    slug: string;
    repo: string; // owner/repo format
    commitMessage: string;
    branch?: string; // defaults to 'main'
  };
}

export type RunnerCommand =
  | AnalyzeProjectCommand
  | StartBuildCommand
  | CancelBuildCommand
  | StartDevServerCommand
  | StopDevServerCommand
  | StartTunnelCommand
  | StopTunnelCommand
  | FetchLogsCommand
  | RunnerHealthCheckCommand
  | DeleteProjectFilesCommand
  | ReadFileCommand
  | WriteFileCommand
  | ListFilesCommand
  | HttpProxyRequestCommand
  | HmrConnectCommand
  | HmrMessageCommand
  | HmrDisconnectCommand
  | GithubSyncCommand
  | GithubPushCommand;

export interface BaseEvent {
  type: RunnerEventType;
  commandId?: string;
  projectId?: string;
  sessionId?: string;
  timestamp: string;
  _sentry?: {
    trace?: string;
    baggage?: string;
  };
}

export interface AckEvent extends BaseEvent {
  type: 'ack';
  message?: string;
}

export interface LogChunkEvent extends BaseEvent {
  type: 'log-chunk';
  stream: 'stdout' | 'stderr';
  data: string;
  cursor: string;
}

export interface PortDetectedEvent extends BaseEvent {
  type: 'port-detected';
  port: number;
  tunnelUrl?: string;
  framework: string;
}

export interface TunnelCreatedEvent extends BaseEvent {
  type: 'tunnel-created';
  port: number;
  tunnelUrl: string;
}

export interface PortConflictEvent extends BaseEvent {
  type: 'port-conflict';
  port: number;
  message?: string;
}

export interface PortReallocatedEvent extends BaseEvent {
  type: 'port-reallocated';
  originalPort: number;
  newPort: number;
  message?: string;
}

export interface TunnelClosedEvent extends BaseEvent {
  type: 'tunnel-closed';
  port: number;
}

export interface ProcessExitedEvent extends BaseEvent {
  type: 'process-exited';
  exitCode: number | null;
  signal: string | null;
  durationMs: number | null;
  state?: string;
  failureReason?: string;
  stderr?: string; // Captured stderr output for immediate crashes
}

export interface BuildProgressEvent extends BaseEvent {
  type: 'build-progress';
  payload: {
    stage: 'planning' | 'generating' | 'applying' | 'finalizing';
    message: string;
    todoId?: string;
    todoStatus?: 'pending' | 'in_progress' | 'completed' | 'failed';
  };
}

export interface BuildCompletedEvent extends BaseEvent {
  type: 'build-completed';
  payload: {
    todos: Array<{
      id: string;
      title: string;
      status: 'completed' | 'skipped';
    }>;
    summary?: string;
    detectedFramework?: string | null; // Framework detected from project files
  };
}

export interface BuildSummaryEvent extends BaseEvent {
  type: 'build-summary';
  payload: {
    summary: string;
  };
}

export interface BuildFailedEvent extends BaseEvent {
  type: 'build-failed';
  error: string;
  stack?: string;
}

export interface BuildCancelledEvent extends BaseEvent {
  type: 'build-cancelled';
  payload: {
    buildCommandId: string; // The command ID of the cancelled build
    success: boolean; // Whether the cancellation succeeded
    reason: string; // Reason for success/failure
  };
}

export interface RunnerStatusEvent extends BaseEvent {
  type: 'runner-status';
  payload: {
    status: 'online' | 'offline' | 'degraded';
    version: string;
    hostname: string;
    platform: string;
    uptimeSeconds: number;
    load?: number;
  };
}

export interface BuildStreamEvent extends BaseEvent {
  type: 'build-stream';
  data: string;
}

export interface ProjectMetadataEvent extends BaseEvent {
  type: 'project-metadata';
  payload: {
    path: string;
    projectType: string;
    runCommand: string;
    port: number;
    detectedFramework?: string;
    // New fields for pre-build analysis (analyze-project command)
    slug?: string;
    friendlyName?: string;
    description?: string;
    icon?: string;
    template?: {
      id: string;
      name: string;
      framework: string;
      port: number;
      runCommand: string;
      repository: string;
      branch: string;
    };
  };
}

export interface AnalysisStartedEvent extends BaseEvent {
  type: 'analysis-started';
}

export interface AnalysisCompleteEvent extends BaseEvent {
  type: 'analysis-complete';
}

export interface FilesDeletedEvent extends BaseEvent {
  type: 'files-deleted';
  slug: string;
}

export interface FileContentEvent extends BaseEvent {
  type: 'file-content';
  slug: string;
  filePath: string;
  content: string;
  size: number;
}

export interface FileWrittenEvent extends BaseEvent {
  type: 'file-written';
  slug: string;
  filePath: string;
}

export interface FileListEvent extends BaseEvent {
  type: 'file-list';
  slug: string;
  files: Array<{
    name: string;
    type: 'file' | 'directory';
    path: string;
    size?: number;
  }>;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  error: string;
  stack?: string;
}

export interface DevServerErrorEvent extends BaseEvent {
  type: 'dev-server-error';
  error: string;
  message: string;
}

export interface AutoFixStartedEvent extends BaseEvent {
  type: 'autofix-started';
  errorType: 'startup' | 'runtime'; // Whether this is a startup crash or runtime error
  errorMessage: string;
  attempt: number;
  maxAttempts: number;
}

export interface HttpProxyResponseEvent extends BaseEvent {
  type: 'http-proxy-response';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  body?: string; // Base64 encoded, for small responses sent in one message
  isChunked?: boolean; // If true, body will be sent via HttpProxyChunkEvent
}

export interface HttpProxyChunkEvent extends BaseEvent {
  type: 'http-proxy-chunk';
  requestId: string;
  chunk: string; // Base64 encoded chunk
  isFinal: boolean;
}

export interface HttpProxyErrorEvent extends BaseEvent {
  type: 'http-proxy-error';
  requestId: string;
  error: string;
  statusCode?: number;
}

// HMR Proxy Events - for forwarding HMR messages from dev server to browser
export interface HmrConnectedEvent extends BaseEvent {
  type: 'hmr-connected';
  connectionId: string;
}

export interface HmrMessageEvent extends BaseEvent {
  type: 'hmr-message';
  connectionId: string;
  message: string; // JSON stringified HMR payload from Vite/webpack
}

export interface HmrDisconnectedEvent extends BaseEvent {
  type: 'hmr-disconnected';
  connectionId: string;
  code?: number;
  reason?: string;
}

export interface HmrErrorEvent extends BaseEvent {
  type: 'hmr-error';
  connectionId: string;
  error: string;
}

export type RunnerEvent =
  | AckEvent
  | LogChunkEvent
  | PortDetectedEvent
  | PortConflictEvent
  | PortReallocatedEvent
  | TunnelCreatedEvent
  | TunnelClosedEvent
  | ProcessExitedEvent
  | BuildProgressEvent
  | BuildCompletedEvent
  | BuildSummaryEvent
  | BuildFailedEvent
  | BuildCancelledEvent
  | RunnerStatusEvent
  | BuildStreamEvent
  | ProjectMetadataEvent
  | AnalysisStartedEvent
  | AnalysisCompleteEvent
  | FilesDeletedEvent
  | FileContentEvent
  | FileWrittenEvent
  | FileListEvent
  | DevServerErrorEvent
  | AutoFixStartedEvent
  | HttpProxyResponseEvent
  | HttpProxyChunkEvent
  | HttpProxyErrorEvent
  | HmrConnectedEvent
  | HmrMessageEvent
  | HmrDisconnectedEvent
  | HmrErrorEvent
  | ErrorEvent;

export type RunnerMessage = RunnerCommand | RunnerEvent;

const COMMAND_TYPES: RunnerCommandType[] = [
  'analyze-project',
  'start-build',
  'cancel-build',
  'start-dev-server',
  'stop-dev-server',
  'start-tunnel',
  'stop-tunnel',
  'fetch-logs',
  'runner-health-check',
  'delete-project-files',
  'read-file',
  'write-file',
  'list-files',
  'http-proxy-request',
  'hmr-connect',
  'hmr-message',
  'hmr-disconnect',
  'github-sync',
  'github-push',
];

export const isRunnerCommand = (message: RunnerMessage): message is RunnerCommand =>
  COMMAND_TYPES.includes((message as RunnerMessage).type as RunnerCommandType);

export const isRunnerEvent = (message: RunnerMessage): message is RunnerEvent =>
  !isRunnerCommand(message);
