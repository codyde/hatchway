import { NextResponse } from 'next/server';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { getProjectRunnerId } from '@/lib/runner-utils';
import { randomUUID } from 'crypto';

/**
 * POST /api/projects/:id/github/sync
 * Trigger a sync operation to fetch latest GitHub repo info
 * This sends a command to the runner to fetch repo metadata
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    const { project } = await requireProjectOwnership(id);

    // Check if GitHub is connected
    if (!project.githubRepo) {
      return NextResponse.json({ 
        error: 'GitHub is not connected to this project. Set up GitHub first.' 
      }, { status: 400 });
    }

    // Get runner for this project
    const runnerId = await getProjectRunnerId(project.runnerId);
    
    if (!runnerId) {
      return NextResponse.json({ 
        error: 'No runner available. Please ensure a runner is connected.' 
      }, { status: 503 });
    }

    // Send sync command to runner
    const commandId = randomUUID();
    
    try {
      await sendCommandToRunner(runnerId, {
        id: commandId,
        type: 'github-sync',
        projectId: id,
        timestamp: new Date().toISOString(),
        payload: {
          slug: project.slug,
          repo: project.githubRepo,
        },
      });

      return NextResponse.json({ 
        success: true,
        message: 'Sync command sent to runner',
        commandId,
      });
    } catch (sendError) {
      console.error('Failed to send sync command to runner:', sendError);
      return NextResponse.json({ 
        error: 'Failed to communicate with runner' 
      }, { status: 503 });
    }
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error initiating GitHub sync:', error);
    return NextResponse.json({ error: 'Failed to initiate sync' }, { status: 500 });
  }
}
