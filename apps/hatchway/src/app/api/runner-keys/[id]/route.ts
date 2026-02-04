import { NextRequest, NextResponse } from "next/server";
import { db } from "@hatchway/agent-core";
import { runnerKeys } from "@hatchway/agent-core/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  requireAuth,
  isLocalMode,
  handleAuthError,
  AuthError,
} from "@/lib/auth-helpers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/runner-keys/[id]
 * Revoke a runner key (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // Local mode doesn't have runner keys
    if (isLocalMode()) {
      return NextResponse.json(
        { error: "Runner keys not available in local mode" },
        { status: 400 }
      );
    }

    const session = await requireAuth();
    const userId = session.user.id;
    const { id: keyId } = await params;

    // Find the key and verify ownership
    const existingKey = await db.query.runnerKeys.findFirst({
      where: and(
        eq(runnerKeys.id, keyId),
        eq(runnerKeys.userId, userId),
        isNull(runnerKeys.revokedAt)
      ),
    });

    if (!existingKey) {
      throw new AuthError("Key not found", 404);
    }

    // Soft delete by setting revokedAt
    await db
      .update(runnerKeys)
      .set({ revokedAt: new Date() })
      .where(eq(runnerKeys.id, keyId));

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
