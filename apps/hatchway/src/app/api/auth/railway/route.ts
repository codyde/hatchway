import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth, handleAuthError } from '@/lib/auth-helpers';
import {
  generateState,
  generatePKCE,
  buildAuthorizationUrl,
  serializeOAuthState,
  isRailwayOAuthConfigured,
} from '@/lib/railway/oauth';
import type { RailwayOAuthState } from '@/lib/railway/types';

// Cookie name for OAuth state
const RAILWAY_OAUTH_STATE_COOKIE = 'railway_oauth_state';

/**
 * GET /api/auth/railway
 * Initiates the Railway OAuth flow
 * 
 * Query params:
 * - redirectTo: Optional URL to redirect after successful auth
 */
export async function GET(req: Request) {
  try {
    // Require authentication - user must be logged in to connect Railway
    await requireAuth();

    // Check if Railway OAuth is configured
    if (!isRailwayOAuthConfigured()) {
      return NextResponse.json(
        { error: 'Railway OAuth is not configured' },
        { status: 503 }
      );
    }

    // Parse redirect URL from query params
    const url = new URL(req.url);
    const redirectTo = url.searchParams.get('redirectTo') || '/';

    // Generate PKCE challenge
    const { codeVerifier, codeChallenge } = generatePKCE();

    // Generate state for CSRF protection
    const state = generateState();

    // Build OAuth state to store in cookie
    const oauthState: RailwayOAuthState = {
      state,
      codeVerifier,
      redirectTo,
    };

    // Determine redirect URI based on environment
    const baseUrl = process.env.BETTER_AUTH_URL || 
                    process.env.NEXT_PUBLIC_APP_URL || 
                    'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/auth/railway/callback`;

    // Build authorization URL
    const authUrl = buildAuthorizationUrl(
      redirectUri,
      state,
      codeChallenge
    );

    // Debug logging
    console.log('[Railway OAuth] Initiating OAuth flow:', {
      redirectUri,
      authUrl,
      clientId: process.env.RAILWAY_OAUTH_CLIENT_ID?.substring(0, 10) + '...',
    });

    // Store state in cookie (httpOnly, secure in production)
    const cookieStore = await cookies();
    cookieStore.set(RAILWAY_OAUTH_STATE_COOKIE, serializeOAuthState(oauthState), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    });

    // Redirect to Railway authorization
    return NextResponse.redirect(authUrl);
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway OAuth] Error initiating OAuth:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Railway OAuth' },
      { status: 500 }
    );
  }
}
