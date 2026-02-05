import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core';
import { railwayConnections } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, handleAuthError } from '@/lib/auth-helpers';
import { isRailwayOAuthConfigured } from '@/lib/railway/oauth';
import type { RailwayConnectionStatus, RailwayWorkspace } from '@/lib/railway/types';

/**
 * GET /api/integrations/railway
 * Get the current user's Railway connection status
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    // Check if Railway OAuth is configured
    if (!isRailwayOAuthConfigured()) {
      return NextResponse.json({
        configured: false,
        status: {
          isConnected: false,
          status: 'disconnected',
        } as RailwayConnectionStatus,
      });
    }

    // Get user's Railway connection
    const connection = await db.query.railwayConnections.findFirst({
      where: eq(railwayConnections.userId, userId),
    });

    if (!connection) {
      return NextResponse.json({
        configured: true,
        status: {
          isConnected: false,
          status: 'disconnected',
        } as RailwayConnectionStatus,
      });
    }

    const status: RailwayConnectionStatus = {
      isConnected: connection.status === 'active',
      railwayUserId: connection.railwayUserId,
      railwayEmail: connection.railwayEmail ?? undefined,
      railwayName: connection.railwayName ?? undefined,
      defaultWorkspace: connection.defaultWorkspaceId && connection.defaultWorkspaceName
        ? { id: connection.defaultWorkspaceId, name: connection.defaultWorkspaceName }
        : undefined,
      grantedWorkspaces: connection.grantedWorkspaces as RailwayWorkspace[] | undefined,
      status: connection.status as 'active' | 'disconnected' | 'expired',
    };

    return NextResponse.json({
      configured: true,
      status,
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway API] Error fetching status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Railway status' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/integrations/railway
 * Update Railway settings (e.g., default workspace)
 */
export async function PATCH(req: Request) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const body = await req.json() as {
      defaultWorkspaceId?: string;
      defaultWorkspaceName?: string;
    };

    // Get current connection
    const connection = await db.query.railwayConnections.findFirst({
      where: eq(railwayConnections.userId, userId),
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'Railway not connected' },
        { status: 404 }
      );
    }

    // Build update object
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.defaultWorkspaceId !== undefined) {
      updates.defaultWorkspaceId = body.defaultWorkspaceId;
    }
    if (body.defaultWorkspaceName !== undefined) {
      updates.defaultWorkspaceName = body.defaultWorkspaceName;
    }

    // Update connection
    const [updated] = await db.update(railwayConnections)
      .set(updates)
      .where(eq(railwayConnections.userId, userId))
      .returning();

    const status: RailwayConnectionStatus = {
      isConnected: updated.status === 'active',
      railwayUserId: updated.railwayUserId,
      railwayEmail: updated.railwayEmail ?? undefined,
      railwayName: updated.railwayName ?? undefined,
      defaultWorkspace: updated.defaultWorkspaceId && updated.defaultWorkspaceName
        ? { id: updated.defaultWorkspaceId, name: updated.defaultWorkspaceName }
        : undefined,
      grantedWorkspaces: updated.grantedWorkspaces as RailwayWorkspace[] | undefined,
      status: updated.status as 'active' | 'disconnected' | 'expired',
    };

    return NextResponse.json({ status });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway API] Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update Railway settings' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/railway
 * Disconnect Railway integration
 */
export async function DELETE() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    // Delete the connection
    const deleted = await db.delete(railwayConnections)
      .where(eq(railwayConnections.userId, userId))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: 'Railway not connected' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Railway disconnected successfully',
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway API] Error disconnecting:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect Railway' },
      { status: 500 }
    );
  }
}
