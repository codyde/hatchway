import { NextRequest, NextResponse } from "next/server";
import { db } from "@hatchway/agent-core";
import { cliAuthSessions } from "@hatchway/agent-core/lib/db/schema";
import { randomBytes } from "crypto";

/**
 * POST /api/auth/cli/start
 * 
 * Initiates a CLI authentication session.
 * The CLI calls this endpoint with its callback port, receives a session token,
 * and then opens the browser to complete OAuth.
 * 
 * Request body:
 * - callbackPort: number - The port the CLI is listening on for the callback
 * - callbackHost?: string - The host for callback (default: localhost)
 * - deviceName?: string - Optional device name for the runner key
 * 
 * Response:
 * - sessionToken: string - Token to identify this auth session
 * - authUrl: string - URL the CLI should open in the browser
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { callbackPort, callbackHost = "localhost", deviceName } = body;

    if (!callbackPort || typeof callbackPort !== "number") {
      return NextResponse.json(
        { error: "callbackPort is required and must be a number" },
        { status: 400 }
      );
    }

    // Validate port range
    if (callbackPort < 1024 || callbackPort > 65535) {
      return NextResponse.json(
        { error: "callbackPort must be between 1024 and 65535" },
        { status: 400 }
      );
    }

    // Generate a secure random token for this session
    const sessionToken = randomBytes(32).toString("hex");

    // Session expires in 10 minutes (plenty of time to complete OAuth)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Create the session in the database
    await db.insert(cliAuthSessions).values({
      token: sessionToken,
      callbackPort,
      callbackHost,
      deviceName: deviceName || null,
      state: "pending",
      expiresAt,
    });

    // Build the auth URL - this is where the CLI will redirect the user
    const baseUrl = process.env.BETTER_AUTH_URL || 
                    process.env.NEXT_PUBLIC_APP_URL || 
                    "http://localhost:3000";
    
    const authUrl = `${baseUrl}/auth/cli?session=${sessionToken}`;

    return NextResponse.json({
      sessionToken,
      authUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[cli-auth] Error starting session:", error);
    return NextResponse.json(
      { error: "Failed to start authentication session" },
      { status: 500 }
    );
  }
}
