import { getAuth } from "./auth";
import { headers } from "next/headers";
import { db } from "@hatchway/agent-core";
import { projects, runnerKeys, users, sessions } from "@hatchway/agent-core/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { createHash } from "crypto";
import { timingSafeEqualString } from "@hatchway/agent-core/lib/timing-safe-equal";

// Local mode user - used when HATCHWAY_LOCAL_MODE is true
export const LOCAL_USER = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Local User",
  email: "local@localhost",
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

// Local mode session - a real session token that Better Auth will recognize
export const LOCAL_SESSION_ID = "00000000-0000-0000-0000-000000000001";
export const LOCAL_SESSION_TOKEN = "local-session-token-for-development";

/**
 * Ensure the local user and session exist in the database
 * This creates a real Better Auth session so OAuth flows work properly
 */
export async function ensureLocalUserExists(): Promise<void> {
  if (!isLocalMode()) return;

  try {
    // Check if local user exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, LOCAL_USER.id),
    });

    if (!existingUser) {
      // Create the local user
      await db.insert(users).values({
        id: LOCAL_USER.id,
        name: LOCAL_USER.name,
        email: LOCAL_USER.email,
        emailVerified: LOCAL_USER.emailVerified,
        image: LOCAL_USER.image,
        hasCompletedOnboarding: true,
      }).onConflictDoNothing();
      
      console.log('[auth] Created local user in database');
    }

    // Check if local session exists
    const existingSession = await db.query.sessions.findFirst({
      where: eq(sessions.id, LOCAL_SESSION_ID),
    });

    if (!existingSession) {
      // Create a real session in the database that Better Auth will recognize
      await db.insert(sessions).values({
        id: LOCAL_SESSION_ID,
        userId: LOCAL_USER.id,
        token: LOCAL_SESSION_TOKEN,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10), // 10 years
        ipAddress: "127.0.0.1",
        userAgent: "Hatchway Local Mode",
      }).onConflictDoNothing();
      
      console.log('[auth] Created local session in database');
    } else {
      // Update expiry to keep session fresh
      await db.update(sessions)
        .set({ 
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, LOCAL_SESSION_ID));
    }
  } catch (error) {
    console.error('[auth] Failed to ensure local user exists:', error);
  }
}

export const LOCAL_SESSION = {
  user: LOCAL_USER,
  session: {
    id: LOCAL_SESSION_ID,
    userId: LOCAL_USER.id,
    token: LOCAL_SESSION_TOKEN,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365), // 1 year
    ipAddress: "127.0.0.1",
    userAgent: "Hatchway Local Mode",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
} as const;

/**
 * Check if running in local mode
 */
export function isLocalMode(): boolean {
  return process.env.HATCHWAY_LOCAL_MODE === "true";
}

/**
 * Get the current session from the request
 * Returns LOCAL_SESSION in local mode, otherwise checks better-auth session
 */
export async function getSession() {
  if (isLocalMode()) {
    return LOCAL_SESSION;
  }

  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  return session;
}

/**
 * Require authentication - throws if not authenticated
 * Returns the session if authenticated
 */
export async function requireAuth() {
  const session = await getSession();

  if (!session) {
    throw new AuthError("Unauthorized", 401);
  }

  return session;
}

/**
 * Get user ID from session, or null if not authenticated
 */
export async function getUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.id ?? null;
}

/**
 * The single source of truth for "may this user access this project".
 * In local mode, everything is allowed. Projects without an owner (legacy
 * rows) are accessible to any authenticated user; otherwise the owner must
 * match. Used by both the HTTP routes (requireProjectOwnership) and the
 * WebSocket auth path so the two can never diverge.
 */
export function isProjectAccessibleBy(
  project: { userId: string | null },
  userId: string
): boolean {
  if (isLocalMode()) return true;
  if (!project.userId) return true; // legacy null-owner row
  return project.userId === userId;
}

/**
 * Verify that the current user owns the project
 * In local mode, always returns the project (no ownership check)
 * For projects without userId (legacy), allows access if user is authenticated
 */
export async function requireProjectOwnership(projectId: string) {
  const session = await requireAuth();
  const userId = session.user.id;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) {
    throw new AuthError("Project not found", 404);
  }

  if (!isProjectAccessibleBy(project, userId)) {
    throw new AuthError("Forbidden", 403);
  }

  return { project, session };
}

/**
 * Hash a runner key for storage/lookup
 */
export function hashRunnerKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a new runner key
 * Format: sv_<32 random hex characters>
 */
export function generateRunnerKey(): string {
  const randomBytes = createHash("sha256")
    .update(crypto.randomUUID() + Date.now().toString())
    .digest("hex")
    .substring(0, 32);
  return `sv_${randomBytes}`;
}

/**
 * Get the key prefix for display (first 12 chars including sv_)
 */
export function getKeyPrefix(key: string): string {
  return key.substring(0, 12) + "...";
}

/**
 * Authenticate a runner by its key
 * Returns the user ID associated with the key, or null if invalid
 */
export async function authenticateRunnerKey(key: string): Promise<{
  userId: string;
  keyId: string;
} | null> {
  // In local mode, runner auth is not required
  if (isLocalMode()) {
    return {
      userId: LOCAL_USER.id,
      keyId: "local",
    };
  }

  if (!key || !key.startsWith("sv_")) {
    return null;
  }

  const keyHash = hashRunnerKey(key);

  const runnerKey = await db.query.runnerKeys.findFirst({
    where: and(
      eq(runnerKeys.keyHash, keyHash),
      isNull(runnerKeys.revokedAt)
    ),
  });

  if (!runnerKey) {
    return null;
  }

  // Update last used timestamp
  // We await this to ensure it completes in serverless environments
  // but catch errors to avoid failing auth if the update fails
  try {
    await db.update(runnerKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(runnerKeys.id, runnerKey.id))
      .execute();
  } catch {
    // Log but don't fail auth if timestamp update fails
    console.warn(`[auth] Failed to update lastUsedAt for runner key ${runnerKey.id}`);
  }

  return {
    userId: runnerKey.userId,
    keyId: runnerKey.id,
  };
}

/**
 * Extract runner key from Authorization header
 * Only extracts tokens that are runner keys (prefixed with "sv_")
 * Returns null for other tokens (e.g., shared secrets) so they can be handled separately
 */
export function extractRunnerKey(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;

  // Support both "Bearer sv_xxx" and just "sv_xxx"
  if (authHeader.startsWith("Bearer sv_")) {
    return authHeader.substring(7); // Returns "sv_xxx"
  }

  if (authHeader.startsWith("sv_")) {
    return authHeader;
  }

  // Not a runner key (could be shared secret or other token)
  return null;
}

/**
 * Authenticate a runner request (for runner process APIs)
 * Accepts either:
 * - Runner key (sv_xxx) - validated against database
 * - Shared secret - validated against RUNNER_SHARED_SECRET env var
 * 
 * Returns true if authenticated, false otherwise
 */
export async function authenticateRunnerRequest(request: Request): Promise<boolean> {
  // In local mode, always allow
  if (isLocalMode()) {
    return true;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  // Extract token from Bearer header or raw token
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.substring(7)
    : authHeader;

  if (!token) {
    return false;
  }

  // Check if it's a runner key
  if (token.startsWith("sv_")) {
    const result = await authenticateRunnerKey(token);
    return result !== null;
  }

  // Fall back to shared secret check
  const sharedSecret = process.env.RUNNER_SHARED_SECRET;
  if (sharedSecret && timingSafeEqualString(token, sharedSecret)) {
    return true;
  }

  return false;
}

/**
 * Gate operational/maintenance endpoints (cleanup, reconcile, processes).
 * These expose or mutate cross-tenant state, so a user session is NOT enough.
 * Allowed when:
 * - running in local mode, or
 * - the request carries a Bearer token matching OPS_SECRET (for cron/automation)
 *
 * NOTE for operators: in hosted mode these endpoints are fail-closed. If
 * OPS_SECRET is unset, they return 401 for everyone (including any cron that
 * previously called them unauthenticated). Set OPS_SECRET and send it as
 * `Authorization: Bearer <OPS_SECRET>` to re-enable automated cleanup.
 */
export async function requireOperationalAccess(request: Request): Promise<void> {
  if (isLocalMode()) {
    return;
  }

  const opsSecret = process.env.OPS_SECRET;
  if (!opsSecret) {
    console.warn(
      "[auth] Operational endpoint blocked: OPS_SECRET is not set. " +
      "Set OPS_SECRET to allow authenticated cron/ops access."
    );
  }
  const authHeader = request.headers.get("Authorization");
  if (opsSecret && authHeader) {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : authHeader;
    if (timingSafeEqualString(token, opsSecret)) {
      return;
    }
  }

  throw new AuthError("Unauthorized", 401);
}

/**
 * Custom error class for auth errors
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Handle auth errors in API routes
 * Returns a Response for AuthError, or null for other errors to allow
 * specific error handling to continue
 */
export function handleAuthError(error: unknown): Response | null {
  if (error instanceof AuthError) {
    return Response.json(
      { error: error.message },
      { status: error.statusCode }
    );
  }

  // Return null for non-auth errors so specific error handling can continue
  return null;
}
