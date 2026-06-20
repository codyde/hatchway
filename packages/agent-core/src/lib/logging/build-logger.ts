/**
 * Unified Build Logger
 * Provides structured, consistent logging across all build components
 * with correlation tracking and context-specific methods
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = 'runner' | 'orchestrator' | 'transformer' | 'codex-query' | 'claude-query' | 'build' | 'websocket' | 'port-allocator' | 'process-manager' | 'build-events';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: LogContext;
  buildId?: string;
  projectId?: string;
  message: string;
  data?: Record<string, unknown>;
}

class BuildLogger {
  private buildId: string | null = null;
  private projectId: string | null = null;

  /**
   * Set correlation IDs for the current build
   * Call this at the start of each build to enable correlation tracking
   */
  setBuildContext(buildId: string, projectId: string) {
    this.buildId = buildId;
    this.projectId = projectId;
    this.log('debug', 'runner', `Build context set: ${buildId} / ${projectId}`);
  }

  /**
   * Clear correlation IDs after build completes
   */
  clearBuildContext() {
    this.log('debug', 'runner', 'Build context cleared');
    this.buildId = null;
    this.projectId = null;
  }

  /**
   * Core logging method - creates structured log entries
   * Public for custom logging needs
   */
  log(level: LogLevel, context: LogContext, message: string, data?: Record<string, unknown>) {
    // In TUI mode (SILENT_MODE=1), suppress ALL console output
    // The TUI has its own log display via the runner's unified logger
    if (process.env.SILENT_MODE === '1') {
      return; // Suppress all output in TUI mode
    }
    
    // Respect DEBUG_BUILD environment variable
    // info and debug logs are suppressed unless DEBUG_BUILD=1
    if (level === 'info' || level === 'debug') {
      if (process.env.DEBUG_BUILD === '0') {
        return;
      }
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      buildId: this.buildId ?? undefined,
      projectId: this.projectId ?? undefined,
      message,
      data,
    };

    // Console output with color coding and icons
    const prefix = `[${context}]`;
    const icon = {
      debug: '🔍',
      info: '📋',
      warn: '⚠️ ',
      error: '❌',
    }[level];

    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

    if (data && Object.keys(data).length > 0) {
      logFn(`${icon} ${prefix} ${message}`, data);
    } else {
      logFn(`${icon} ${prefix} ${message}`);
    }
  }

  /**
   * Orchestrator-specific logging methods
   */
  orchestrator = {
    newProject: (operationType: string) =>
      this.log('info', 'orchestrator', `NEW PROJECT (operationType: ${operationType})`),

    existingProject: (operationType: string) =>
      this.log('info', 'orchestrator', `EXISTING PROJECT (operationType: ${operationType})`),

    templateProvided: (templateName: string, templateId: string, framework: string) =>
      this.log('info', 'orchestrator', `Frontend provided template: ${templateName}`, {
        templateId,
        framework
      }),

    templateSelecting: (method: 'auto' | 'agent-managed') =>
      this.log('info', 'orchestrator', `Template selection: ${method}`),

    templateSelected: (templateName: string, templateId: string) =>
      this.log('info', 'orchestrator', `Selected template: ${templateName}`, { templateId }),

    templateDownloading: (templateName: string, repository: string, target: string) =>
      this.log('info', 'orchestrator', `Downloading template: ${templateName}`, {
        repository,
        target
      }),

    templateDownloaded: (templateName: string, path: string, fileTreeSize: number) =>
      this.log('info', 'orchestrator', `Template downloaded: ${templateName}`, {
        path,
        fileTreeSize
      }),

    catalogPrepared: (catalogSize: number) =>
      this.log('info', 'orchestrator', `Template catalog prepared (${catalogSize} chars)`, {
        catalogSize
      }),

    systemPromptGenerated: (size: number) =>
      this.log('info', 'orchestrator', `System prompt generated (${size} chars)`, { size }),

    orchestrationComplete: (data: { isNewProject: boolean; hasTemplate: boolean; hasMetadata: boolean }) =>
      this.log('info', 'orchestrator', 'Orchestration complete', data),

    error: (message: string, error: unknown) =>
      this.log('error', 'orchestrator', message, {
        error: error instanceof Error ? error.message : String(error)
      }),
  };

  /**
   * Message transformer-specific logging methods
   */
  transformer = {
    todoListFound: () =>
      this.log('debug', 'transformer', 'Found Codex task list, parsing...'),

    todoListParsed: (todoCount: number, completed: number, inProgress: number, pending: number) =>
      this.log('info', 'transformer', `Parsed ${todoCount} todos`, {
        completed,
        inProgress,
        pending
      }),

    todoListInvalidFormat: (expected: string, got: unknown) =>
      this.log('error', 'transformer', 'Invalid todo format from Codex', {
        expected,
        got: JSON.stringify(got).substring(0, 200)
      }),

    todoListParseError: (error: unknown, rawJson: string) =>
      this.log('error', 'transformer', 'Failed to parse Codex todolist', {
        error: String(error),
        rawJson: rawJson.substring(0, 300)
      }),

    todoListRemoved: () =>
      this.log('debug', 'transformer', 'Removed task list from chat text'),

    toolStarted: (toolName: string, toolId: string) =>
      this.log('debug', 'transformer', `Tool started: ${toolName}`, { toolName, toolId }),

    toolCompleted: (toolName: string, toolId: string) =>
      this.log('debug', 'transformer', `Tool completed: ${toolName}`, { toolName, toolId }),

    pathViolationWarning: (toolName: string, path: string, workspace: string) =>
      this.log('warn', 'transformer', `Path outside workspace: ${path}`, {
        toolName,
        path,
        workspace
      }),

    desktopPathDetected: (path: string) =>
      this.log('error', 'transformer', `DESKTOP PATH DETECTED - Likely hallucinated: ${path}`, { path }),
  };

  /**
   * Codex query-specific logging methods
   */
  codexQuery = {
    promptBuilding: (workingDirectory: string, systemPromptSize: number, userPromptSize: number) =>
      this.log('info', 'codex-query', 'Building Codex prompt', {
        workingDirectory,
        systemPromptSize,
        userPromptSize,
      }),

    threadStarting: () =>
      this.log('info', 'codex-query', 'Starting Codex thread (multi-turn)'),

    turnStarted: (turnNumber: number, maxTurns: number, promptSize: number) =>
      this.log('info', 'codex-query', `═══ Turn ${turnNumber}/${maxTurns} ═══`, {
        turnNumber,
        maxTurns,
        promptSize,
      }),

    taskListExtracted: () =>
      this.log('info', 'codex-query', 'Task list extracted and updated'),

    taskListStatus: (completed: number, inProgress: number, pending: number, total: number) =>
      this.log('info', 'codex-query', `Tasks: ${completed} completed | ${inProgress} in_progress | ${pending} pending (total: ${total})`, {
        completed,
        inProgress,
        pending,
        total,
      }),

    taskListTask: (index: number, content: string, status: string, icon: string) =>
      this.log('debug', 'codex-query', `  ${icon} ${index + 1}. ${content}`, { status }),

    taskListParseError: (error: unknown, rawContent: string) =>
      this.log('error', 'codex-query', 'PARSE ERROR: Could not parse task list JSON', {
        error: String(error),
        rawContent: rawContent.substring(0, 200),
      }),

    taskListMissing: (turnNumber: number) =>
      this.log('warn', 'codex-query', `WARNING: No <start-todolist> tags found in Turn ${turnNumber}`, {
        turnNumber,
      }),

    turnComplete: (turnNumber: number, hadToolCalls: boolean, messageLength: number) =>
      this.log('info', 'codex-query', `Turn ${turnNumber} complete`, {
        hadToolCalls,
        messageLength,
      }),

    tasksComplete: (completed: number, total: number) =>
      this.log('info', 'codex-query', `Task status: ${completed}/${total} completed`, {
        completed,
        total,
      }),

    allComplete: () =>
      this.log('info', 'codex-query', '✅ All MVP tasks complete!'),

    allTasksComplete: () =>
      this.log('info', 'codex-query', '✅ All MVP tasks complete!'),

    taskCompleteDetected: () =>
      this.log('info', 'codex-query', '✅ Task complete (detected completion signal)'),

    continuePrompting: (reason: string) =>
      this.log('warn', 'codex-query', `No tools used but not done - ${reason}`),

    continuing: () =>
      this.log('info', 'codex-query', '⏭️  Continuing to next turn (had tool calls)'),

    loopExited: (turnCount: number, maxTurns: number) =>
      this.log('info', 'codex-query', `EXITED WHILE LOOP after ${turnCount} turns`, {
        turnCount,
        maxTurns,
      }),

    sessionComplete: (turnCount: number) =>
      this.log('info', 'codex-query', `Session complete after ${turnCount} turns`, { turnCount }),

    error: (message: string, error: unknown) =>
      this.log('error', 'codex-query', message, {
        error: error instanceof Error ? error.message : String(error)
      }),
  };

  /**
   * Claude query-specific logging methods
   */
  claudeQuery = {
    queryStarted: (model: string, cwd: string, maxTurns: number) =>
      this.log('info', 'claude-query', `Starting Claude query (${model})`, {
        cwd,
        maxTurns,
      }),

    error: (message: string, error: unknown) =>
      this.log('error', 'claude-query', message, {
        error: error instanceof Error ? error.message : String(error)
      }),
  };

  /**
   * Runner-specific logging methods
   */
  runner = {
    workspaceRoot: (path: string) =>
      this.log('info', 'runner', `Workspace root: ${path}`, { path }),

    commandReceived: (commandType: string, projectId: string) =>
      this.log('info', 'runner', `Received command: ${commandType}`, { commandType, projectId }),

    buildOperation: (operationType: string, projectSlug: string, agentId: string) =>
      this.log('info', 'runner', `Build operation: ${operationType}`, {
        operationType,
        projectSlug,
        agentId,
      }),

    templateProvided: (templateId: string) =>
      this.log('info', 'runner', `Template provided by frontend: ${templateId}`, { templateId }),

    buildStreamCreated: () =>
      this.log('info', 'runner', 'Build stream created, starting to process chunks...'),

    firstChunkReceived: (agentLabel: string) =>
      this.log('info', 'runner', `First chunk received from ${agentLabel}`, { agentLabel }),

    streamEnded: (chunkCount: number) =>
      this.log('info', 'runner', `Stream ended after ${chunkCount} chunks`, { chunkCount }),

    buildCompleted: (projectId: string) =>
      this.log('info', 'runner', `Build completed successfully`, { projectId }),

    buildFailed: (error: string) =>
      this.log('error', 'runner', `Build failed: ${error}`, { error }),

    portDetected: (port: number) =>
      this.log('info', 'runner', `Port detected: ${port}`, { port }),

    tunnelCreated: (port: number, tunnelUrl: string) =>
      this.log('info', 'runner', `Tunnel created: ${tunnelUrl} → localhost:${port}`, {
        port,
        tunnelUrl
      }),

    error: (message: string, error: unknown, context?: Record<string, unknown>) =>
      this.log('error', 'runner', message, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      }),
  };

  /**
   * Build stream-specific logging (tool calls, text, etc.)
   */
  build = {
    agentText: (agentLabel: string, text: string) => {
      const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
      this.log('debug', 'build', `${agentLabel}: ${truncated}`, {
        agentLabel,
        textLength: text.length
      });
    },

    agentThinking: (thinking: string) => {
      const truncated = thinking.length > 300 ? thinking.slice(0, 300) + '...' : thinking;
      this.log('debug', 'build', `Thinking: ${truncated}`, {
        thinkingLength: thinking.length
      });
    },

    toolCalled: (toolName: string, toolId: string, inputSize: number) =>
      this.log('info', 'build', `Tool called: ${toolName} (${toolId})`, {
        toolName,
        toolId,
        inputSize
      }),

    toolResult: (toolId: string, outputSize: number, isError: boolean) =>
      this.log(isError ? 'error' : 'info', 'build', `Tool result (${toolId})`, {
        toolId,
        outputSize,
        isError
      }),

    runCommandDetected: (runCommand: string) =>
      this.log('info', 'build', `Detected runCommand: ${runCommand}`, { runCommand }),
  };

  /**
   * WebSocket-specific logging methods
   */
  websocket = {
    serverCreated: (instanceId: string) =>
      this.log('info', 'websocket', `WebSocket server instance created`, { instanceId }),

    serverInitialized: (path: string, runnerPath: string) =>
      this.log('info', 'websocket', `Server initialized`, { path, runnerPath }),

    clientConnected: (clientId: string, projectId?: string, sessionId?: string) =>
      this.log('info', 'websocket', `Client connected: ${clientId}`, { clientId, projectId, sessionId }),

    clientDisconnected: (clientId: string) =>
      this.log('info', 'websocket', `Client disconnected: ${clientId}`, { clientId }),

    clientSubscribed: (clientId: string, projectId: string) =>
      this.log('info', 'websocket', `Client subscribed to project: ${projectId}`, { clientId, projectId }),

    clientTimeout: (clientId: string) =>
      this.log('warn', 'websocket', `Client timeout: ${clientId}`, { clientId }),

    runnerConnected: (runnerId: string) =>
      this.log('info', 'websocket', `Runner connected: ${runnerId}`, { runnerId }),

    runnerDisconnected: (runnerId: string, code: number) =>
      this.log('info', 'websocket', `Runner disconnected: ${runnerId}`, { runnerId, code }),

    runnerNotConnected: (runnerId: string, commandType: string) =>
      this.log('warn', 'websocket', `Cannot send command to runner ${runnerId}: not connected`, { 
        runnerId, 
        commandType 
      }),

    runnerAuthRejected: () =>
      this.log('warn', 'websocket', `Runner connection rejected: invalid auth`),

    runnerAuthMissing: () =>
      this.log('error', 'websocket', `RUNNER_SHARED_SECRET is not configured`),

    runnerStaleRemoved: (runnerId: string) =>
      this.log('info', 'websocket', `Removing stale runner connection: ${runnerId}`, { runnerId }),

    commandSent: (runnerId: string, commandType: string, traceAttached: boolean) =>
      this.log('debug', 'websocket', `Sent command to runner: ${commandType}`, { 
        runnerId, 
        commandType, 
        traceAttached 
      }),

    eventReceived: (runnerId: string, eventType: string) =>
      this.log('debug', 'websocket', `Received event from runner: ${eventType}`, { 
        runnerId, 
        eventType 
      }),

    broadcastToolCall: (toolName: string, toolState: string, subscriberCount: number) =>
      this.log('info', 'websocket', `Broadcasting planning tool: ${toolName} (state=${toolState})`, { 
        toolName, 
        toolState, 
        subscriberCount 
      }),

    broadcastBuildComplete: (projectId: string, sessionId: string, subscriberCount: number) =>
      this.log('info', 'websocket', `Broadcasting build-complete`, { 
        projectId, 
        sessionId, 
        subscriberCount 
      }),

    unknownUpgradePath: (pathname: string) =>
      this.log('warn', 'websocket', `Unknown upgrade path: ${pathname}`, { pathname }),

    shutdown: () =>
      this.log('info', 'websocket', `Shutting down server...`),

    shutdownComplete: () =>
      this.log('info', 'websocket', `Server shut down`),

    error: (message: string, error: unknown, context?: Record<string, unknown>) =>
      this.log('error', 'websocket', message, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      }),
  };

  /**
   * Port allocator-specific logging methods
   */
  portAllocator = {
    portAllocated: (port: number, projectId: string) =>
      this.log('info', 'port-allocator', `Port allocated: ${port}`, { port, projectId }),

    portReleased: (port: number, projectId: string) =>
      this.log('info', 'port-allocator', `Port released: ${port}`, { port, projectId }),

    portInUse: (port: number) =>
      this.log('warn', 'port-allocator', `Port ${port} is already in use`, { port }),

    portRangeExhausted: (minPort: number, maxPort: number) =>
      this.log('error', 'port-allocator', `No available ports in range ${minPort}-${maxPort}`, { 
        minPort, 
        maxPort 
      }),

    portConflict: (port: number, projectId: string, existingProjectId: string) =>
      this.log('warn', 'port-allocator', `Port ${port} conflict detected`, { 
        port, 
        projectId, 
        existingProjectId 
      }),

    allocationsCleared: (count: number) =>
      this.log('info', 'port-allocator', `Cleared ${count} port allocations`, { count }),

    error: (message: string, error: unknown, context?: Record<string, unknown>) =>
      this.log('error', 'port-allocator', message, {
        error: error instanceof Error ? error.message : String(error),
        ...context,
      }),
  };

  /**
   * Process manager-specific logging methods
   */
  processManager = {
    processStarting: (projectId: string, command: string, cwd: string) =>
      this.log('info', 'process-manager', `Starting process: ${command}`, { 
        projectId, 
        command, 
        cwd 
      }),

    processStarted: (projectId: string, pid: number) =>
      this.log('info', 'process-manager', `Process started`, { projectId, pid }),

    processOutput: (projectId: string, output: string) =>
      this.log('debug', 'process-manager', `Process output: ${output.substring(0, 100)}`, { 
        projectId, 
        outputLength: output.length 
      }),

    processError: (projectId: string, error: string) =>
      this.log('error', 'process-manager', `Process error: ${error}`, { projectId, error }),

    processExited: (projectId: string, code: number | null, signal: string | null) =>
      this.log('info', 'process-manager', `Process exited`, { projectId, code, signal }),

    processStopped: (projectId: string) =>
      this.log('info', 'process-manager', `Process stopped`, { projectId }),

    processNotFound: (projectId: string) =>
      this.log('warn', 'process-manager', `Process not found for project: ${projectId}`, { projectId }),

    processKilled: (projectId: string, signal: string) =>
      this.log('info', 'process-manager', `Process killed with signal: ${signal}`, { 
        projectId, 
        signal 
      }),

    processCleanup: (projectId: string) =>
      this.log('info', 'process-manager', `Cleaning up process`, { projectId }),

    processListRetrieved: (count: number) =>
      this.log('debug', 'process-manager', `Retrieved ${count} running processes`, { count }),

    error: (message: string, error: unknown, context?: Record<string, unknown>) =>
      this.log('error', 'process-manager', message, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      }),
  };

  /**
   * Build events-specific logging methods
   */
  buildEvents = {
    eventReceived: (eventType: string, projectId: string, sessionId?: string) =>
      this.log('info', 'build-events', `Received event: ${eventType}`, { 
        eventType, 
        projectId, 
        sessionId 
      }),

    eventProcessed: (eventType: string, projectId: string) =>
      this.log('debug', 'build-events', `Processed event: ${eventType}`, { eventType, projectId }),

    buildStarted: (projectId: string, sessionId: string) =>
      this.log('info', 'build-events', `Build started`, { projectId, sessionId }),

    buildCompleted: (projectId: string, sessionId: string, success: boolean) =>
      this.log('info', 'build-events', `Build ${success ? 'completed' : 'failed'}`, { 
        projectId, 
        sessionId, 
        success 
      }),

    portDetected: (projectId: string, port: number) =>
      this.log('info', 'build-events', `Port detected: ${port}`, { projectId, port }),

    devServerStarted: (projectId: string, port: number, url: string) =>
      this.log('info', 'build-events', `Dev server started: ${url}`, { projectId, port, url }),

    devServerError: (projectId: string, error: string) =>
      this.log('error', 'build-events', `Dev server error: ${error}`, { projectId, error }),

    toolCallReceived: (toolName: string, toolId: string) =>
      this.log('debug', 'build-events', `Tool call: ${toolName}`, { toolName, toolId }),

    logChunkReceived: (projectId: string, chunkSize: number) =>
      this.log('debug', 'build-events', `Log chunk received`, { projectId, chunkSize }),

    invalidEvent: (reason: string) =>
      this.log('warn', 'build-events', `Invalid event: ${reason}`, { reason }),

    error: (message: string, error: unknown, context?: Record<string, unknown>) =>
      this.log('error', 'build-events', message, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      }),
  };
}

// Singleton instance
export const buildLogger = new BuildLogger();
