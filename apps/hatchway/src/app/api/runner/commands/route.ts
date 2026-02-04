import { NextResponse } from 'next/server';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import type { RunnerCommand } from '@hatchway/agent-core/shared/runner/messages';
import { requireProjectOwnership, handleAuthError, isLocalMode, getSession } from '@/lib/auth-helpers';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RunnerCommand & { runnerId?: string };
    const runnerId = payload.runnerId ?? process.env.RUNNER_DEFAULT_ID ?? 'default';
    const { runnerId: _ignored, ...command } = payload;

    if (!command.type) {
      return NextResponse.json({ error: 'Invalid command payload' }, { status: 400 });
    }

    // Handle analyze-project specially - no projectId (project doesn't exist yet)
    if (command.type === 'analyze-project') {
      // Just require authentication, not project ownership
      if (!isLocalMode()) {
        const session = await getSession();
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }
      }
    } else {
      // All other commands require projectId and ownership verification
      const projectId = (command as { projectId?: string }).projectId;
      if (!projectId) {
        return NextResponse.json({ error: 'Invalid command payload - projectId required' }, { status: 400 });
      }
      await requireProjectOwnership(projectId);
    }

    await sendCommandToRunner(runnerId, { ...command, timestamp: command.timestamp ?? new Date().toISOString() });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Handle auth errors (401, 403, 404)
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Failed to dispatch runner command:', error);
    return NextResponse.json({ error: 'Failed to dispatch command' }, { status: 500 });
  }
}
