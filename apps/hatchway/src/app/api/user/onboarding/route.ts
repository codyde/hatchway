import { NextResponse } from "next/server";
import { db } from "@hatchway/agent-core";
import { users } from "@hatchway/agent-core/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  requireAuth,
  isLocalMode,
  handleAuthError,
} from "@/lib/auth-helpers";

/**
 * GET /api/user/onboarding
 * Get the current user's onboarding status
 */
export async function GET() {
  try {
    // Local mode users don't have persistent onboarding state
    if (isLocalMode()) {
      return NextResponse.json({ hasCompletedOnboarding: false });
    }

    const session = await requireAuth();
    const userId = session.user.id;

    const user = await db
      .select({
        hasCompletedOnboarding: users.hasCompletedOnboarding,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || user.length === 0) {
      return NextResponse.json({ hasCompletedOnboarding: false });
    }

    return NextResponse.json({
      hasCompletedOnboarding: user[0].hasCompletedOnboarding,
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    console.error("Failed to get onboarding status:", error);
    return NextResponse.json({ error: "Failed to get onboarding status" }, { status: 500 });
  }
}

/**
 * POST /api/user/onboarding
 * Mark the user's onboarding as complete
 */
export async function POST() {
  try {
    // Local mode doesn't persist onboarding state
    if (isLocalMode()) {
      return NextResponse.json({ success: true });
    }

    const session = await requireAuth();
    const userId = session.user.id;

    await db
      .update(users)
      .set({
        hasCompletedOnboarding: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    console.error("Failed to update onboarding status:", error);
    return NextResponse.json({ error: "Failed to update onboarding status" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/onboarding
 * Reset onboarding status (for testing or re-onboarding)
 */
export async function DELETE() {
  try {
    // Local mode doesn't persist onboarding state
    if (isLocalMode()) {
      return NextResponse.json({ success: true });
    }

    const session = await requireAuth();
    const userId = session.user.id;

    await db
      .update(users)
      .set({
        hasCompletedOnboarding: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    console.error("Failed to reset onboarding status:", error);
    return NextResponse.json({ error: "Failed to reset onboarding status" }, { status: 500 });
  }
}
