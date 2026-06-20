import { NextResponse } from 'next/server';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import type { RunnerCommand } from '@hatchway/agent-core/shared/runner/messages';
import { requireProjectOwnership, handleAuthError, isLocalMode, getSession } from '@/lib/auth-helpers';
import { getProjectRunnerId } from '@/lib/runner-utils';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RunnerCommand & { runnerId?: string };
    const { runnerId: _ignored, ...command } = payload;

    if (!command.type) {
      return NextResponse.json({ error: 'Invalid command payload' }, { status: 400 });
    }

    let runnerId: string | null;

    // Handle analyze-project specially - no projectId (project doesn't exist yet)
    if (command.type === 'analyze-project') {
      // Just require authentication, not project ownership
      const session = await getSession();
      if (!isLocalMode() && !session?.user?.id) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      // No project yet, so no saved runner to derive from. Scope to the user's
      // own connected runners so the client cannot target another user's runner.
      runnerId = await getProjectRunnerId(null, session?.user?.id);
      if (!runnerId) {
        return NextResponse.json({ error: 'No runner connected' }, { status: 503 });
      }
    } else {
      // All other commands require projectId and ownership verification
      const projectId = (command as { projectId?: string }).projectId;
      if (!projectId) {
        return NextResponse.json({ error: 'Invalid command payload - projectId required' }, { status: 400 });
      }
      const { project, session } = await requireProjectOwnership(projectId);
      // Derive the runner from the project - never trust a client-supplied runnerId,
      // otherwise commands can be routed to another user's runner. The fallback
      // for a project with no saved runner is scoped to the owner's runners.
      runnerId = await getProjectRunnerId(project.runnerId, session.user.id);
      if (!runnerId) {
        return NextResponse.json({ error: 'No runner connected for this project' }, { status: 503 });
      }
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
