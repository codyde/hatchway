import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@hatchway/agent-core';
import { githubConnections } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isLocalMode, LOCAL_USER } from '@/lib/auth-helpers';
import { encryptToken, isEncryptionConfigured } from '@/lib/encryption';

/**
 * GET /api/auth/github/callback
 * 
 * Custom GitHub OAuth callback for local mode.
 * Exchanges the code for a token and stores it in github_connections.
 * 
 * This bypasses Better Auth entirely for local mode GitHub connections.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Get pending data from cookie
  const cookieStore = await cookies();
  const pendingCookie = cookieStore.get('github_connect_pending');

  let pendingData: {
    userId: string;
    returnUrl: string;
    visibility: string;
    projectId: string;
    state: string;
    timestamp: number;
  } | null = null;

  if (pendingCookie) {
    try {
      pendingData = JSON.parse(pendingCookie.value);
    } catch {
      // Invalid cookie
    }
  }

  // Build redirect URL for errors/success
  const baseReturnUrl = pendingData?.returnUrl || '/';
  const projectId = pendingData?.projectId || '';
  const visibility = pendingData?.visibility || 'public';

  // Handle OAuth errors
  if (error) {
    console.error('[github/callback] OAuth error:', error, errorDescription);
    const errorUrl = new URL(baseReturnUrl, url.origin);
    errorUrl.searchParams.set('github_error', errorDescription || error);
    return NextResponse.redirect(errorUrl.toString());
  }

  // Verify state
  if (!state || !pendingData || state !== pendingData.state) {
    console.error('[github/callback] State mismatch');
    const errorUrl = new URL(baseReturnUrl, url.origin);
    errorUrl.searchParams.set('github_error', 'Invalid state - please try again');
    return NextResponse.redirect(errorUrl.toString());
  }

  // Check for code
  if (!code) {
    console.error('[github/callback] No code received');
    const errorUrl = new URL(baseReturnUrl, url.origin);
    errorUrl.searchParams.set('github_error', 'No authorization code received');
    return NextResponse.redirect(errorUrl.toString());
  }

  try {
    // Exchange code for access token
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('GitHub OAuth not configured');
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to get access token');
    }

    const accessToken = tokenData.access_token;

    // Fetch GitHub user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch GitHub user info');
    }

    const githubUser = await userResponse.json() as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
    };

    // Get user ID (local mode uses LOCAL_USER)
    const userId = isLocalMode() ? LOCAL_USER.id : pendingData.userId;

    // Encrypt the token for storage
    const encryptedToken = isEncryptionConfigured()
      ? encryptToken(accessToken)
      : accessToken;

    // Upsert into github_connections
    const existing = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(githubConnections)
        .set({
          accessTokenEncrypted: encryptedToken,
          githubUserId: githubUser.id.toString(),
          githubUsername: githubUser.login,
          githubAvatarUrl: githubUser.avatar_url,
          scopes: tokenData.scope || 'read:user,user:email,repo',
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(githubConnections.userId, userId));
    } else {
      await db.insert(githubConnections).values({
        userId,
        accessTokenEncrypted: encryptedToken,
        githubUserId: githubUser.id.toString(),
        githubUsername: githubUser.login,
        githubAvatarUrl: githubUser.avatar_url,
        scopes: tokenData.scope || 'read:user,user:email,repo',
        status: 'active',
      });
    }

    console.log('[github/callback] Successfully connected GitHub for user:', githubUser.login);

    // Clear the pending cookie
    cookieStore.delete('github_connect_pending');

    // Redirect back with success params
    const successUrl = new URL(baseReturnUrl, url.origin);
    successUrl.searchParams.set('github_connect_pending', 'true');
    successUrl.searchParams.set('projectId', projectId);
    successUrl.searchParams.set('visibility', visibility);

    return NextResponse.redirect(successUrl.toString());
  } catch (err) {
    console.error('[github/callback] Error:', err);
    const errorUrl = new URL(baseReturnUrl, url.origin);
    errorUrl.searchParams.set('github_error', err instanceof Error ? err.message : 'Failed to connect GitHub');
    return NextResponse.redirect(errorUrl.toString());
  }
}
