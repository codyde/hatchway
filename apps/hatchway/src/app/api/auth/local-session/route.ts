import { NextResponse } from 'next/server';
import { isLocalMode, LOCAL_SESSION_TOKEN } from '@/lib/auth-helpers';
import { getAuth } from '@/lib/auth';

/**
 * GET /api/auth/local-session
 * 
 * In local mode, creates/refreshes the Better Auth session cookie.
 * This ensures the browser has a valid signed session cookie that
 * Better Auth will recognize.
 */
export async function GET() {
  if (!isLocalMode()) {
    return NextResponse.json(
      { error: 'Only available in local mode' },
      { status: 403 }
    );
  }

  try {
    const auth = getAuth();
    
    // Create a response that will have cookies set
    const response = NextResponse.json({ success: true, localMode: true });
    
    // Use Better Auth's cookie utilities to create a properly signed session cookie
    // The session token in the database is LOCAL_SESSION_TOKEN
    const cookieName = 'better-auth.session_token';
    
    // Set the session cookie (Better Auth will verify it against the sessions table)
    // For local mode, we use a simple token without signing since we control both ends
    const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10); // 10 years
    
    response.cookies.set(cookieName, LOCAL_SESSION_TOKEN, {
      path: '/',
      expires: expiry,
      sameSite: 'lax',
      httpOnly: true,
    });

    return response;
  } catch (error) {
    console.error('[local-session] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create local session' },
      { status: 500 }
    );
  }
}
