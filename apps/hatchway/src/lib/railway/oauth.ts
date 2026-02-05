import { createHash, randomBytes } from 'crypto';
import type { RailwayTokenResponse, RailwayUserInfo, RailwayOAuthState } from './types';

// Railway OAuth endpoints
const RAILWAY_AUTH_URL = 'https://backboard.railway.com/oauth/auth';
const RAILWAY_TOKEN_URL = 'https://backboard.railway.com/oauth/token';
const RAILWAY_USER_INFO_URL = 'https://backboard.railway.com/oauth/me';

/**
 * Get Railway OAuth client credentials
 */
function getClientCredentials() {
  const clientId = process.env.RAILWAY_OAUTH_CLIENT_ID;
  const clientSecret = process.env.RAILWAY_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Railway OAuth not configured. Set RAILWAY_OAUTH_CLIENT_ID and RAILWAY_OAUTH_CLIENT_SECRET environment variables.'
    );
  }

  return { clientId, clientSecret };
}

/**
 * Generate a random state string for CSRF protection
 */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate PKCE code verifier and challenge
 * Code verifier: random 43-128 character string
 * Code challenge: base64url(sha256(verifier))
 */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  // Generate random verifier (64 bytes = 128 hex chars, truncate to 64)
  const codeVerifier = randomBytes(32).toString('hex');

  // Generate challenge: base64url(sha256(verifier))
  const hash = createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return { codeVerifier, codeChallenge };
}

/**
 * Build the Railway OAuth authorization URL
 */
export function buildAuthorizationUrl(
  redirectUri: string,
  state: string,
  codeChallenge: string,
  scopes: string[] = ['openid', 'email', 'profile', 'workspace:member', 'offline_access']
): string {
  const { clientId } = getClientCredentials();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Always show consent screen so users can select workspaces
    prompt: 'consent',
  });

  return `${RAILWAY_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<RailwayTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();

  // Use Basic auth for client credentials
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(RAILWAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Railway OAuth] Token exchange failed:', errorText);
    throw new Error(`Failed to exchange code for tokens: ${response.status}`);
  }

  return response.json();
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<RailwayTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(RAILWAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Railway OAuth] Token refresh failed:', errorText);
    throw new Error(`Failed to refresh token: ${response.status}`);
  }

  return response.json();
}

/**
 * Get user info from Railway
 */
export async function getUserInfo(accessToken: string): Promise<RailwayUserInfo> {
  const response = await fetch(RAILWAY_USER_INFO_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  return response.json();
}

/**
 * Create OAuth state object to store in cookie
 */
export function createOAuthState(redirectTo?: string): RailwayOAuthState {
  const state = generateState();
  const { codeVerifier } = generatePKCE();

  return {
    state,
    codeVerifier,
    redirectTo,
  };
}

/**
 * Serialize OAuth state for cookie storage
 */
export function serializeOAuthState(oauthState: RailwayOAuthState): string {
  return Buffer.from(JSON.stringify(oauthState)).toString('base64');
}

/**
 * Deserialize OAuth state from cookie
 */
export function deserializeOAuthState(serialized: string): RailwayOAuthState {
  return JSON.parse(Buffer.from(serialized, 'base64').toString('utf8'));
}

/**
 * Check if Railway OAuth is configured
 */
export function isRailwayOAuthConfigured(): boolean {
  return !!(
    process.env.RAILWAY_OAUTH_CLIENT_ID &&
    process.env.RAILWAY_OAUTH_CLIENT_SECRET
  );
}
