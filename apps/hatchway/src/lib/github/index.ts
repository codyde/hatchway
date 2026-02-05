/**
 * GitHub Integration Module
 * 
 * Provides GitHub API client and helper functions for working with
 * GitHub repositories using OAuth tokens stored in the github_connections table.
 */

import { db } from '@hatchway/agent-core';
import { githubConnections } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { decryptToken } from '../encryption';
import { GitHubClient, GitHubAPIError } from './client';

export { GitHubClient, GitHubAPIError } from './client';
export type { GitHubUser, GitHubRepo, CreateRepoOptions } from './client';

/**
 * GitHub connection status for a user
 */
export interface GitHubConnection {
  connected: boolean;
  username?: string;
  avatarUrl?: string;
  hasRepoScope?: boolean;
  needsReauth?: boolean;
}

/**
 * Get the GitHub connection record for a user from github_connections table
 */
export async function getGitHubConnection(userId: string) {
  const [connection] = await db
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId))
    .limit(1);

  return connection || null;
}

/**
 * Get the decrypted GitHub access token for a user
 * Returns null if no GitHub connection exists
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const connection = await getGitHubConnection(userId);
  
  if (!connection?.accessTokenEncrypted) {
    return null;
  }

  // Check if connection is active
  if (connection.status !== 'active') {
    return null;
  }

  // Decrypt the token
  try {
    return decryptToken(connection.accessTokenEncrypted);
  } catch (error) {
    console.error('Failed to decrypt GitHub token:', error);
    return null;
  }
}

/**
 * Get a GitHub client instance for a user
 * Returns null if no GitHub connection exists
 */
export async function getGitHubClient(userId: string): Promise<GitHubClient | null> {
  const token = await getGitHubToken(userId);
  
  if (!token) {
    return null;
  }

  return new GitHubClient(token);
}

/**
 * Get the GitHub connection status for a user
 * Checks if they're connected and if they have the required scopes
 */
export async function getGitHubConnectionStatus(userId: string): Promise<GitHubConnection> {
  const connection = await getGitHubConnection(userId);
  
  if (!connection || connection.status !== 'active') {
    return { connected: false };
  }

  // Check if we have the repo scope stored
  const scopes = connection.scopes?.split(',').map(s => s.trim()) || [];
  const hasRepoScope = scopes.includes('repo') || scopes.includes('public_repo');

  // If we have stored user info, use it without making an API call
  if (connection.githubUsername) {
    return {
      connected: true,
      username: connection.githubUsername,
      avatarUrl: connection.githubAvatarUrl || undefined,
      hasRepoScope,
      needsReauth: !hasRepoScope,
    };
  }

  // Fallback: verify token and get user info from API
  const token = await getGitHubToken(userId);
  if (!token) {
    return { connected: false };
  }

  const client = new GitHubClient(token);
  
  try {
    const [user, actualHasRepoScope] = await Promise.all([
      client.getUser(),
      client.hasRepoScope(),
    ]);

    return {
      connected: true,
      username: user.login,
      avatarUrl: user.avatar_url,
      hasRepoScope: actualHasRepoScope,
      needsReauth: !actualHasRepoScope,
    };
  } catch (error) {
    // Token might be invalid or expired
    if (error instanceof GitHubAPIError && error.status === 401) {
      // Mark connection as expired
      await db
        .update(githubConnections)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(githubConnections.userId, userId));

      return {
        connected: false,
        needsReauth: true,
      };
    }
    throw error;
  }
}

/**
 * Generate a unique repo name if the desired name is taken
 * Appends a number suffix until an available name is found
 */
export async function generateUniqueRepoName(
  client: GitHubClient,
  username: string,
  baseName: string,
  maxAttempts = 10
): Promise<string> {
  // First, try the base name
  const exists = await client.repoExists(username, baseName);
  if (!exists) {
    return baseName;
  }

  // Try with numeric suffixes
  for (let i = 2; i <= maxAttempts; i++) {
    const name = `${baseName}-${i}`;
    const suffixExists = await client.repoExists(username, name);
    if (!suffixExists) {
      return name;
    }
  }

  // If all attempts failed, append a timestamp
  return `${baseName}-${Date.now()}`;
}
