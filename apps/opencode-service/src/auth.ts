/**
 * Authentication helpers for OpenCode Service
 *
 * Validates runner keys and shared secrets for API access.
 * Integrates with the existing Hatchway auth system.
 */

import { createHash } from 'crypto';
import { db } from '@hatchway/agent-core';
import { runnerKeys } from '@hatchway/agent-core/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Check if running in local mode
 */
export function isLocalMode(): boolean {
  return process.env.HATCHWAY_LOCAL_MODE === 'true';
}

/**
 * Hash a runner key for lookup
 */
export function hashRunnerKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Result of runner key authentication
 */
export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  keyId?: string;
  error?: string;
}

/**
 * Authenticate a runner key against the database
 */
export async function authenticateRunnerKey(key: string): Promise<AuthResult> {
  // Local mode - always allow
  if (isLocalMode()) {
    return {
      authenticated: true,
      userId: '00000000-0000-0000-0000-000000000000',
      keyId: 'local',
    };
  }

  if (!key || !key.startsWith('sv_')) {
    return {
      authenticated: false,
      error: 'Invalid runner key format',
    };
  }

  try {
    const keyHash = hashRunnerKey(key);
    
    // Query the runner_keys table using drizzle ORM
    const result = await db
      .select({
        id: runnerKeys.id,
        userId: runnerKeys.userId,
      })
      .from(runnerKeys)
      .where(
        and(
          eq(runnerKeys.keyHash, keyHash),
          isNull(runnerKeys.revokedAt)
        )
      )
      .limit(1);

    if (result.length > 0) {
      const row = result[0];
      
      // Update last used timestamp (fire and forget)
      db.update(runnerKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(runnerKeys.id, row.id))
        .catch(() => {
          // Ignore update errors
        });

      return {
        authenticated: true,
        userId: row.userId,
        keyId: row.id,
      };
    }

    return {
      authenticated: false,
      error: 'Invalid or revoked runner key',
    };
  } catch (error) {
    console.error('[hatchway-opencode-service] Error validating runner key:', error);
    return {
      authenticated: false,
      error: 'Failed to validate runner key',
    };
  }
}

/**
 * Extract runner key from request headers
 */
export function extractRunnerKey(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers['authorization'];
  if (!authHeader) return null;

  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth) return null;

  // Support both "Bearer sv_xxx" and just "sv_xxx"
  if (auth.startsWith('Bearer sv_')) {
    return auth.substring(7);
  }

  if (auth.startsWith('sv_')) {
    return auth;
  }

  return null;
}

/**
 * Extract token (any format) from request headers
 */
export function extractToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers['authorization'];
  if (!authHeader) return null;

  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth) return null;

  // Remove Bearer prefix if present
  if (auth.startsWith('Bearer ')) {
    return auth.substring(7);
  }

  return auth;
}

/**
 * Authenticate a request
 * 
 * Accepts:
 * - Runner key (sv_xxx) - validated against database
 * - Shared secret - validated against RUNNER_SHARED_SECRET env var
 * - Local mode - always allows
 */
export async function authenticateRequest(
  headers: Record<string, string | string[] | undefined>
): Promise<AuthResult> {
  // Local mode - always allow
  if (isLocalMode()) {
    return {
      authenticated: true,
      userId: '00000000-0000-0000-0000-000000000000',
    };
  }

  // Try runner key first
  const runnerKey = extractRunnerKey(headers);
  if (runnerKey) {
    return authenticateRunnerKey(runnerKey);
  }

  // Fall back to shared secret
  const token = extractToken(headers);
  const sharedSecret = process.env.RUNNER_SHARED_SECRET;

  if (sharedSecret && token === sharedSecret) {
    return {
      authenticated: true,
    };
  }

  return {
    authenticated: false,
    error: 'No valid authentication provided',
  };
}
