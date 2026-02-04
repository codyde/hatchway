import { useQuery } from '@tanstack/react-query';

export interface RunnerConnection {
  runnerId: string;
  lastHeartbeat: number;
}

interface RunnerStatusResponse {
  connections: RunnerConnection[];
}

async function fetchRunnerStatus(): Promise<RunnerStatusResponse> {
  const res = await fetch('/api/runner/status');
  if (!res.ok) {
    throw new Error('Failed to fetch runner status');
  }
  return res.json();
}

export function useRunnerStatus() {
  return useQuery({
    queryKey: ['runner', 'status'],
    queryFn: fetchRunnerStatus,
    refetchInterval: 10000, // Poll every 10 seconds
    staleTime: 9000, // Consider data stale after 9 seconds
    refetchOnWindowFocus: true,
  });
}
