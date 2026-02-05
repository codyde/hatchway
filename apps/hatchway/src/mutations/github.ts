import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GitHubStatus, UpdateGitHubSettingsRequest } from '@hatchway/agent-core';

// ============================================================================
// Create GitHub Repository
// ============================================================================

export interface CreateGitHubRepoRequest {
  visibility: 'public' | 'private';
  name?: string;
  description?: string;
}

export interface CreateGitHubRepoResponse {
  success: boolean;
  repo?: string;
  url?: string;
  cloneUrl?: string;
  branch?: string;
  error?: string;
  needsReauth?: boolean;
}

async function createGitHubRepo(
  projectId: string,
  request: CreateGitHubRepoRequest
): Promise<CreateGitHubRepoResponse> {
  const res = await fetch(`/api/projects/${projectId}/github/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const data = await res.json();
  
  // Even on error responses, we want to return the full response
  // so the caller can check needsReauth
  if (!res.ok && !data.needsReauth) {
    throw new Error(data.error || 'Failed to create GitHub repository');
  }

  return data;
}

/**
 * Hook to create a new GitHub repository for a project
 * 
 * Usage:
 * ```
 * const createRepo = useCreateGitHubRepo(projectId);
 * const result = await createRepo.mutateAsync({ visibility: 'public' });
 * if (result.needsReauth) {
 *   // Redirect to GitHub OAuth
 * }
 * ```
 */
export function useCreateGitHubRepo(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateGitHubRepoRequest) =>
      createGitHubRepo(projectId, request),
    onSuccess: (data) => {
      if (data.success) {
        // Update the GitHub status in cache
        queryClient.setQueryData(['projects', projectId, 'github'], { 
          status: {
            isConnected: true,
            repo: data.repo,
            url: data.url,
            branch: data.branch,
            lastPushedAt: null,
            autoPush: false,
            lastSyncAt: null,
            meta: null,
          } 
        });
        // Invalidate project query since GitHub fields are on the project
        queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      }
    },
    onError: (err) => {
      console.error('Failed to create GitHub repository:', err);
    },
  });
}

// ============================================================================
// GitHub Settings
// ============================================================================

interface UpdateGitHubSettingsResult {
  status: GitHubStatus;
}

async function updateGitHubSettings(
  projectId: string,
  settings: UpdateGitHubSettingsRequest
): Promise<UpdateGitHubSettingsResult> {
  const res = await fetch(`/api/projects/${projectId}/github`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to update GitHub settings');
  }

  return res.json();
}

export function useUpdateGitHubSettings(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: UpdateGitHubSettingsRequest) =>
      updateGitHubSettings(projectId, settings),
    onSuccess: (data) => {
      // Update the GitHub status in cache
      queryClient.setQueryData(['projects', projectId, 'github'], { status: data.status });
      // Also invalidate project query since GitHub fields are on the project
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
    onError: (err) => {
      console.error('Failed to update GitHub settings:', err);
    },
  });
}

// ============================================================================
// GitHub Sync
// ============================================================================

interface SyncResult {
  success: boolean;
  message: string;
  commandId: string;
}

async function syncGitHub(projectId: string): Promise<SyncResult> {
  const res = await fetch(`/api/projects/${projectId}/github/sync`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to sync GitHub');
  }

  return res.json();
}

export function useSyncGitHub(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => syncGitHub(projectId),
    onSuccess: () => {
      // Invalidate queries to refetch fresh data after sync
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'github'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
    onError: (err) => {
      console.error('Failed to sync GitHub:', err);
    },
  });
}

// ============================================================================
// Disconnect GitHub
// ============================================================================

interface DisconnectResult {
  success: boolean;
  message: string;
}

async function disconnectGitHub(projectId: string): Promise<DisconnectResult> {
  const res = await fetch(`/api/projects/${projectId}/github`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to disconnect GitHub');
  }

  return res.json();
}

export function useDisconnectGitHub(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => disconnectGitHub(projectId),
    onSuccess: () => {
      // Clear GitHub status from cache
      queryClient.setQueryData(['projects', projectId, 'github'], { 
        status: {
          isConnected: false,
          repo: null,
          url: null,
          branch: null,
          lastPushedAt: null,
          autoPush: false,
          lastSyncAt: null,
          meta: null,
        } 
      });
      // Invalidate project query since GitHub fields are on the project
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
    onError: (err) => {
      console.error('Failed to disconnect GitHub:', err);
    },
  });
}
