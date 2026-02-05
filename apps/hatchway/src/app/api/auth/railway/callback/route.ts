import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@hatchway/agent-core';
import { railwayConnections } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, handleAuthError } from '@/lib/auth-helpers';
import {
  exchangeCodeForTokens,
  getUserInfo,
  deserializeOAuthState,
} from '@/lib/railway/oauth';
import { encryptToken } from '@/lib/railway/encryption';
import type { RailwayWorkspace } from '@/lib/railway/types';

// Cookie name for OAuth state
const RAILWAY_OAUTH_STATE_COOKIE = 'railway_oauth_state';

/**
 * GET /api/auth/railway/callback
 * Handles the OAuth callback from Railway
 * 
 * Query params:
 * - code: Authorization code from Railway
 * - state: State parameter for CSRF verification
 * - error: Error code if authorization was denied
 * - error_description: Error description
 */
export async function GET(req: Request) {
  const cookieStore = await cookies();
  
  try {
    // Require authentication
    const session = await requireAuth();
    const userId = session.user.id;

    // Parse query parameters
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Debug logging
    console.log('[Railway OAuth] Callback received:', {
      url: req.url,
      hasCode: !!code,
      hasState: !!state,
      error,
      errorDescription,
      allParams: Object.fromEntries(url.searchParams.entries()),
    });

    // Handle authorization errors
    if (error) {
      console.error('[Railway OAuth] Authorization error:', error, errorDescription);
      const redirectTo = '/?error=railway_auth_denied';
      return NextResponse.redirect(new URL(redirectTo, req.url));
    }

    // Validate code and state
    if (!code || !state) {
      console.error('[Railway OAuth] Missing code or state. Received params:', Object.fromEntries(url.searchParams.entries()));
      return NextResponse.redirect(new URL('/?error=railway_invalid_callback', req.url));
    }

    // Get stored OAuth state from cookie
    const stateCookie = cookieStore.get(RAILWAY_OAUTH_STATE_COOKIE);
    if (!stateCookie) {
      console.error('[Railway OAuth] Missing state cookie');
      return NextResponse.redirect(new URL('/?error=railway_session_expired', req.url));
    }

    // Deserialize and validate state
    const oauthState = deserializeOAuthState(stateCookie.value);
    if (oauthState.state !== state) {
      console.error('[Railway OAuth] State mismatch');
      return NextResponse.redirect(new URL('/?error=railway_state_mismatch', req.url));
    }

    // Clear the state cookie
    cookieStore.delete(RAILWAY_OAUTH_STATE_COOKIE);

    // Determine redirect URI (must match the one used in authorization)
    const baseUrl = process.env.BETTER_AUTH_URL || 
                    process.env.NEXT_PUBLIC_APP_URL || 
                    'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/auth/railway/callback`;

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      code,
      redirectUri,
      oauthState.codeVerifier
    );

    // Get user info from Railway
    const userInfo = await getUserInfo(tokens.access_token);

    // Fetch workspaces to store (requires the token)
    let workspaces: RailwayWorkspace[] = [];
    try {
      const workspacesResponse = await fetch('https://backboard.railway.com/graphql/v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `query { me { workspaces { id name } } }`,
        }),
      });

      if (workspacesResponse.ok) {
        const data = await workspacesResponse.json() as {
          data?: { me: { workspaces: RailwayWorkspace[] } };
        };
        workspaces = data.data?.me?.workspaces || [];
      }
    } catch (err) {
      console.warn('[Railway OAuth] Failed to fetch workspaces:', err);
    }

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Check if user already has a Railway connection
    const existingConnection = await db.query.railwayConnections.findFirst({
      where: eq(railwayConnections.userId, userId),
    });

    if (existingConnection) {
      // Update existing connection
      await db.update(railwayConnections)
        .set({
          accessTokenEncrypted: encryptToken(tokens.access_token),
          refreshTokenEncrypted: tokens.refresh_token 
            ? encryptToken(tokens.refresh_token) 
            : null,
          accessTokenExpiresAt: expiresAt,
          railwayUserId: userInfo.sub,
          railwayEmail: userInfo.email,
          railwayName: userInfo.name,
          grantedWorkspaces: workspaces,
          defaultWorkspaceId: workspaces[0]?.id || existingConnection.defaultWorkspaceId,
          defaultWorkspaceName: workspaces[0]?.name || existingConnection.defaultWorkspaceName,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(railwayConnections.userId, userId));
    } else {
      // Create new connection
      await db.insert(railwayConnections).values({
        userId,
        accessTokenEncrypted: encryptToken(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token 
          ? encryptToken(tokens.refresh_token) 
          : null,
        accessTokenExpiresAt: expiresAt,
        railwayUserId: userInfo.sub,
        railwayEmail: userInfo.email,
        railwayName: userInfo.name,
        grantedWorkspaces: workspaces,
        defaultWorkspaceId: workspaces[0]?.id,
        defaultWorkspaceName: workspaces[0]?.name,
        status: 'active',
      });
    }

    // Redirect to the original destination
    const redirectTo = oauthState.redirectTo || '/';
    const successUrl = new URL(redirectTo, req.url);
    successUrl.searchParams.set('railway_connected', 'true');
    
    return NextResponse.redirect(successUrl);
  } catch (error) {
    // Clean up cookie on error
    cookieStore.delete(RAILWAY_OAUTH_STATE_COOKIE);

    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway OAuth] Callback error:', error);
    return NextResponse.redirect(new URL('/?error=railway_callback_failed', req.url));
  }
}
