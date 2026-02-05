import { NextResponse } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/auth-helpers';
import { getGitHubConnectionStatus, type GitHubConnection } from '@/lib/github';

/**
 * GET /api/user/github
 * Check if the current user has GitHub connected and has required permissions
 */
export async function GET(): Promise<NextResponse<GitHubConnection>> {
  try {
    const session = await requireAuth();
    
    const status = await getGitHubConnectionStatus(session.user.id);
    
    return NextResponse.json(status);
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) {
      return authResponse as NextResponse<GitHubConnection>;
    }
    
    console.error('Error checking GitHub connection:', error);
    return NextResponse.json({ 
      connected: false,
    }, { status: 500 });
  }
}
