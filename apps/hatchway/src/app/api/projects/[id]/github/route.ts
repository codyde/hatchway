import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import type { GitHubStatus, GitHubMeta, UpdateGitHubSettingsRequest } from '@hatchway/agent-core';

/**
 * GET /api/projects/:id/github
 * Get GitHub integration status for a project
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    const { project } = await requireProjectOwnership(id);

    const status: GitHubStatus = {
      isConnected: !!project.githubRepo,
      repo: project.githubRepo,
      url: project.githubUrl,
      branch: project.githubBranch,
      lastPushedAt: project.githubLastPushedAt,
      autoPush: project.githubAutoPush ?? false,
      lastSyncAt: project.githubLastSyncAt,
      meta: project.githubMeta as GitHubMeta | null,
    };

    return NextResponse.json({ status });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error fetching GitHub status:', error);
    return NextResponse.json({ error: 'Failed to fetch GitHub status' }, { status: 500 });
  }
}

/**
 * PATCH /api/projects/:id/github
 * Update GitHub settings (e.g., auto-push toggle)
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    await requireProjectOwnership(id);
    
    const body: UpdateGitHubSettingsRequest = await req.json();

    // Build update object
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.autoPush !== undefined) {
      updates.githubAutoPush = body.autoPush;
    }

    const [updated] = await db.update(projects)
      .set(updates)
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const status: GitHubStatus = {
      isConnected: !!updated.githubRepo,
      repo: updated.githubRepo,
      url: updated.githubUrl,
      branch: updated.githubBranch,
      lastPushedAt: updated.githubLastPushedAt,
      autoPush: updated.githubAutoPush ?? false,
      lastSyncAt: updated.githubLastSyncAt,
      meta: updated.githubMeta as GitHubMeta | null,
    };

    return NextResponse.json({ status });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error updating GitHub settings:', error);
    return NextResponse.json({ error: 'Failed to update GitHub settings' }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/:id/github
 * Disconnect GitHub integration (clears all GitHub fields)
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    await requireProjectOwnership(id);

    const [updated] = await db.update(projects)
      .set({
        githubRepo: null,
        githubUrl: null,
        githubBranch: null,
        githubLastPushedAt: null,
        githubAutoPush: false,
        githubLastSyncAt: null,
        githubMeta: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true,
      message: 'GitHub integration disconnected' 
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error disconnecting GitHub:', error);
    return NextResponse.json({ error: 'Failed to disconnect GitHub' }, { status: 500 });
  }
}

/**
 * POST /api/projects/:id/github
 * Update GitHub metadata after setup/sync/push operations
 * Called by the runner after completing GitHub operations
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    await requireProjectOwnership(id);
    
    const body = await req.json();

    // Build update object based on what was provided
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.repo !== undefined) {
      updates.githubRepo = body.repo;
    }
    if (body.url !== undefined) {
      updates.githubUrl = body.url;
    }
    if (body.branch !== undefined) {
      updates.githubBranch = body.branch;
    }
    if (body.lastPushedAt !== undefined) {
      updates.githubLastPushedAt = new Date(body.lastPushedAt);
    }
    if (body.meta !== undefined) {
      updates.githubMeta = body.meta;
      updates.githubLastSyncAt = new Date();
    }

    const [updated] = await db.update(projects)
      .set(updates)
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const status: GitHubStatus = {
      isConnected: !!updated.githubRepo,
      repo: updated.githubRepo,
      url: updated.githubUrl,
      branch: updated.githubBranch,
      lastPushedAt: updated.githubLastPushedAt,
      autoPush: updated.githubAutoPush ?? false,
      lastSyncAt: updated.githubLastSyncAt,
      meta: updated.githubMeta as GitHubMeta | null,
    };

    return NextResponse.json({ status });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error updating GitHub metadata:', error);
    return NextResponse.json({ error: 'Failed to update GitHub metadata' }, { status: 500 });
  }
}
