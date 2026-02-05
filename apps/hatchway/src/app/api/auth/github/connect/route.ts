import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth-helpers';

/**
 * GET /api/auth/github/connect
 * 
 * Initiates GitHub OAuth flow for connecting GitHub to create repositories.
 * Stores pending action in cookie, then redirects to client page that uses
 * Better Auth's signIn.oauth2() - this works for both local and hosted mode.
 * 
 * In local mode: Better Auth will "sign in" as GitHub user (we don't care,
 * we just want the token stored in the accounts table)
 * 
 * Query params:
 * - returnUrl: URL to redirect to after OAuth (defaults to /)
 * - visibility: 'public' | 'private' - the repo visibility to create after auth
 * - projectId: The project to create the repo for
 */
export async function GET(req: Request) {
  // Ensure user is authenticated (works in local mode too)
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const returnUrl = url.searchParams.get('returnUrl') || '/';
  const visibility = url.searchParams.get('visibility') || 'public';
  const projectId = url.searchParams.get('projectId') || '';

  // Store pending action in a cookie so we can complete it after OAuth
  const pendingData = JSON.stringify({
    userId: session.user.id,
    returnUrl,
    visibility,
    projectId,
    timestamp: Date.now(),
  });

  const cookieStore = await cookies();
  cookieStore.set('github_connect_pending', pendingData, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  });

  // Redirect to client page that uses Better Auth's signIn.oauth2()
  // This handles state storage properly via Better Auth
  const oauthPageUrl = new URL('/auth/github-connect', url.origin);
  oauthPageUrl.searchParams.set('returnUrl', returnUrl);
  oauthPageUrl.searchParams.set('visibility', visibility);
  oauthPageUrl.searchParams.set('projectId', projectId);

  return NextResponse.redirect(oauthPageUrl.toString());
}
