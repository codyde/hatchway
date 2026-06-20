import { NextRequest } from 'next/server';
import { projectEvents } from '@/lib/project-events';
import { enrichProjectWithRunnerStatus } from '@/lib/runner-utils';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';

const isVerboseSSELogging = process.env.HATCHWAY_DEBUG_SSE === '1';
const debugLog = (...args: unknown[]) => {
  if (isVerboseSSELogging) {
    console.log(...args);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SSE endpoint for real-time project status updates
 * Uses event-driven architecture for instant updates (no polling!)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Verify user owns this project before opening the stream. The ownership
  // check already fetches the project row, so reuse it for the initial state
  // instead of re-querying inside the stream.
  let ownedProject: Awaited<ReturnType<typeof requireProjectOwnership>>['project'];
  try {
    ({ project: ownedProject } = await requireProjectOwnership(id));
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    throw error;
  }

  debugLog(`📡 SSE status stream requested for project: ${id}`);

  const encoder = new TextEncoder();
  let keepaliveInterval: NodeJS.Timeout | null = null;
  let isClosed = false;
  let activeProjectUpdateHandler: ((project: any) => void) | null = null;

  const safeEnqueue = (controller: ReadableStreamDefaultController, data: string) => {
    if (isClosed) return;
    try {
      controller.enqueue(encoder.encode(data));
    } catch (err) {
      if (process.env.HATCHWAY_DEBUG_SSE === '1') {
        console.warn(`⚠️  Failed to enqueue SSE data for ${id}:`, err);
      }
      safeClose(controller);
    }
  };

  const safeClose = (controller: ReadableStreamDefaultController) => {
    if (isClosed) return;
    isClosed = true;
    try {
      controller.close();
    } catch (err) {
      if (process.env.HATCHWAY_DEBUG_SSE === '1') {
        console.warn(`⚠️  Failed to close SSE controller for ${id}:`, err);
      }
    }
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }
    if (activeProjectUpdateHandler) {
      projectEvents.offProjectUpdate(id, activeProjectUpdateHandler);
      activeProjectUpdateHandler = null;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const enqueueConnected = `data: ${JSON.stringify({ type: 'connected' })}\n\n`;
        safeEnqueue(controller, enqueueConnected);

        // Send initial project state immediately, reusing the row already
        // fetched by the ownership check above
        const enrichedProject = await enrichProjectWithRunnerStatus(ownedProject);
        const data = `data: ${JSON.stringify({
          type: 'status-update',
          project: enrichedProject,
        })}\n\n`;
        safeEnqueue(controller, data);
        debugLog(`✅ Sent initial status for ${id}`);

        // Start keepalive pings every 15 seconds
        keepaliveInterval = setInterval(() => {
          safeEnqueue(controller, ':keepalive\n\n');
        }, 15000);

        // Event-driven updates: listen for project changes
        // This is the PRIMARY mechanism - no polling needed!
        const projectUpdateHandler = async (project: any) => {
          try {
            // Enrich with runner connection status for each update
            const enrichedProject = await enrichProjectWithRunnerStatus(project);
            const data = `data: ${JSON.stringify({
              type: 'status-update',
              project: enrichedProject,
            })}\n\n`;
            safeEnqueue(controller, data);
            debugLog(`📤 Event-driven update for ${id}:`, {
              status: enrichedProject.devServerStatus,
              port: enrichedProject.devServerPort,
              tunnel: enrichedProject.tunnelUrl,
              runnerConnected: enrichedProject.runnerConnected,
            });
          } catch (err) {
            console.error(`   Failed to send update for ${id}:`, err);
          }
        };

        // Subscribe to project events - this handles ALL updates
        projectEvents.onProjectUpdate(id, projectUpdateHandler);
        activeProjectUpdateHandler = projectUpdateHandler;

        // NOTE: Removed periodic polling (was every 5 seconds)
        // The event-driven approach via projectEvents handles all updates
        // This eliminates unnecessary database SELECTs

        // Cleanup on connection close
        req.signal.addEventListener('abort', () => {
          debugLog(`🔌 Client disconnected from status stream for ${id}`);
          safeClose(controller);
        });
      } catch (error) {
        console.error(`❌ Error starting status stream for ${id}:`, error);
        if (!isClosed) {
          try {
            controller.error(error);
          } catch {
            safeClose(controller);
          }
        }
      }
    },

    cancel() {
      debugLog(`🛑 Status stream cancelled for ${id}`);
      const dummyController = {
        close: () => {},
        enqueue: () => {},
      } as unknown as ReadableStreamDefaultController;
      safeClose(dummyController);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
