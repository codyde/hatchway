import { useQuery } from '@tanstack/react-query';
import type { GitHubStatus } from '@hatchway/agent-core';

interface GitHubStatusResponse {
  status: GitHubStatus;
}

/**
 * GitHub connection status for the current user
 */
export interface GitHubConnection {
  connected: boolean;
  username?: string;
  avatarUrl?: string;
  hasRepoScope?: boolean;
  needsReauth?: boolean;
}

async function fetchGitHubStatus(projectId: string): Promise<GitHubStatusResponse> {
  const res = await fetch(`/api/projects/${projectId}/github`);

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch GitHub status');
  }

  return res.json();
}

/**
 * Hook to fetch GitHub integration status for a project
 */
export function useGitHubStatus(projectId: string | undefined | null) {
  return useQuery({
    queryKey: ['projects', projectId, 'github'],
    queryFn: () => fetchGitHubStatus(projectId!),
    enabled: !!projectId,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
    select: (data) => data.status,
  });
}

/**
 * Helper to check if GitHub is connected for a project
 */
export function useIsGitHubConnected(projectId: string | undefined | null): boolean {
  const { data } = useGitHubStatus(projectId);
  return data?.isConnected ?? false;
}

/**
 * Fetch the current user's GitHub connection status
 */
async function fetchGitHubConnection(): Promise<GitHubConnection> {
  const res = await fetch('/api/user/github');

  if (!res.ok) {
    // Return disconnected on error
    return { connected: false };
  }

  return res.json();
}

/**
 * Hook to check if the current user has GitHub connected
 * This checks the user's OAuth account, not a specific project
 */
export function useGitHubConnection() {
  return useQuery({
    queryKey: ['user', 'github-connection'],
    queryFn: fetchGitHubConnection,
    staleTime: 5 * 60 * 1000, // 5 minutes - connection status rarely changes
    refetchOnWindowFocus: false,
  });
}
