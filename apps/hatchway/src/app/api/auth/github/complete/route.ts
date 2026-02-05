import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@hatchway/agent-core';
import { accounts, githubConnections } from '@hatchway/agent-core/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getSession, isLocalMode, LOCAL_USER } from '@/lib/auth-helpers';
import { encryptToken, decryptToken, isEncryptionConfigured } from '@/lib/encryption';

/**
 * POST /api/auth/github/complete
 * 
 * Completes the GitHub connection flow after OAuth.
 * This copies the GitHub token from better-auth's accounts table
 * to our github_connections table for the current user.
 * 
 * This is called after the user returns from GitHub OAuth.
 */
export async function POST(req: Request) {
  try {
    // Get current session (works in local mode too)
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    
    // Check for pending connect action
    const cookieStore = await cookies();
    const pendingCookie = cookieStore.get('github_connect_pending');
    
    let pendingData: { 
      userId: string; 
      returnUrl: string; 
      visibility: string; 
      projectId: string; 
      timestamp: number 
    } | null = null;
    
    if (pendingCookie) {
      try {
        pendingData = JSON.parse(pendingCookie.value);
        // Clear the cookie
        cookieStore.delete('github_connect_pending');
      } catch {
        // Invalid cookie data
      }
    }

    // In local mode, check github_connections first since our custom callback populates it directly
    if (isLocalMode()) {
      const existingConnection = await db
        .select()
        .from(githubConnections)
        .where(eq(githubConnections.userId, userId))
        .limit(1);

      if (existingConnection.length > 0) {
        console.log('[github/complete] Local mode: Found existing github_connections entry');
        return NextResponse.json({
          success: true,
          connected: true,
          githubUsername: existingConnection[0].githubUsername,
          pendingAction: pendingData ? {
            projectId: pendingData.projectId,
            visibility: pendingData.visibility,
          } : null,
        });
      }
    }

    // Find the GitHub account in better-auth's accounts table
    // First try to find one linked to the current user
    let githubAccount = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.providerId, 'github')
        )
      )
      .limit(1);

    // In local mode, if no account found for local user, look for ANY recent GitHub account
    // This handles the case where Better Auth created a new user during OAuth
    if ((!githubAccount || githubAccount.length === 0) && isLocalMode()) {
      console.log('[github/complete] Local mode: looking for any recent GitHub account...');
      
      // Find the most recently created GitHub account
      githubAccount = await db
        .select()
        .from(accounts)
        .where(eq(accounts.providerId, 'github'))
        .orderBy(desc(accounts.createdAt))
        .limit(1);
      
      if (githubAccount && githubAccount.length > 0) {
        console.log('[github/complete] Found GitHub account from user:', githubAccount[0].userId);
        
        // Update the account to be owned by the local user
        await db
          .update(accounts)
          .set({ userId: LOCAL_USER.id })
          .where(eq(accounts.id, githubAccount[0].id));
        
        console.log('[github/complete] Reassigned GitHub account to local user');
      }
    }

    if (!githubAccount || githubAccount.length === 0) {
      return NextResponse.json(
        { error: 'No GitHub account found. Please sign in with GitHub first.' },
        { status: 404 }
      );
    }

    const account = githubAccount[0];
    
    if (!account.accessToken) {
      return NextResponse.json(
        { error: 'No GitHub access token found' },
        { status: 400 }
      );
    }

    // Decrypt the token if it's encrypted (better-auth encrypts tokens)
    let accessToken = account.accessToken;
    if (isEncryptionConfigured() && accessToken.includes(':')) {
      try {
        accessToken = decryptToken(accessToken);
      } catch {
        // Token may not be encrypted, use as-is
      }
    }

    // Fetch GitHub user info to store with the connection
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to verify GitHub token' },
        { status: 400 }
      );
    }

    const githubUser = await userResponse.json() as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
    };

    // Encrypt the token for storage in github_connections
    const encryptedToken = isEncryptionConfigured() 
      ? encryptToken(accessToken)
      : accessToken;

    // Upsert into github_connections
    // Check if connection already exists
    const existing = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      // Update existing connection
      await db
        .update(githubConnections)
        .set({
          accessTokenEncrypted: encryptedToken,
          githubUserId: githubUser.id.toString(),
          githubUsername: githubUser.login,
          githubAvatarUrl: githubUser.avatar_url,
          scopes: 'read:user,user:email,repo',
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(githubConnections.userId, userId));
    } else {
      // Create new connection
      await db.insert(githubConnections).values({
        userId,
        accessTokenEncrypted: encryptedToken,
        githubUserId: githubUser.id.toString(),
        githubUsername: githubUser.login,
        githubAvatarUrl: githubUser.avatar_url,
        scopes: 'read:user,user:email,repo',
        status: 'active',
      });
    }

    return NextResponse.json({
      success: true,
      connected: true,
      githubUsername: githubUser.login,
      pendingAction: pendingData ? {
        projectId: pendingData.projectId,
        visibility: pendingData.visibility,
      } : null,
    });
  } catch (error) {
    console.error('Error completing GitHub connection:', error);
    return NextResponse.json(
      { error: 'Failed to complete GitHub connection' },
      { status: 500 }
    );
  }
}
