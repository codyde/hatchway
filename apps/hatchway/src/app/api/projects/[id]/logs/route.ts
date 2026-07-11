import { NextResponse } from 'next/server';
import {
  getRunnerLogs,
  subscribeToRunnerLogs,
} from '@hatchway/agent-core/lib/runner/log-store';
import { handleAuthError, requireProjectOwnership } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function formatEvent(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project } = await requireProjectOwnership(id);
    const wantsStream = new URL(request.url).searchParams.get('stream') === 'true';

    if (!wantsStream) {
      const logs = getRunnerLogs(id);
      return NextResponse.json({
        running: project.devServerStatus === 'starting' || project.devServerStatus === 'running',
        status: project.devServerStatus,
        logs: logs.map((entry) => entry.data),
      });
    }

    let unsubscribe = () => {};
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (keepalive) clearInterval(keepalive);
          try {
            controller.close();
          } catch {
            // The client may have already closed the stream.
          }
        };

        const send = (data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(formatEvent(data));
          } catch {
            close();
          }
        };

        send({ type: 'connected', status: project.devServerStatus });
        unsubscribe = subscribeToRunnerLogs(id, (event) => {
          if (event.type === 'log') {
            send({
              type: 'log',
              data: event.entry.data,
              stream: event.entry.type,
              timestamp: event.entry.timestamp,
            });
            return;
          }

          send({ type: 'exit', ...event.payload });
          close();
        });

        keepalive = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            close();
          }
        }, 15000);

        request.signal.addEventListener('abort', close, { once: true });
      },
      cancel() {
        closed = true;
        unsubscribe();
        if (keepalive) clearInterval(keepalive);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('Failed to read project logs:', error);
    return NextResponse.json(
      { error: 'Failed to read project logs' },
      { status: 500 }
    );
  }
}
