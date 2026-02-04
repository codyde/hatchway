import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@/queries/projects';

// ============================================================================
// Server Operations
// ============================================================================

async function startServer(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/start`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to start server');
  }
}

async function stopServer(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/stop`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to stop server');
  }
}

export function useStartServer(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => startServer(projectId),
    onMutate: async () => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['projects', projectId] });

      // Snapshot previous value
      const previousProject = queryClient.getQueryData<Project>(['projects', projectId]);

      // Optimistically update to starting state
      queryClient.setQueryData<Project>(['projects', projectId], (old) => {
        if (!old) return old;
        return {
          ...old,
          devServerStatus: 'starting' as const,
        };
      });

      return { previousProject };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProject) {
        queryClient.setQueryData(['projects', projectId], context.previousProject);
      }
      console.error('Failed to start server:', err);
    },
    onSuccess: () => {
      // Invalidate queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

export function useStopServer(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => stopServer(projectId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['projects', projectId] });

      const previousProject = queryClient.getQueryData<Project>(['projects', projectId]);

      // Optimistically update to stopping state
      queryClient.setQueryData<Project>(['projects', projectId], (old) => {
        if (!old) return old;
        return {
          ...old,
          devServerStatus: 'stopped' as const,
          devServerPid: null,
          devServerPort: null,
        };
      });

      return { previousProject };
    },
    onError: (err, variables, context) => {
      if (context?.previousProject) {
        queryClient.setQueryData(['projects', projectId], context.previousProject);
      }
      console.error('Failed to stop server:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

// ============================================================================
// Tunnel Operations
// ============================================================================

async function startTunnel(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/start-tunnel`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to start tunnel');
  }
}

async function stopTunnel(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/stop-tunnel`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to stop tunnel');
  }
}

export function useStartTunnel(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => startTunnel(projectId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['projects', projectId] });

      const previousProject = queryClient.getQueryData<Project>(['projects', projectId]);

      // Optimistically update - tunnel is starting
      queryClient.setQueryData<Project>(['projects', projectId], (old) => {
        if (!old) return old;
        return {
          ...old,
          // Note: tunnelUrl will be set by server response
        };
      });

      return { previousProject };
    },
    onError: (err, variables, context) => {
      if (context?.previousProject) {
        queryClient.setQueryData(['projects', projectId], context.previousProject);
      }
      console.error('Failed to start tunnel:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

export function useStopTunnel(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => stopTunnel(projectId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['projects', projectId] });

      const previousProject = queryClient.getQueryData<Project>(['projects', projectId]);

      // Optimistically remove tunnel URL
      queryClient.setQueryData<Project>(['projects', projectId], (old) => {
        if (!old) return old;
        return {
          ...old,
          tunnelUrl: null,
        };
      });

      return { previousProject };
    },
    onError: (err, variables, context) => {
      if (context?.previousProject) {
        queryClient.setQueryData(['projects', projectId], context.previousProject);
      }
      console.error('Failed to stop tunnel:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

// ============================================================================
// Delete Project
// ============================================================================

interface DeleteProjectOptions {
  deleteFiles?: boolean;
}

interface DeleteProjectResult {
  success: boolean;
  filesDeleted: boolean;
  filesRequested: boolean;
}

async function deleteProject(projectId: string, options: DeleteProjectOptions = {}): Promise<DeleteProjectResult> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to delete project');
  }

  return res.json();
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, options }: { projectId: string; options?: DeleteProjectOptions }) =>
      deleteProject(projectId, options),
    onMutate: async ({ projectId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['projects'] });

      // Snapshot previous value
      const previousProjects = queryClient.getQueryData(['projects']);

      // Optimistically remove project from list
      queryClient.setQueryData(['projects'], (old: any) => {
        if (!old?.projects) return old;
        return {
          ...old,
          projects: old.projects.filter((p: Project) => p.id !== projectId),
        };
      });

      return { previousProjects };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(['projects'], context.previousProjects);
      }
      console.error('Failed to delete project:', err);
    },
    onSuccess: () => {
      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// ============================================================================
// Create Project
// ============================================================================

interface CreateProjectData {
  name: string;
  description?: string;
  prompt?: string;
  tags?: any;
}

async function createProject(data: CreateProjectData): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to create project');
  }

  const result = await res.json();
  return result.project;
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProject,
    onSuccess: (newProject) => {
      // Add new project to cache
      queryClient.setQueryData(['projects'], (old: any) => {
        if (!old?.projects) return { projects: [newProject] };
        return {
          ...old,
          projects: [...old.projects, newProject],
        };
      });

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => {
      console.error('Failed to create project:', err);
    },
  });
}
