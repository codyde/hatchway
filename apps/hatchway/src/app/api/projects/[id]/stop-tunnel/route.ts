import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { getProjectRunnerId } from '@/lib/runner-utils';
import type { StopTunnelCommand } from '@/shared/runner/messages';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';

// POST /api/projects/:id/stop-tunnel - Stop tunnel for dev server
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify user owns this project
    const { project: proj } = await requireProjectOwnership(id);

    // Try to use project's saved runner, fallback to any available runner
    const runnerId = await getProjectRunnerId(proj.runnerId);

    if (!runnerId) {
      return NextResponse.json(
        { error: 'No runners connected' },
        { status: 503 }
      );
    }

    // Check if tunnel exists
    if (!proj.tunnelUrl) {
      return NextResponse.json({
        message: 'No tunnel to stop',
      });
    }

    // Check if we have a port to close the tunnel
    if (!proj.devServerPort) {
      return NextResponse.json({
        error: 'No port information available to close tunnel'
      }, { status: 400 });
    }

    const runnerCommand: StopTunnelCommand = {
      id: randomUUID(),
      type: 'stop-tunnel',
      projectId: id,
      timestamp: new Date().toISOString(),
      payload: {
        port: proj.devServerPort,
      },
    };

    await sendCommandToRunner(runnerId, runnerCommand);

    return NextResponse.json({
      message: 'Tunnel stop requested',
      port: proj.devServerPort,
    }, { status: 202 });

  } catch (error) {
    // Handle auth errors (401, 403, 404)
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error stopping tunnel:', error);

    if (error instanceof Error && /not connected/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Runner is not connected' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to stop tunnel',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
