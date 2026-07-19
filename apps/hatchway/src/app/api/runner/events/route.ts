import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type { RunnerEvent, StartBuildCommand, AutoFixStartedEvent } from '@/shared/runner/messages';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects, generationSessions, serverOperations } from '@hatchway/agent-core/lib/db/schema';
import { eq, desc, and, inArray, or, isNull } from 'drizzle-orm';
import { publishRunnerEvent } from '@hatchway/agent-core/lib/runner/event-stream';
import { buildWebSocketServer } from '@hatchway/agent-core/lib/websocket/server';
import { appendRunnerLog, markRunnerLogExit } from '@hatchway/agent-core/lib/runner/log-store';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { getProjectRunnerId } from '@/lib/runner-utils';
import { projectEvents } from '@/lib/project-events';
import { SANDBOX_DEV_PORT } from '@/lib/sandbox/inject-proxy-source';
import {
  releasePortForProject,
  reserveOrReallocatePort,
  buildEnvForFramework,
  getRunCommand,
} from '@hatchway/agent-core/lib/port-allocator';
import type { StartDevServerCommand } from '@/shared/runner/messages';
import { authenticateRunnerKey, extractRunnerKey, isLocalMode } from '@/lib/auth-helpers';

// Track auto-fix attempts per project to prevent infinite loops
const autoFixAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_AUTO_FIX_ATTEMPTS = 3;
const AUTO_FIX_COOLDOWN_MS = 60000; // 1 minute cooldown between auto-fix attempts

// Track port conflict retry attempts per project
const portRetryAttempts = new Map<string, number>();
const MAX_PORT_RETRY_ATTEMPTS = 3;

async function ensureAuthorized(request: Request): Promise<{ userId?: string } | false> {
  // In local mode, always allow
  if (isLocalMode()) {
    return { userId: undefined };
  }
  
  const authHeader = request.headers.get('authorization');
  
  // First, check for user-scoped runner key (sv_xxx format)
  const runnerKey = extractRunnerKey(request);
  if (runnerKey) {
    const auth = await authenticateRunnerKey(runnerKey);
    if (auth) {
      return { userId: auth.userId };
    }
    return false;
  }
  
  // Fall back to shared secret (legacy/local mode)
  const expected = process.env.RUNNER_SHARED_SECRET;
  if (!expected) {
    console.warn('RUNNER_SHARED_SECRET is not configured and no runner key provided');
    return false;
  }

  if (!authHeader?.startsWith('Bearer ') || authHeader.slice('Bearer '.length).trim() !== expected) {
    return false;
  }
  
  return { userId: undefined };
}

/**
 * Verify that the authenticated user owns the project
 * In local mode or with shared secret (no userId), allows access to all projects
 * For user-scoped runner keys, verifies the project belongs to the user
 */
async function verifyProjectOwnership(projectId: string, userId: string | undefined): Promise<boolean> {
  // In local mode or with shared secret, no ownership check needed
  if (isLocalMode() || !userId) {
    return true;
  }

  // Fetch the project and check ownership
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, userId: true },
  });

  if (!project) {
    // Project doesn't exist - let the operation fail naturally
    return true;
  }

  // Allow if project has no owner (legacy) or user owns it
  if (!project.userId || project.userId === userId) {
    return true;
  }

  console.warn(`[events] Unauthorized: User ${userId} attempted to access project ${projectId} owned by ${project.userId}`);
  return false;
}

/**
 * Emit project update event to SSE streams
 * Provides instant updates without polling
 */
function emitProjectUpdateFromData(projectId: string, projectData: typeof projects.$inferSelect) {
  try {
    projectEvents.emitProjectUpdate(projectId, projectData);
  } catch (error) {
    console.error(`Failed to emit project update for ${projectId}:`, error);
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await ensureAuthorized(request);
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // authResult.userId contains the user ID if authenticated via runner key

    const event = (await request.json()) as RunnerEvent;

    if (!event.projectId) {
      return NextResponse.json({ ok: true });
    }

    // TypeScript narrowing: projectId is guaranteed to be defined after the guard above
    const projectId = event.projectId;

    // Verify the authenticated user owns this project
    const hasAccess = await verifyProjectOwnership(projectId, authResult.userId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden: You do not own this project' }, { status: 403 });
    }

    await (async () => {
        // Publish to WebSocket subscribers
        publishRunnerEvent(event);

        // Handle log events
        if (event.type === 'log-chunk' && typeof event.data === 'string') {
          appendRunnerLog(projectId, {
            type: event.stream === 'stderr' ? 'stderr' : 'stdout',
            data: event.data,
            timestamp: new Date(event.timestamp ?? Date.now()),
          });
        } else if (event.type === 'process-exited') {
          markRunnerLogExit(projectId, {
            code: event.exitCode,
            signal: event.signal ?? undefined,
          });
        }

        // Database operations - NOW INSIDE SPAN for proper tracing!
        switch (event.type) {
          // Port is now pre-allocated in the start route, no need for port-detected event
          case 'tunnel-created': {
            const [updated] = await db.update(projects)
              .set({
                tunnelUrl: event.tunnelUrl,
                lastActivityAt: new Date(),
              })
              .where(eq(projects.id, projectId))
              .returning();
            if (updated) emitProjectUpdateFromData(projectId, updated);
            break;
          }
          case 'tunnel-closed': {
            const [updated] = await db.update(projects)
              .set({
                tunnelUrl: null,
                lastActivityAt: new Date(),
              })
              .where(eq(projects.id, projectId))
              .returning();
            if (updated) emitProjectUpdateFromData(projectId, updated);
            break;
          }
          case 'port-conflict': {
            if (projectId) {
              const errorMessage = event.message || `Port ${event.port} is already in use on the runner host`;
              
              console.log(`[events] ⚠️ Port conflict detected for project ${projectId} on port ${event.port}`);

              // Release the conflicted port
              await releasePortForProject(projectId);

              // Check retry attempts
              const currentAttempts = portRetryAttempts.get(projectId) || 0;
              
              if (currentAttempts < MAX_PORT_RETRY_ATTEMPTS) {
                // Increment retry counter
                portRetryAttempts.set(projectId, currentAttempts + 1);
                
                console.log(`[events] 🔄 Auto-retrying with new port (attempt ${currentAttempts + 1}/${MAX_PORT_RETRY_ATTEMPTS})...`);

                // Get project details for retry
                const [project] = await db.select()
                  .from(projects)
                  .where(eq(projects.id, projectId))
                  .limit(1);

                if (project && project.path && project.runCommand) {
                  try {
                    // Allocate a new port (will skip the conflicted one)
                    const isRemoteRunner = project.runnerId !== 'local';
                    const portInfo = await reserveOrReallocatePort({
                      projectId: projectId,
                      projectType: project.projectType,
                      runCommand: project.runCommand,
                      preferredPort: null, // Don't use preferred port, get a new one
                      detectedFramework: project.detectedFramework,
                    }, isRemoteRunner);

                    console.log(`[events] 📍 Allocated new port ${portInfo.port} after conflict`);

                    // Update DB with new port and keep status as 'starting'
                    const [updated] = await db.update(projects)
                      .set({
                        devServerStatus: 'starting',
                        devServerPort: portInfo.port,
                        errorMessage: null,
                        lastActivityAt: new Date(),
                      })
                      .where(eq(projects.id, projectId))
                      .returning();

                    if (updated) {
                      emitProjectUpdateFromData(projectId, updated);
                    }

                    // Get runner for this project
                    const runnerId = await getProjectRunnerId(project.runnerId);

                    if (runnerId) {
                      // Build port environment variables
                      const portEnv = buildEnvForFramework(portInfo.framework, portInfo.port);
                      const runCommand = getRunCommand(project.runCommand);

                      // Send retry command to runner
                      const retryCommand: StartDevServerCommand = {
                        id: randomUUID(),
                        type: 'start-dev-server',
                        projectId: projectId,
                        timestamp: new Date().toISOString(),
                        payload: {
                          runCommand,
                          workingDirectory: project.path,
                          env: portEnv,
                          preferredPort: portInfo.port,
                        },
                      };

                      await sendCommandToRunner(runnerId, retryCommand);
                      console.log(`[events] ✅ Retry command sent for project ${projectId} on new port ${portInfo.port}`);
                    } else {
                      console.log(`[events] ⚠️ No runner available for port conflict retry`);
                      throw new Error('No runner available');
                    }
                  } catch (retryError) {
                    console.error(`[events] ❌ Port conflict retry failed:`, retryError);
                    // Fall through to failed state
                    const [updated] = await db.update(projects)
                      .set({
                        devServerStatus: 'failed',
                        devServerPort: null,
                        errorMessage: `${errorMessage}. Retry failed: ${retryError instanceof Error ? retryError.message : 'Unknown error'}`,
                        lastActivityAt: new Date(),
                      })
                      .where(eq(projects.id, projectId))
                      .returning();

                    if (updated) {
                      emitProjectUpdateFromData(projectId, updated);
                    }
                  }
                } else {
                  console.log(`[events] ⚠️ Project missing required data for port conflict retry`);
                  // Mark as failed
                  const [updated] = await db.update(projects)
                    .set({
                      devServerStatus: 'failed',
                      devServerPort: null,
                      errorMessage,
                      lastActivityAt: new Date(),
                    })
                    .where(eq(projects.id, projectId))
                    .returning();

                  if (updated) {
                    emitProjectUpdateFromData(projectId, updated);
                  }
                }
              } else {
                // Max retries exceeded
                console.log(`[events] ❌ Max port retry attempts (${MAX_PORT_RETRY_ATTEMPTS}) exceeded for project ${projectId}`);
                portRetryAttempts.delete(projectId); // Reset counter
                
                const [updated] = await db.update(projects)
                  .set({
                    devServerStatus: 'failed',
                    devServerPort: null,
                    errorMessage: `${errorMessage}. Failed after ${MAX_PORT_RETRY_ATTEMPTS} retry attempts.`,
                    lastActivityAt: new Date(),
                  })
                  .where(eq(projects.id, projectId))
                  .returning();

                if (updated) {
                  emitProjectUpdateFromData(projectId, updated);
                }
              }

            }
            break;
          }
          case 'port-reallocated': {
            // Runner found the pre-allocated port was in use and auto-selected a new port
            // Update the database with the new port
            if (projectId) {
              const reallocatedEvent = event as typeof event & { originalPort?: number; newPort?: number };
              console.log(`[events] 🔄 Port reallocated for project ${projectId}: ${reallocatedEvent.originalPort} → ${reallocatedEvent.newPort}`);
              
              if (reallocatedEvent.newPort) {
                // Update port in database
                const [updated] = await db.update(projects)
                  .set({
                    devServerPort: reallocatedEvent.newPort,
                    lastActivityAt: new Date(),
                  })
                  .where(eq(projects.id, projectId))
                  .returning();
                
                if (updated) {
                  console.log(`[events] ✅ Updated devServerPort to ${reallocatedEvent.newPort} for project ${projectId}`);
                  emitProjectUpdateFromData(projectId, updated);
                }
                
                // Reset port retry counter since we successfully got a new port
                portRetryAttempts.delete(projectId);
              }
            }
            break;
          }
          case 'ack': {
            // Check if this is a health check success (server is healthy or restarted)
            const message = (event as { message?: string }).message || '';
            if (message.includes('healthy') || message.includes('running') || message.includes('restarted successfully')) {
              // Reset port retry counter on successful start
              portRetryAttempts.delete(projectId);
              
              const now = new Date();
              const [updated] = await db.update(projects)
                .set({
                  devServerStatus: 'running',
                  devServerStatusUpdatedAt: now,
                  lastActivityAt: now,
                })
                .where(eq(projects.id, projectId!))
                .returning();
              if (updated) {
                console.log(`[events] ✅ Updated devServerStatus to 'running' for project ${projectId}`);
                emitProjectUpdateFromData(projectId!, updated);
              }
              
              // Update operation record if commandId matches an operation
              if (event.commandId) {
                await db.update(serverOperations)
                  .set({
                    status: 'completed',
                    ackAt: now,
                    completedAt: now,
                  })
                  .where(eq(serverOperations.id, event.commandId));
              }
            }
            break;
          }
          case 'process-exited': {
            // Exit code 143 = 128 + 15 = SIGTERM, 130 = 128 + 2 = SIGINT, 137 = 128 + 9 = SIGKILL
            const signalExitCodes = [130, 137, 143];
            const wasKilled = event.signal === 'SIGTERM' || event.signal === 'SIGINT' || event.signal === 'SIGKILL';
            const cleanExit = event.exitCode === 0 || signalExitCodes.includes(event.exitCode || -1);

            // Check if this was a health check failure or immediate crash
            const exitEvent = event as typeof event & { state?: string; failureReason?: string; stderr?: string };
            const wasHealthCheckFailure = exitEvent.failureReason === 'health_check_failed';
            const wasImmediateCrash = exitEvent.failureReason === 'immediate_crash';
            
            // Determine final status: health check failures stay 'failed', otherwise use normal logic
            const finalStatus = wasHealthCheckFailure || wasImmediateCrash ? 'failed' : ((wasKilled || cleanExit) ? 'stopped' : 'failed');

            // Get current project to preserve error message if status is failed
            const [currentProject] = await db.select()
              .from(projects)
              .where(eq(projects.id, projectId))
              .limit(1);

            // Preserve error message if we're keeping failed status
            const updateData: {
              devServerStatus: 'failed' | 'stopped';
              devServerPid: null;
              devServerPort: null;
              tunnelUrl: null;
              lastActivityAt: Date;
              errorMessage?: string | null;
            } = {
              devServerStatus: finalStatus,
              devServerPid: null,
              devServerPort: null,
              tunnelUrl: null,
              lastActivityAt: new Date(),
            };

            // Only clear error message if we're setting status to 'stopped'
            if (finalStatus === 'stopped') {
              updateData.errorMessage = null;
            }
            // If failed and no error message exists yet, set a default one
            else if (finalStatus === 'failed' && (!currentProject || !currentProject.errorMessage)) {
              updateData.errorMessage = wasHealthCheckFailure 
                ? 'Server failed health check after 10 attempts. Port configuration may be incorrect.'
                : wasImmediateCrash
                ? 'Process crashed immediately after starting. Check logs for syntax errors or missing dependencies.'
                : `Process exited unexpectedly (code: ${event.exitCode})`;
            }

            const [updated] = await db.update(projects)
              .set(updateData)
              .where(eq(projects.id, projectId))
              .returning();
            // No port reservation cleanup needed
            if (updated) emitProjectUpdateFromData(projectId, updated);

            // Trigger auto-fix for immediate crashes with stderr output
            if (wasImmediateCrash && exitEvent.stderr && currentProject) {
              console.log(`[events] 🔧 Immediate crash detected for project ${projectId}, triggering auto-fix`);
              
              // Check auto-fix attempt limits to prevent infinite loops
              const attempts = autoFixAttempts.get(projectId);
              const now = Date.now();

              if (attempts) {
                // Reset count if cooldown period has passed
                if (now - attempts.lastAttempt > AUTO_FIX_COOLDOWN_MS) {
                  attempts.count = 0;
                }

                if (attempts.count >= MAX_AUTO_FIX_ATTEMPTS) {
                  console.log(`[events] ⚠️ Max auto-fix attempts (${MAX_AUTO_FIX_ATTEMPTS}) reached for project ${projectId}, skipping auto-fix`);
                  
                  // Update project status to show manual intervention needed
                  const [failedUpdate] = await db.update(projects)
                    .set({
                      status: 'failed',
                      errorMessage: `Auto-fix failed after ${MAX_AUTO_FIX_ATTEMPTS} attempts. Error: ${exitEvent.stderr.substring(0, 300)}`,
                      lastActivityAt: new Date(),
                    })
                    .where(eq(projects.id, projectId))
                    .returning();
                  if (failedUpdate) emitProjectUpdateFromData(projectId, failedUpdate);
                  break;
                }
              }

              if (currentProject.slug) {
                // Update auto-fix tracking
                autoFixAttempts.set(projectId, {
                  count: (attempts?.count || 0) + 1,
                  lastAttempt: now,
                });

                const attemptNumber = (attempts?.count || 0) + 1;
                console.log(`[events] 🔧 Triggering auto-fix build for startup crash (attempt ${attemptNumber}/${MAX_AUTO_FIX_ATTEMPTS})...`);

                // Emit autofix-started event to notify UI
                const autoFixEvent: AutoFixStartedEvent = {
                  type: 'autofix-started',
                  projectId: projectId,
                  commandId: event.commandId,
                  timestamp: new Date().toISOString(),
                  errorType: 'startup',
                  errorMessage: exitEvent.stderr.substring(0, 500),
                  attempt: attemptNumber,
                  maxAttempts: MAX_AUTO_FIX_ATTEMPTS,
                };
                publishRunnerEvent(autoFixEvent);
                console.log(`[events] 📡 Emitted autofix-started event for project ${projectId}`);

                // Update project status to indicate error fixing in progress
                const [buildingUpdate] = await db.update(projects)
                  .set({
                    status: 'building',
                    errorMessage: exitEvent.stderr.substring(0, 500),
                    lastActivityAt: new Date(),
                  })
                  .where(eq(projects.id, projectId))
                  .returning();
                if (buildingUpdate) emitProjectUpdateFromData(projectId, buildingUpdate);

                // Get the runner for this project
                const runnerId = await getProjectRunnerId(currentProject.runnerId);

                if (runnerId) {
                  // Create a fix build command
                  const fixPrompt = `## Startup Error - Please Fix

The dev server crashed immediately after starting with the following error:

\`\`\`
${exitEvent.stderr.substring(0, 2000)}
\`\`\`

Please analyze this startup error, identify the root cause, fix it, and verify the fix works by running the dev server.

IMPORTANT:
- This is a startup/build error, not a runtime error
- Common causes: syntax errors, missing dependencies, configuration issues, import errors
- Run \`npm run build\` or \`npm run dev\` to verify your fix
- Keep iterating until the error is resolved
- Do not declare success until verification shows no errors`;

                  const buildCommand: StartBuildCommand = {
                    id: randomUUID(),
                    type: 'start-build',
                    projectId: projectId,
                    timestamp: new Date().toISOString(),
                    payload: {
                      prompt: fixPrompt,
                      operationType: 'autofix', // Use 'autofix' operation type for clarity
                      projectSlug: currentProject.slug,
                      projectName: currentProject.name || currentProject.slug,
                      isAutoFix: true,
                      autoFixError: exitEvent.stderr.substring(0, 500),
                    },
                  };

                  try {
                    await sendCommandToRunner(runnerId, buildCommand);
                    console.log(`[events] ✅ Auto-fix build triggered for startup crash in project ${projectId}`);
                  } catch (sendError) {
                    console.error(`[events] ❌ Failed to send auto-fix command to runner:`, sendError);
                  }
                } else {
                  console.log(`[events] ⚠️ No runner available for auto-fix, project ${projectId}`);
                }
              }
            }
            break;
          }
          case 'project-metadata': {
            // Update project metadata (path, runCommand, projectType, port) from template download
            const metadata = 'payload' in event ? event.payload : null;
            if (metadata && projectId) {
              // Extract detected framework early if available
              const detectedFramework = metadata.detectedFramework || null;

              if (detectedFramework) {
                console.log(`[events] 🔍 Early framework detection for project ${projectId}: ${detectedFramework}`);
              }

              const [updated] = await db.update(projects)
                .set({
                  path: metadata.path,
                  projectType: metadata.projectType,
                  runCommand: metadata.runCommand,
                  port: metadata.port,
                  detectedFramework, // Save detected framework early
                  lastActivityAt: new Date(),
                })
                .where(eq(projects.id, projectId))
                .returning();
              if (updated) emitProjectUpdateFromData(projectId, updated);
            }
            break;
          }
          case 'build-completed': {
            // Mark project as completed
            // Note: runCommand should already be set by project-metadata event

            // Extract detected framework and summary from payload if available
            const payload = ('payload' in event && event.payload && typeof event.payload === 'object') 
              ? event.payload as { detectedFramework?: string; summary?: string }
              : {};
            const detectedFramework = payload.detectedFramework || null;
            const buildSummary = payload.summary || null;

            if (detectedFramework) {
              console.log(`[events] 🔍 Saving detected framework for project ${projectId}: ${detectedFramework}`);
            }
            if (buildSummary) {
              console.log(`[events] 📝 Saving build summary for project ${projectId}: ${buildSummary.slice(0, 100)}...`);
            }

            // Always mark the latest generation session completed on build-completed.
            // Summary may arrive later via build-summary; don't leave the session
            // active (or let a later preview error look like a build failure).
            try {
              const [latestSession] = await db.select()
                .from(generationSessions)
                .where(eq(generationSessions.projectId, projectId))
                .orderBy(desc(generationSessions.createdAt))
                .limit(1);

              if (latestSession && latestSession.status !== 'cancelled') {
                await db.update(generationSessions)
                  .set({
                    status: 'completed',
                    ...(buildSummary ? { summary: buildSummary } : {}),
                    endedAt: latestSession.endedAt ?? new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(generationSessions.id, latestSession.id));
                console.log(`[events] ✅ Marked session ${latestSession.id} completed${buildSummary ? ' with summary' : ''}`);
              }
            } catch (err) {
              console.error(`[events] ❌ Failed to finalize generation session:`, err);
            }

            const [updated] = await db.update(projects)
              .set({
                status: 'completed',
                detectedFramework, // Save detected framework
                lastActivityAt: new Date(),
              })
              .where(eq(projects.id, projectId))
              .returning();

            if (updated) {
              emitProjectUpdateFromData(projectId, updated);

              // NOTE: sandbox checkpointing now happens in POST /sandbox/sync,
              // AFTER the built workspace is shipped into the box — checkpointing
              // here (build-completed, before the sync) would snapshot stale code.

              // Track project completion with key tags
              const completionAttributes: Record<string, string> = {
                project_id: updated.id,
              };

              // Extract the 4 key tags from the project
              if (updated.tags && Array.isArray(updated.tags)) {
                updated.tags.forEach((tag: unknown) => {
                  if (tag && typeof tag === 'object' && 'key' in tag && 'value' in tag) {
                    const tagKey = tag.key as string;
                    const tagValue = tag.value as string;
                    if (tagKey === 'model' || tagKey === 'framework' || tagKey === 'runner' || tagKey === 'brand') {
                      completionAttributes[tagKey] = tagValue;
                    }
                  }
                });
              }
              
              // Fallback: Use detected framework if no framework tag was present
              if (!completionAttributes.framework && updated.detectedFramework) {
                completionAttributes.framework = updated.detectedFramework;
                completionAttributes.framework_source = 'detected'; // Track that this was AI-detected
              } else if (completionAttributes.framework) {
                completionAttributes.framework_source = 'tag'; // Track that this came from a tag
              }
              
              // ============================================================
              // AUTO-START / RE-SYNC DEV SERVER AFTER BUILD COMPLETION
              // Local mode: the dev server runs the workspace directly, so HMR
              //   picks up follow-up edits — only start when not already running.
              // Sandbox mode: the dev server runs a SYNCED COPY inside the
              //   Railway sandbox, so HMR can't see local edits. Every completed
              //   build (including follow-ups) must re-issue start-dev-server,
              //   which re-ships the workspace and restarts the sandbox dev
              //   server. Without this a follow-up edit "completes" but the
              //   preview keeps serving the previous build.
              // ============================================================
              const serverAlreadyRunning = updated.devServerStatus === 'running';
              const isSandboxMode = ((updated.executionMode as string | null) ?? 'sandbox') === 'sandbox';
              if (updated.runCommand && updated.path && (!serverAlreadyRunning || isSandboxMode)) {
                console.log(`[events] 🚀 ${serverAlreadyRunning ? 'Re-syncing sandbox' : 'Auto-starting dev server'} for completed build...`);

                try {
                  // Get runner for this project
                  const runnerId = await getProjectRunnerId(updated.runnerId);

                  if (runnerId) {
                    // Sandbox previews each run on their own isolated host, so
                    // ports can never collide — use a fixed port and skip the
                    // local-runner allocation/conflict logic entirely. Local
                    // mode still allocates a non-conflicting port on the host.
                    let port: number;
                    let framework: string;
                    if (isSandboxMode) {
                      port = SANDBOX_DEV_PORT;
                      framework = (updated.detectedFramework as string | null) ?? 'node';
                      console.log(`[events] 📍 Sandbox fixed port ${port} for auto-start`);
                    } else {
                      const isRemoteRunner = runnerId !== 'local';
                      const portInfo = await reserveOrReallocatePort({
                        projectId: updated.id,
                        projectType: updated.projectType,
                        runCommand: updated.runCommand,
                        preferredPort: updated.devServerPort,
                        detectedFramework: updated.detectedFramework,
                      }, isRemoteRunner);
                      port = portInfo.port;
                      framework = portInfo.framework;
                      console.log(`[events] 📍 Allocated port ${port} for auto-start`);
                    }

                    // Update DB with the port
                    const [startingProject] = await db.update(projects)
                      .set({
                        devServerStatus: 'starting',
                        devServerPort: port,
                        errorMessage: null,
                        lastActivityAt: new Date(),
                      })
                      .where(eq(projects.id, updated.id))
                      .returning();

                    if (startingProject) {
                      emitProjectUpdateFromData(updated.id, startingProject);
                    }

                    // Build port environment variables
                    const portEnv = buildEnvForFramework(framework as Parameters<typeof buildEnvForFramework>[0], port);
                    const runCommand = getRunCommand(updated.runCommand);

                    // Send start command to runner
                    const startCommand: StartDevServerCommand = {
                      id: randomUUID(),
                      type: 'start-dev-server',
                      projectId: updated.id,
                      timestamp: new Date().toISOString(),
                      payload: {
                        runCommand,
                        workingDirectory: updated.path,
                        env: portEnv,
                        preferredPort: port,
                        executionMode: (updated.executionMode as 'local' | 'sandbox' | null) ?? 'sandbox',
                      },
                    };

                    await sendCommandToRunner(runnerId, startCommand);
                    console.log(`[events] ✅ Auto-start command sent for project ${updated.id} on port ${port} (${startCommand.payload.executionMode})`);
                  } else {
                    console.log(`[events] ⚠️ No runner available for auto-start`);
                  }
                } catch (autoStartError) {
                  console.error(`[events] ❌ Auto-start failed:`, autoStartError);
                  // Don't fail the build-completed handling, just log the error
                }
              } else if (serverAlreadyRunning) {
                console.log(`[events] ⏭️ Skipping auto-start - server already running (HMR will handle file changes)`);
              }
            }
            break;
          }
          case 'build-summary': {
            const payload = ('payload' in event && event.payload && typeof event.payload === 'object')
              ? event.payload as { summary?: string }
              : {};
            const buildSummary = typeof payload.summary === 'string' ? payload.summary.trim() : '';

            if (!buildSummary) {
              break;
            }

            // IMPORTANT: Only use the sessionId provided by the runner
            // DO NOT fall back to querying for the latest session - this causes race conditions
            // where a summary from build A could be attached to build B if user starts a new build quickly
            const targetSessionId = (event as { sessionId?: string }).sessionId;

            if (!targetSessionId) {
              console.warn(`[events] ⚠️ build-summary missing sessionId - cannot safely save summary`);
              console.warn(`[events]    Summary preview: ${buildSummary.slice(0, 100)}...`);
              // Still broadcast via WebSocket so the UI can display it even if not saved to DB
              // The frontend can use the summary from WebSocket state
              buildWebSocketServer.broadcastBuildSummary(projectId, '', buildSummary);
              break;
            }

            try {
              await db.update(generationSessions)
                .set({
                  status: 'completed',
                  summary: buildSummary,
                  endedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(generationSessions.id, targetSessionId));
              buildWebSocketServer.broadcastBuildSummary(projectId, targetSessionId, buildSummary);
            } catch (err) {
              console.error(`[events] ❌ Failed to save build summary:`, err);
            }

            break;
          }
          case 'build-failed': {
            const now = new Date();
            const sessionId = event.sessionId;

            if (sessionId) {
              await db.update(generationSessions)
                .set({
                  status: 'failed',
                  endedAt: now,
                  updatedAt: now,
                })
                .where(eq(generationSessions.id, sessionId));
            }

            const [updated] = await db.update(projects)
              .set({
                status: 'failed',
                errorMessage: event.error,
                lastActivityAt: now,
              })
              .where(eq(projects.id, projectId))
              .returning();
            if (updated) emitProjectUpdateFromData(projectId, updated);
            break;
          }
          case 'build-stream':
            break;
          case 'status': {
            // Non-fatal progress note (sandbox provisioning, etc.)
            const statusMessage =
              'message' in event && typeof event.message === 'string'
                ? event.message
                : 'Status update';
            console.log(`[events] ℹ️ Status for ${projectId}: ${statusMessage}`);
            buildWebSocketServer.broadcastActivityStatus(projectId, '', {
              message: statusMessage,
              phase: 'phase' in event && typeof event.phase === 'string' ? event.phase : undefined,
              level: 'info',
            });
            break;
          }
          case 'preview-failed': {
            // Build succeeded but sandbox/preview provision failed.
            // Keep generation session completed; only mark preview/dev server failed.
            const previewError =
              'error' in event && typeof event.error === 'string'
                ? event.error
                : 'Preview provision failed';
            const friendly = `Preview failed: ${previewError}`.slice(0, 500);
            console.log(`[events] ⚠️ Preview failed for ${projectId}: ${previewError.slice(0, 200)}`);

            const [updated] = await db.update(projects)
              .set({
                devServerStatus: 'failed',
                errorMessage: friendly,
                lastActivityAt: new Date(),
              })
              .where(eq(projects.id, projectId))
              .returning();
            if (updated) emitProjectUpdateFromData(projectId, updated);

            buildWebSocketServer.broadcastActivityStatus(projectId, '', {
              message: friendly,
              phase: 'phase' in event && typeof event.phase === 'string' ? event.phase : 'sandbox-sync',
              level: 'error',
            });
            break;
          }
          case 'error': {
            const errText =
              'error' in event && typeof event.error === 'string' ? event.error : 'Unknown error';
            // Sandbox sync used to emit generic "error"; treat those as preview failures
            // so a successful build is not shown as "Build failed".
            if (/sandbox sync failed/i.test(errText)) {
              const friendly = `Preview failed: ${errText}`.slice(0, 500);
              const [updated] = await db.update(projects)
                .set({
                  devServerStatus: 'failed',
                  errorMessage: friendly,
                  lastActivityAt: new Date(),
                })
                .where(eq(projects.id, projectId))
                .returning();
              if (updated) emitProjectUpdateFromData(projectId, updated);
              buildWebSocketServer.broadcastActivityStatus(projectId, '', {
                message: friendly,
                phase: 'sandbox-sync',
                level: 'error',
              });
              break;
            }

            const [updated] = await db.update(projects)
              .set({
                devServerStatus: 'failed',
                errorMessage: errText,
                lastActivityAt: new Date(),
              })
              .where(eq(projects.id, projectId))
              .returning();
            if (updated) emitProjectUpdateFromData(projectId, updated);
            break;
          }
          case 'dev-server-error': {
            // Auto-fix: dev server error detected, trigger a fix build
            const errorMessage = 'error' in event ? event.error : 'Unknown dev server error';
            console.log(`[events] 🔧 Dev server error detected for project ${projectId}`);
            console.log(`[events]    Error: ${errorMessage.substring(0, 200)}...`);

            // Check auto-fix attempt limits to prevent infinite loops
            const attempts = autoFixAttempts.get(projectId);
            const now = Date.now();

            if (attempts) {
              // Reset count if cooldown period has passed
              if (now - attempts.lastAttempt > AUTO_FIX_COOLDOWN_MS) {
                attempts.count = 0;
              }

              if (attempts.count >= MAX_AUTO_FIX_ATTEMPTS) {
                console.log(`[events] ⚠️ Max auto-fix attempts (${MAX_AUTO_FIX_ATTEMPTS}) reached for project ${projectId}, skipping auto-fix`);

                // Update project status to show manual intervention needed
                const [updated] = await db.update(projects)
                  .set({
                    status: 'failed',
                    errorMessage: `Auto-fix failed after ${MAX_AUTO_FIX_ATTEMPTS} attempts. Error: ${errorMessage.substring(0, 300)}`,
                    lastActivityAt: new Date(),
                  })
                  .where(eq(projects.id, projectId))
                  .returning();
                if (updated) emitProjectUpdateFromData(projectId, updated);
                break;
              }
            }

            // Get project details for the fix request
            const [project] = await db.select()
              .from(projects)
              .where(eq(projects.id, projectId))
              .limit(1);

            if (project && project.slug) {
              // Update auto-fix tracking
              const attemptNumber = (attempts?.count || 0) + 1;
              autoFixAttempts.set(projectId, {
                count: attemptNumber,
                lastAttempt: now,
              });

              console.log(`[events] 🔧 Triggering auto-fix build (attempt ${attemptNumber}/${MAX_AUTO_FIX_ATTEMPTS})...`);

              // Emit autofix-started event to notify UI
              const autoFixEvent: AutoFixStartedEvent = {
                type: 'autofix-started',
                projectId: projectId,
                commandId: event.commandId,
                timestamp: new Date().toISOString(),
                errorType: 'runtime',
                errorMessage: errorMessage.substring(0, 500),
                attempt: attemptNumber,
                maxAttempts: MAX_AUTO_FIX_ATTEMPTS,
              };
              publishRunnerEvent(autoFixEvent);
              console.log(`[events] 📡 Emitted autofix-started event for project ${projectId}`);

              // Update project status to indicate error fixing in progress
              const [updated] = await db.update(projects)
                .set({
                  status: 'building',
                  errorMessage: errorMessage.substring(0, 500),
                  lastActivityAt: new Date(),
                })
                .where(eq(projects.id, projectId))
                .returning();
              if (updated) emitProjectUpdateFromData(projectId, updated);

              // Get the runner for this project
              const runnerId = await getProjectRunnerId(project.runnerId);

              if (runnerId) {
                // Create a fix build command
                const fixPrompt = `## Dev Server Error - Please Fix

The dev server encountered the following error after the build completed:

\`\`\`
${errorMessage.substring(0, 2000)}
\`\`\`

Please analyze this error, identify the root cause, fix it, and verify the fix works by running the dev server.

IMPORTANT:
- Run \`npm run build\` or \`npm run dev\` to verify your fix
- Keep iterating until the error is resolved
- Do not declare success until verification shows no errors`;

                const buildCommand: StartBuildCommand = {
                  id: randomUUID(),
                  type: 'start-build',
                  projectId: projectId,
                  timestamp: new Date().toISOString(),
                  payload: {
                    prompt: fixPrompt,
                    operationType: 'autofix', // Use 'autofix' operation type for clarity
                    projectSlug: project.slug,
                    projectName: project.name || project.slug,
                    isAutoFix: true,
                    autoFixError: errorMessage.substring(0, 500),
                  },
                };

                try {
                  await sendCommandToRunner(runnerId, buildCommand);
                  console.log(`[events] ✅ Auto-fix build triggered for project ${projectId}`);
                } catch (sendError) {
                  console.error(`[events] ❌ Failed to send auto-fix command to runner:`, sendError);
                }
              } else {
                console.log(`[events] ⚠️ No runner available for auto-fix, project ${projectId}`);
              }
            }
            break;
          }
          default:
            break;
        }
    })();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to process runner event', error);
    return NextResponse.json({ error: 'Failed to process runner event' }, { status: 500 });
  }
}
