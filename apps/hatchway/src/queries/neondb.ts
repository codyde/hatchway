import { useQuery } from '@tanstack/react-query';
import type { NeonDBStatus } from '@hatchway/agent-core';

interface NeonDBStatusResponse {
  status: NeonDBStatus;
}

async function fetchNeonDBStatus(projectId: string): Promise<NeonDBStatusResponse> {
  const res = await fetch(`/api/projects/${projectId}/neondb`);

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch NeonDB status');
  }

  return res.json();
}

/**
 * Hook to fetch NeonDB integration status for a project
 */
export function useNeonDBStatus(projectId: string | undefined | null) {
  return useQuery({
    queryKey: ['projects', projectId, 'neondb'],
    queryFn: () => fetchNeonDBStatus(projectId!),
    enabled: !!projectId,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
    select: (data) => data.status,
  });
}

/**
 * Helper to check if NeonDB is connected
 */
export function useIsNeonDBConnected(projectId: string | undefined | null): boolean {
  const { data } = useNeonDBStatus(projectId);
  return data?.isConnected ?? false;
}
