import { useQuery } from '@tanstack/react-query';
import type { GitHubStatus } from '@hatchway/agent-core';

interface GitHubStatusResponse {
  status: GitHubStatus;
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
 * Helper to check if GitHub is connected
 */
export function useIsGitHubConnected(projectId: string | undefined | null): boolean {
  const { data } = useGitHubStatus(projectId);
  return data?.isConnected ?? false;
}
