import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Project } from '@/queries/projects';

/**
 * Hook to connect to SSE status stream for real-time project updates
 * Automatically invalidates TanStack Query cache when project status changes
 *
 * @param projectId - The project ID to watch for updates
 * @param enabled - Whether to connect to SSE (default: true)
 */
export function useProjectStatusSSE(projectId: string | undefined | null, enabled: boolean = true) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Don't connect if disabled, no project ID, or not in browser (SSR)
    if (!enabled || !projectId || typeof window === 'undefined') {
      return;
    }

    console.log(`📡 [SSE] Connecting to status stream for project: ${projectId}`);

    // Create EventSource connection (browser only)
    const eventSource = new EventSource(`/api/projects/${projectId}/status-stream`);
    eventSourceRef.current = eventSource;

    // Handle connection open
    eventSource.addEventListener('open', () => {
      console.log(`✅ [SSE] Connected to status stream for ${projectId}`);
    });

    // Handle status updates
    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          console.log(`🔗 [SSE] Status stream connected for ${projectId}`);
          return;
        }

        if (data.type === 'status-update' && data.project) {

          // Update per-project cache directly (optimistic real-time update)
          queryClient.setQueryData<Project>(['projects', projectId], (old) => {
            const base = old ?? ({} as Project);
            return {
              ...base,
              ...data.project,
              // Ensure we preserve existing Date instances
              createdAt: base.createdAt ?? new Date(data.project.createdAt),
              updatedAt: new Date(data.project.updatedAt),
              lastActivityAt: data.project.lastActivityAt
                ? new Date(data.project.lastActivityAt)
                : null,
              // STICKY FRAMEWORK: Don't overwrite existing framework with null
              detectedFramework: data.project.detectedFramework || base.detectedFramework || null,
              // RUNNER STATUS: Use the enriched value from SSE, fall back to cached value
              runnerConnected: data.project.runnerConnected ?? base.runnerConnected ?? false,
            };
          });

          // Keep the projects list cache aligned (sidebar, preview, etc.)
          queryClient.setQueryData<{ projects: Project[] }>(['projects'], (old) => {
            if (!old) return old;
            const nextProjects = old.projects.map((proj) =>
              proj.id === data.project.id
                ? {
                    ...proj,
                    ...data.project,
                    createdAt: proj.createdAt,
                    updatedAt: new Date(data.project.updatedAt),
                    lastActivityAt: data.project.lastActivityAt
                      ? new Date(data.project.lastActivityAt)
                      : null,
                    // RUNNER STATUS: Use the enriched value from SSE, fall back to cached value
                    runnerConnected: data.project.runnerConnected ?? proj.runnerConnected ?? false,
                  }
                : proj
            );
            return { projects: nextProjects };
          });

          // Mark queries as stale so active observers refetch if needed
          queryClient.invalidateQueries({
            queryKey: ['projects'],
            refetchType: 'active',
          });
          queryClient.invalidateQueries({
            queryKey: ['projects', projectId],
            refetchType: 'active',
          });
        }
      } catch (error) {
        console.error(`❌ [SSE] Error parsing status update for ${projectId}:`, error);
      }
    });

    // Handle errors
    eventSource.addEventListener('error', (error) => {
      console.error(`❌ [SSE] Connection error for ${projectId}:`, error);

      // EventSource will automatically attempt to reconnect
      // We'll just log the error and let it handle reconnection

      // If the connection fails completely, we can fallback to polling
      // TanStack Query will continue to refetch based on refetchInterval

      // Force a refetch so UI can reconcile once connection comes back
      queryClient.invalidateQueries({ queryKey: ['projects'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId], refetchType: 'active' });
    });

    // Cleanup on unmount or when projectId changes
    return () => {
      console.log(`🔌 [SSE] Disconnecting from status stream for ${projectId}`);
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [projectId, enabled, queryClient]);

  // Return connection status (SSR-safe)
  return {
    isConnected: typeof window !== 'undefined' && eventSourceRef.current?.readyState === 1, // EventSource.OPEN = 1
  };
}
