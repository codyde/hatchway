import { NextRequest, NextResponse } from "next/server";
import { db } from "@hatchway/agent-core";
import { cliAuthSessions, runnerKeys } from "@hatchway/agent-core/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { getSession, generateRunnerKey, hashRunnerKey, getKeyPrefix } from "@/lib/auth-helpers";
import { hostname } from "os";

/**
 * POST /api/auth/cli/callback
 * 
 * Called after the user completes OAuth login to create a runner key
 * and return it to the CLI via the callback URL.
 * 
 * Request body:
 * - sessionToken: string - The CLI auth session token
 * 
 * Response:
 * - success: boolean
 * - callbackUrl: string - URL to redirect to (the CLI's callback server)
 */
export async function POST(request: NextRequest) {
  try {
    // Require authenticated user
    const userSession = await getSession();
    if (!userSession) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { sessionToken } = body;

    if (!sessionToken) {
      return NextResponse.json(
        { error: "sessionToken is required" },
        { status: 400 }
      );
    }

    // Find the CLI auth session
    const [cliSession] = await db
      .select()
      .from(cliAuthSessions)
      .where(
        and(
          eq(cliAuthSessions.token, sessionToken),
          eq(cliAuthSessions.state, "pending"),
          gt(cliAuthSessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!cliSession) {
      return NextResponse.json(
        { error: "Invalid or expired session" },
        { status: 400 }
      );
    }

    // Generate a new runner key for this user
    const deviceName = cliSession.deviceName || `CLI - ${hostname()} - ${new Date().toLocaleDateString()}`;
    const fullKey = generateRunnerKey();
    const keyHash = hashRunnerKey(fullKey);
    const keyPrefix = getKeyPrefix(fullKey);

    // Insert the runner key
    const [newKey] = await db
      .insert(runnerKeys)
      .values({
        userId: userSession.user.id,
        name: deviceName,
        keyHash,
        keyPrefix,
        source: "cli",
      })
      .returning({ id: runnerKeys.id });

    // Update the CLI session to mark as authenticated
    await db
      .update(cliAuthSessions)
      .set({
        state: "authenticated",
        userId: userSession.user.id,
        runnerKeyId: newKey.id,
        authenticatedAt: new Date(),
      })
      .where(eq(cliAuthSessions.id, cliSession.id));

    // Build the callback URL for the CLI
    const callbackUrl = `http://${cliSession.callbackHost}:${cliSession.callbackPort}/callback?token=${encodeURIComponent(fullKey)}&status=success`;

    return NextResponse.json({
      success: true,
      callbackUrl,
    });
  } catch (error) {
    console.error("[cli-auth] Error in callback:", error);
    return NextResponse.json(
      { error: "Failed to complete authentication" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/cli/callback
 * 
 * Check the status of a CLI auth session (polling endpoint).
 * 
 * Query params:
 * - session: string - The session token
 * 
 * Response:
 * - state: 'pending' | 'authenticated' | 'completed' | 'expired'
 * - runnerKey?: string - The runner key (only if authenticated and not yet completed)
 */
export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.nextUrl.searchParams.get("session");

    if (!sessionToken) {
      return NextResponse.json(
        { error: "session parameter is required" },
        { status: 400 }
      );
    }

    // Find the CLI auth session
    const [cliSession] = await db
      .select()
      .from(cliAuthSessions)
      .where(eq(cliAuthSessions.token, sessionToken))
      .limit(1);

    if (!cliSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Check if expired
    if (cliSession.expiresAt < new Date()) {
      return NextResponse.json({
        state: "expired",
      });
    }

    return NextResponse.json({
      state: cliSession.state,
      // Don't expose the runner key here - CLI gets it via callback redirect
    });
  } catch (error) {
    console.error("[cli-auth] Error checking status:", error);
    return NextResponse.json(
      { error: "Failed to check session status" },
      { status: 500 }
    );
  }
}
