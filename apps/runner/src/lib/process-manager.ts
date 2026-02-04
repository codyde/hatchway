import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { buildLogger } from '@hatchway/agent-core/lib/logging/build-logger';
import { join } from 'node:path';

// Silent mode for TUI
let isSilentMode = false;

export function setSilentMode(silent: boolean): void {
  isSilentMode = silent;
}

/**
 * Process lifecycle states
 */
export enum ProcessState {
  IDLE = 'idle',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  FAILED = 'failed'
}

/**
 * Failure reason classification
 */
export enum FailureReason {
  PORT_IN_USE = 'port_in_use',
  COMMAND_NOT_FOUND = 'command_not_found',
  DIRECTORY_MISSING = 'directory_missing',
  PERMISSION_DENIED = 'permission_denied',
  IMMEDIATE_CRASH = 'immediate_crash',
  HEALTH_CHECK_TIMEOUT = 'health_check_timeout',
  HEALTH_CHECK_FAILED = 'health_check_failed',
  UNKNOWN = 'unknown'
}

/**
 * Get API configuration (evaluated at runtime, not module load time)
 */
function getAPIConfig() {
  return {
    apiBase: process.env.API_BASE_URL || 'http://localhost:3000',
    secret: process.env.RUNNER_SHARED_SECRET,
  };
}

/**
 * Make authenticated API call to frontend
 */
async function callAPI(endpoint: string, options: RequestInit = {}) {
  const { apiBase, secret } = getAPIConfig();

  try {
    const response = await fetch(`${apiBase}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API call failed (${response.status}): ${error}`);
    }

    return await response.json();
  } catch (error) {
    buildLogger.log('error', 'process-manager', `API call to ${endpoint} failed`, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

interface DevServerOptions {
  projectId: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  port?: number;
}

interface DevServerProcess {
  projectId: string;
  process: ChildProcess;
  emitter: EventEmitter;
  port?: number;
  tunnelUrl?: string;
  state: ProcessState;
  command: string;
  cwd: string;
  startedAt: Date;
  lastHealthCheck?: Date;
  stopReason?: string;
  failureReason?: FailureReason;
  earlyStderr?: string; // Capture stderr from first 5 seconds for debugging
  hasExited?: boolean; // Track if process has exited
}

const activeProcesses = new Map<string, DevServerProcess>();

/**
 * Check if a port is in use (listening)
 * Tries both localhost and 0.0.0.0 to catch servers bound to either interface
 */
export async function checkPortInUse(port: number): Promise<boolean> {
  // Try localhost first (most common for dev servers)
  const localhostInUse = await checkSingleAddress(port, 'localhost');
  if (localhostInUse) {
    return true;
  }
  
  // Then try 0.0.0.0
  return checkSingleAddress(port, '0.0.0.0');
}

/**
 * Find an available port starting from a given port
 * Scans up to maxAttempts ports from the starting port
 * 
 * @param startPort - The port to start scanning from
 * @param maxAttempts - Maximum number of ports to try (default: 100)
 * @returns The first available port found, or null if none found
 */
export async function findAvailablePort(startPort: number, maxAttempts = 100): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const inUse = await checkPortInUse(port);
    if (!inUse) {
      buildLogger.log('info', 'process-manager', `Found available port ${port}`, { port, startPort, attempts: i + 1 });
      return port;
    }
  }
  buildLogger.log('error', 'process-manager', `No available port found after ${maxAttempts} attempts starting from ${startPort}`, { startPort, maxAttempts });
  return null;
}

/**
 * Check if a port is in use on a specific address
 */
function checkSingleAddress(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        buildLogger.log('debug', 'process-manager', `Port ${port} is IN USE on ${host}`, { port, host });
        resolve(true); // Port is in use
      } else {
        buildLogger.log('debug', 'process-manager', `Port ${port} check error on ${host}: ${err.code}`, { port, host, code: err.code });
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      buildLogger.log('debug', 'process-manager', `Port ${port} is FREE on ${host}`, { port, host });
      server.close();
      resolve(false); // Port is free
    });
    
    server.listen(port, host);
  });
}

/**
 * Verify server health after start
 * @param port - Port to check
 * @param projectId - Project ID to check process status
 * @param maxAttempts - Maximum number of health check attempts (default: 10)
 * @returns Health check result
 */
async function verifyServerHealth(
  port: number,
  projectId?: string,
  maxAttempts = 10
): Promise<{
  healthy: boolean;
  error?: string;
}> {
  if (!isSilentMode) {
    buildLogger.log('debug', 'process-manager', `Starting health check for port ${port}`, { port });
  }

  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Check if process has exited during health check
      if (projectId) {
        const devProcess = activeProcesses.get(projectId);
        if (devProcess?.hasExited) {
          let errorMsg = `Process exited during health check (after ${i}s)`;
          if (devProcess.earlyStderr) {
            errorMsg += `\n\nProcess stderr:\n${devProcess.earlyStderr}`;
          }
          return {
            healthy: false,
            error: errorMsg,
          };
        }
      }

      // Check if port is listening
      const isListening = await checkPortInUse(port);

      if (!isListening) {
        // Port is still free, server hasn't started yet
        if (!isSilentMode && i % 5 === 0) {
          buildLogger.log('debug', 'process-manager', `Waiting for port ${port} to be listening... (${i}s)`, { port, seconds: i });
        }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      // Port is listening! For dev servers, this is good enough.
      // Many frameworks (Astro, Vite, Next) listen on the port but continue
      // building/bundling before serving HTTP requests.
      // Waiting for HTTP responses can cause false timeouts.

      if (!isSilentMode) {
        buildLogger.log('info', 'process-manager', `Health check passed - port ${port} is listening (after ${i}s)`, { port, seconds: i });
      }
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        error: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Health check timed out - include stderr if available
  let errorMsg = `Server failed to start listening on port ${port} within ${maxAttempts} seconds`;
  if (projectId) {
    const devProcess = activeProcesses.get(projectId);
    if (devProcess?.earlyStderr) {
      errorMsg += `\n\nProcess stderr:\n${devProcess.earlyStderr}`;
    }
  }

  return {
    healthy: false,
    error: errorMsg,
  };
}

/**
 * Classify startup error to provide better error messages
 */
function classifyStartupError(error: unknown, processInfo: Partial<DevServerProcess>): {
  reason: FailureReason;
  message: string;
  suggestion: string;
} {
  const errorStr = String(error);
  
  if (errorStr.includes('EADDRINUSE')) {
    return {
      reason: FailureReason.PORT_IN_USE,
      message: `Port ${processInfo.port} is already in use`,
      suggestion: 'Another process is using this port. Stop it or the system will reallocate.'
    };
  }
  
  if (errorStr.includes('ENOENT') || errorStr.includes('command not found')) {
    return {
      reason: FailureReason.COMMAND_NOT_FOUND,
      message: `Command not found: ${processInfo.command}`,
      suggestion: 'Check that dependencies are installed (npm install, pnpm install, etc.)'
    };
  }
  
  if (errorStr.includes('EACCES') || errorStr.includes('permission denied')) {
    return {
      reason: FailureReason.PERMISSION_DENIED,
      message: 'Permission denied',
      suggestion: 'Check file permissions and ownership'
    };
  }
  
  if (processInfo.cwd && !existsSync(processInfo.cwd)) {
    return {
      reason: FailureReason.DIRECTORY_MISSING,
      message: `Working directory does not exist: ${processInfo.cwd}`,
      suggestion: 'Project may have been deleted or moved'
    };
  }
  
  // If process exited within 3 seconds of starting
  if (processInfo.startedAt && Date.now() - processInfo.startedAt.getTime() < 3000) {
    return {
      reason: FailureReason.IMMEDIATE_CRASH,
      message: 'Process crashed immediately after starting',
      suggestion: 'Check logs for syntax errors or missing dependencies'
    };
  }
  
  return {
    reason: FailureReason.UNKNOWN,
    message: errorStr,
    suggestion: 'Check the logs for more details'
  };
}

/**
 * Start a development server for a project with pre-flight port check
 * 
 * This is the preferred way to start a dev server as it verifies the port
 * is actually available before spawning the process.
 * 
 * @param options - DevServerOptions including port
 * @param maxPortWaitMs - Maximum time to wait for port to become available (default: 5000)
 * @returns Promise<DevServerProcess> - The dev server process
 * @throws Error if port is not available after waiting
 */
export async function startDevServerAsync(
  options: DevServerOptions,
  maxPortWaitMs = 5000
): Promise<DevServerProcess> {
  const { projectId, port } = options;

  // Pre-flight check: verify port is available before spawning
  if (port) {
    const portInUse = await checkPortInUse(port);
    if (portInUse) {
      buildLogger.log('warn', 'process-manager', `Port ${port} is in use, waiting for release...`, { port, projectId });
      
      // Wait for port to become available
      const portReleased = await waitForPortRelease(port, maxPortWaitMs);
      if (!portReleased) {
        const error = new Error(`Port ${port} is still in use after ${maxPortWaitMs}ms. Please stop the process using this port.`);
        buildLogger.log('error', 'process-manager', error.message, { port, projectId });
        throw error;
      }
    }
    
    buildLogger.log('info', 'process-manager', `Port ${port} is available, starting dev server`, { port, projectId });
  }

  // Port is available, start the server
  return startDevServer(options);
}

/**
 * Start a development server for a project (synchronous version)
 * 
 * Note: Prefer startDevServerAsync() which includes port availability checks.
 * This synchronous version is kept for compatibility but does not verify port availability.
 * The caller is responsible for stopping any existing process before calling this function.
 */
export function startDevServer(options: DevServerOptions): DevServerProcess {
  const { projectId, command, cwd, env } = options;

  buildLogger.processManager.processStarting(projectId, command, cwd);

  const emitter = new EventEmitter();

  // Verify CWD exists
  if (!existsSync(cwd)) {
    const error = new Error(`Working directory does not exist: ${cwd}`);
    buildLogger.processManager.error('Failed to spawn process', error, { projectId });
    emitter.emit('error', error);
    // Return a dummy process since we can't spawn
    return {
      projectId,
      process: null as any,
      emitter,
      port: options.port,
      state: ProcessState.FAILED,
      command,
      cwd,
      startedAt: new Date(),
      failureReason: FailureReason.DIRECTORY_MISSING,
    };
  }

  // Use shell to execute the full command (handles complex args better)
  const childProcess = spawn(command, [], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'pipe',
    shell: '/bin/bash', // Explicitly use bash instead of default shell
  });

  if (childProcess.pid) {
    buildLogger.processManager.processStarted(projectId, childProcess.pid);
  }

  const devProcess: DevServerProcess = {
    projectId,
    process: childProcess,
    emitter,
    port: options.port,
    state: ProcessState.STARTING,
    command,
    cwd,
    startedAt: new Date(),
  };

  activeProcesses.set(projectId, devProcess);

  // Register process with API
  if (childProcess.pid) {
    const runnerId = process.env.RUNNER_ID || 'unknown';
    callAPI('/api/runner/process/register', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        pid: childProcess.pid,
        command,
        runnerId,
        startedAt: new Date().toISOString(),
      }),
    })
      .then(() => {
        buildLogger.log('info', 'process-manager', `Registered process via API: PID ${childProcess.pid}, Runner ${runnerId}`, { pid: childProcess.pid, runnerId, projectId });
      })
      .catch((err: unknown) => {
        buildLogger.log('error', 'process-manager', 'Failed to register process via API', { error: err instanceof Error ? err.message : String(err), projectId });
      });
  }

  // Capture early stderr for debugging (first 5 seconds)
  const stderrBuffer: string[] = [];
  const captureWindow = 5000; // 5 seconds

  // Handle stdout - just forward logs (port is pre-allocated by API)
  childProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    emitter.emit('log', { type: 'stdout', data: text });
  });

  // Handle stderr - capture early output for debugging
  childProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();

    // Capture stderr from first 5 seconds for debugging startup failures
    if (Date.now() - devProcess.startedAt.getTime() < captureWindow) {
      stderrBuffer.push(text);
      devProcess.earlyStderr = stderrBuffer.join('');
    }

    emitter.emit('log', { type: 'stderr', data: text });
  });

  // Handle exit
  childProcess.on('exit', (code, signal) => {
    // Mark as exited
    devProcess.hasExited = true;

    // Update state based on exit
    if (code === 0 || devProcess.state === ProcessState.STOPPING) {
      devProcess.state = ProcessState.STOPPED;
    } else {
      devProcess.state = ProcessState.FAILED;

      // Classify the failure
      const classification = classifyStartupError(
        new Error(`Process exited with code ${code}, signal ${signal}`),
        devProcess
      );
      devProcess.failureReason = classification.reason;

      if (!isSilentMode) {
        buildLogger.log('error', 'process-manager', classification.message, { 
          reason: classification.reason,
          suggestion: classification.suggestion,
          projectId 
        });

        // Log captured stderr if available and process failed quickly
        if (devProcess.earlyStderr && Date.now() - devProcess.startedAt.getTime() < 10000) {
          buildLogger.log('error', 'process-manager', 'Process stderr output', { 
            stderr: devProcess.earlyStderr,
            projectId 
          });
        }
      }
    }

    emitter.emit('exit', { 
      code, 
      signal, 
      state: devProcess.state,
      failureReason: devProcess.failureReason,
      stderr: devProcess.earlyStderr || undefined,
    });
    activeProcesses.delete(projectId);

    // Unregister process via API
    callAPI(`/api/runner/process/${projectId}`, {
      method: 'DELETE',
    })
      .then(() => {
        buildLogger.log('info', 'process-manager', 'Unregistered process via API', { projectId });
      })
      .catch((err: unknown) => {
        buildLogger.log('error', 'process-manager', 'Failed to unregister process via API', { error: err instanceof Error ? err.message : String(err), projectId });
      });
  });

  // Handle errors
  childProcess.on('error', (error) => {
    devProcess.state = ProcessState.FAILED;
    
    // Classify the error
    const classification = classifyStartupError(error, devProcess);
    devProcess.failureReason = classification.reason;
    
    buildLogger.log('error', 'process-manager', `Process error: ${classification.message}`, { 
      reason: classification.reason,
      suggestion: classification.suggestion,
      projectId 
    });
    
    emitter.emit('error', error);
  });

  return devProcess;
}

/**
 * Stop a development server for a project with graceful shutdown
 * @param projectId - The project ID to stop
 * @param options - Shutdown options
 * @returns Promise<boolean> - true if stopped, false if no process found
 */
export async function stopDevServer(
  projectId: string,
  options?: {
    timeout?: number;
    reason?: string;
    tunnelManager?: any; // TunnelManager instance
    port?: number;
    forceKillPort?: boolean; // If true, kill any process on the port
  }
): Promise<boolean> {
  const { timeout = 10000, reason = 'manual', tunnelManager, port, forceKillPort = false } = options || {};
  
  const devProcess = activeProcesses.get(projectId);
  if (!devProcess) {
    // Even if no process is tracked, we might need to kill port
    if (forceKillPort && port) {
      const { killProcessOnPort } = await import('../cli/utils/process-killer.js');
      buildLogger.log('info', 'process-manager', `Force killing process on port ${port}`, { port, projectId });
      await killProcessOnPort(port);
    }
    return false;
  }

  if (!isSilentMode) {
    buildLogger.log('info', 'process-manager', `Stopping dev server for ${projectId} (reason: ${reason})`, { projectId, reason });
  }

  // Update state to STOPPING
  devProcess.state = ProcessState.STOPPING;
  devProcess.stopReason = reason;

  // Step 1: Close tunnel first (if tunnelManager and port provided)
  const tunnelPort = port || devProcess.port;
  if (tunnelManager && tunnelPort) {
    try {
      buildLogger.log('info', 'process-manager', `Closing tunnel for port ${tunnelPort}`, { port: tunnelPort, projectId });
      await tunnelManager.closeTunnel(tunnelPort);
      devProcess.tunnelUrl = undefined;
    } catch (error) {
      buildLogger.log('error', 'process-manager', 'Failed to close tunnel', { error: error instanceof Error ? error.message : String(error), projectId });
      // Continue anyway - we still need to stop the process
    }
  }

  // Step 2: Send SIGTERM for graceful shutdown
  buildLogger.log('info', 'process-manager', `Sending SIGTERM to PID ${devProcess.process.pid}`, { pid: devProcess.process.pid, projectId });
  devProcess.process.kill('SIGTERM');

  // Step 3: Wait for exit with timeout
  const exitPromise = new Promise<void>((resolve) => {
    devProcess.emitter.once('exit', () => resolve());
  });

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => resolve(), timeout);
  });

  await Promise.race([exitPromise, timeoutPromise]);

  // Step 4: Force kill if still running
  if (devProcess.process.exitCode === null && !devProcess.process.killed) {
    buildLogger.log('warn', 'process-manager', `Process ${projectId} didn't exit gracefully, sending SIGKILL`, { projectId });
    devProcess.process.kill('SIGKILL');
    // Wait a bit for SIGKILL to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Step 5: Force kill port if requested (handles stuck processes)
  if (forceKillPort && tunnelPort) {
    const { killProcessOnPort } = await import('../cli/utils/process-killer.js');
    buildLogger.log('info', 'process-manager', `Force killing any remaining process on port ${tunnelPort}`, { port: tunnelPort, projectId });
    await killProcessOnPort(tunnelPort);
    // Wait for port to be released
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Step 6: Cleanup
  activeProcesses.delete(projectId);
  
  buildLogger.processManager.processStopped(projectId);
  
  return true;
}

/**
 * Wait for a port to become available by polling
 * @param port - Port to wait for
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 10000)
 * @param pollIntervalMs - How often to check in milliseconds (default: 500)
 * @returns Promise<boolean> - true if port became available, false if timeout
 */
export async function waitForPortRelease(
  port: number,
  maxWaitMs = 10000,
  pollIntervalMs = 500
): Promise<boolean> {
  const start = Date.now();
  
  buildLogger.log('info', 'process-manager', `Waiting for port ${port} to be released...`, { port, maxWaitMs });
  
  while (Date.now() - start < maxWaitMs) {
    const inUse = await checkPortInUse(port);
    if (!inUse) {
      const elapsed = Date.now() - start;
      buildLogger.log('info', 'process-manager', `Port ${port} released after ${elapsed}ms`, { port, elapsed });
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  buildLogger.log('warn', 'process-manager', `Timeout waiting for port ${port} to be released`, { port, maxWaitMs });
  return false;
}

/**
 * Attempt to fix port configuration in package.json
 * Looks for --port flags in dev/start scripts and replaces with correct port
 * @param cwd - Working directory where package.json is located
 * @param targetPort - The port we want to use
 * @returns true if package.json was modified, false otherwise
 */
function fixPackageJsonPort(cwd: string, targetPort: number): boolean {
  const packageJsonPath = join(cwd, 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    buildLogger.log('debug', 'process-manager', 'No package.json found to fix', { cwd });
    return false;
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    
    if (!packageJson.scripts) {
      buildLogger.log('debug', 'process-manager', 'No scripts section in package.json', { cwd });
      return false;
    }

    let modified = false;
    const scripts = packageJson.scripts;

    // Common script names that might have port configurations
    const scriptNames = ['dev', 'start', 'serve', 'preview'];
    
    for (const scriptName of scriptNames) {
      if (scripts[scriptName]) {
        const originalScript = scripts[scriptName];
        let newScript = originalScript;

        // Pattern 1: --port 3000 or --port=3000
        const portFlagPattern = /--port[=\s]+\d+/g;
        if (portFlagPattern.test(originalScript)) {
          newScript = originalScript.replace(portFlagPattern, `--port ${targetPort}`);
          modified = true;
          buildLogger.log('info', 'process-manager', 
            `Fixed --port flag in ${scriptName} script`, 
            { scriptName, oldScript: originalScript, newScript }
          );
        }

        // Pattern 2: -p 3000 or -p=3000 (short form, common in some frameworks)
        const shortPortPattern = /-p[=\s]+\d+/g;
        if (shortPortPattern.test(originalScript)) {
          newScript = newScript.replace(shortPortPattern, `-p ${targetPort}`);
          modified = true;
          buildLogger.log('info', 'process-manager', 
            `Fixed -p flag in ${scriptName} script`, 
            { scriptName, oldScript: originalScript, newScript }
          );
        }

        // Pattern 3: PORT=3000 (environment variable inline)
        const envPortPattern = /PORT=\d+/g;
        if (envPortPattern.test(originalScript)) {
          newScript = newScript.replace(envPortPattern, `PORT=${targetPort}`);
          modified = true;
          buildLogger.log('info', 'process-manager', 
            `Fixed PORT env var in ${scriptName} script`, 
            { scriptName, oldScript: originalScript, newScript }
          );
        }

        scripts[scriptName] = newScript;
      }
    }

    if (modified) {
      // Write back with pretty formatting
      const updatedContent = JSON.stringify(packageJson, null, 2) + '\n';
      writeFileSync(packageJsonPath, updatedContent, 'utf-8');
      buildLogger.log('info', 'process-manager', 
        'Successfully updated package.json with correct port', 
        { cwd, targetPort }
      );
      return true;
    }

    return false;
  } catch (error) {
    buildLogger.log('error', 'process-manager', 
      'Failed to fix package.json port', 
      { error: error instanceof Error ? error.message : String(error), cwd }
    );
    return false;
  }
}

/**
 * Run health check on a dev server and update state
 * @param projectId - Project ID to health check
 * @param port - Port to check
 * @returns Health check result including whether port was fixed
 */
export async function runHealthCheck(projectId: string, port: number): Promise<{
  healthy: boolean;
  error?: string;
  portFixed?: boolean;
}> {
  const devProcess = activeProcesses.get(projectId);
  if (!devProcess) {
    return { healthy: false, error: 'Process not found', portFixed: false };
  }

  const result = await verifyServerHealth(port, projectId);

  if (result.healthy) {
    devProcess.state = ProcessState.RUNNING;
    devProcess.lastHealthCheck = new Date();
    return { healthy: true, portFixed: false };
  } else {
    // Health check failed - try to fix package.json port configuration
    buildLogger.log('error', 'process-manager', 
      `Health check failed after maximum retries`, 
      { projectId, port, error: result.error }
    );
    
    // Attempt to fix port in package.json
    buildLogger.log('info', 'process-manager', 
      `Attempting to fix port configuration in package.json`, 
      { projectId, port, cwd: devProcess.cwd }
    );
    
    const portFixed = fixPackageJsonPort(devProcess.cwd, port);
    
    if (portFixed) {
      buildLogger.log('info', 'process-manager', 
        `Port configuration fixed in package.json, preparing to retry`, 
        { projectId, port }
      );
    } else {
      buildLogger.log('warn', 'process-manager', 
        `Could not automatically fix port configuration`, 
        { projectId, port }
      );
    }
    
    // Mark as failed and kill the process
    devProcess.state = ProcessState.FAILED;
    devProcess.failureReason = FailureReason.HEALTH_CHECK_FAILED;
    
    // Kill the process since it's not responding properly
    if (devProcess.process && !devProcess.hasExited) {
      buildLogger.log('info', 'process-manager', 
        `Killing failed process`, 
        { projectId }
      );
      devProcess.process.kill('SIGTERM');
      
      // Give it 2 seconds to die gracefully, then SIGKILL
      setTimeout(() => {
        if (devProcess.process && !devProcess.hasExited) {
          buildLogger.log('warn', 'process-manager', 
            `Process didn't exit after health check failure, sending SIGKILL`, 
            { projectId }
          );
          devProcess.process.kill('SIGKILL');
        }
      }, 2000);
    }

    return { 
      healthy: false, 
      error: result.error,
      portFixed 
    };
  }
}

/**
 * Get active process for a project
 */
export function getDevServer(projectId: string): DevServerProcess | undefined {
  return activeProcesses.get(projectId);
}

/**
 * Get all active project IDs
 */
export function getAllActiveProjectIds(): string[] {
  return Array.from(activeProcesses.keys());
}

/**
 * Stop all running dev servers
 */
export async function stopAllDevServers(tunnelManager?: any): Promise<void> {
  const projectIds = getAllActiveProjectIds();
  
  // Stop all processes in parallel
  await Promise.allSettled(
    projectIds.map(projectId => 
      stopDevServer(projectId, { 
        tunnelManager,
        reason: 'shutdown' 
      })
    )
  );
}

/**
 * Get process state for debugging/monitoring
 */
export function getProcessState(projectId: string): ProcessState | undefined {
  return activeProcesses.get(projectId)?.state;
}
