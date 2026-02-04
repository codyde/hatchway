import { NextRequest, NextResponse } from "next/server";
import { db } from "@hatchway/agent-core";
import { runnerKeys } from "@hatchway/agent-core/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import {
  requireAuth,
  isLocalMode,
  generateRunnerKey,
  hashRunnerKey,
  getKeyPrefix,
  handleAuthError,
  AuthError,
} from "@/lib/auth-helpers";

/**
 * GET /api/runner-keys
 * List all active runner keys for the authenticated user
 */
export async function GET() {
  try {
    // Local mode doesn't need runner keys
    if (isLocalMode()) {
      return NextResponse.json({ keys: [] });
    }

    const session = await requireAuth();
    const userId = session.user.id;

    const keys = await db
      .select({
        id: runnerKeys.id,
        name: runnerKeys.name,
        keyPrefix: runnerKeys.keyPrefix,
        lastUsedAt: runnerKeys.lastUsedAt,
        createdAt: runnerKeys.createdAt,
      })
      .from(runnerKeys)
      .where(
        and(
          eq(runnerKeys.userId, userId),
          isNull(runnerKeys.revokedAt)
        )
      )
      .orderBy(runnerKeys.createdAt);

    return NextResponse.json({ keys });
  } catch (error) {
    return handleAuthError(error);
  }
}

/**
 * POST /api/runner-keys
 * Create a new runner key
 */
export async function POST(request: NextRequest) {
  try {
    // Local mode doesn't need runner keys
    if (isLocalMode()) {
      return NextResponse.json(
        { error: "Runner keys not needed in local mode" },
        { status: 400 }
      );
    }

    const session = await requireAuth();
    const userId = session.user.id;

    const body = await request.json();
    const name = body.name?.trim();

    if (!name) {
      throw new AuthError("Key name is required", 400);
    }

    if (name.length > 100) {
      throw new AuthError("Key name must be 100 characters or less", 400);
    }

    // Generate a new key
    const fullKey = generateRunnerKey();
    const keyHash = hashRunnerKey(fullKey);
    const keyPrefix = getKeyPrefix(fullKey);

    // Save to database
    await db.insert(runnerKeys).values({
      userId,
      name,
      keyHash,
      keyPrefix,
    });

    // Return the full key (only shown once)
    return NextResponse.json({
      key: fullKey,
      keyPrefix,
      message: "Key created. Copy it now - it won't be shown again.",
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
