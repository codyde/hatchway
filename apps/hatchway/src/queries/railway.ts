import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { 
  RailwayConnectionStatus, 
  RailwayWorkspace, 
  RailwayDeploymentInfo,
  RailwayDomainsResponse,
  RailwayServiceInstance,
  RailwayServiceInstanceUpdateInput,
} from '@/lib/railway/types';

interface RailwayStatusResponse {
  configured: boolean;
  status: RailwayConnectionStatus;
}

async function fetchRailwayStatus(): Promise<RailwayStatusResponse> {
  const res = await fetch('/api/integrations/railway');

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch Railway status');
  }

  return res.json();
}

async function updateRailwaySettings(settings: {
  defaultWorkspaceId?: string;
  defaultWorkspaceName?: string;
}): Promise<{ status: RailwayConnectionStatus }> {
  const res = await fetch('/api/integrations/railway', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to update Railway settings');
  }

  return res.json();
}

async function disconnectRailway(): Promise<{ success: boolean }> {
  const res = await fetch('/api/integrations/railway', {
    method: 'DELETE',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to disconnect Railway');
  }

  return res.json();
}

/**
 * Hook to fetch Railway integration status
 */
export function useRailwayStatus() {
  return useQuery({
    queryKey: ['integrations', 'railway'],
    queryFn: fetchRailwayStatus,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to check if Railway is connected
 */
export function useIsRailwayConnected(): boolean {
  const { data } = useRailwayStatus();
  return data?.status?.isConnected ?? false;
}

/**
 * Hook to get Railway connection status
 */
export function useRailwayConnection() {
  const { data, isLoading, error, refetch } = useRailwayStatus();
  
  return {
    isConfigured: data?.configured ?? false,
    isConnected: data?.status?.isConnected ?? false,
    status: data?.status,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Hook to update Railway settings
 */
export function useUpdateRailwaySettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateRailwaySettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'railway'] });
    },
  });
}

/**
 * Hook to disconnect Railway
 */
export function useDisconnectRailway() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectRailway,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'railway'] });
    },
  });
}

/**
 * Hook to set default workspace
 */
export function useSetDefaultWorkspace() {
  const updateSettings = useUpdateRailwaySettings();

  return {
    setDefaultWorkspace: (workspace: RailwayWorkspace) => {
      return updateSettings.mutateAsync({
        defaultWorkspaceId: workspace.id,
        defaultWorkspaceName: workspace.name,
      });
    },
    isLoading: updateSettings.isPending,
    error: updateSettings.error,
  };
}

// ============================================
// Project Deployment Hooks
// ============================================

interface RailwayDatabaseInfo {
  serviceId: string;
  status: string; // 'provisioning' | 'ready' | 'unknown'
  hasConnectionUrl: boolean;
}

interface ProjectRailwayDeploymentStatus {
  isDeployed: boolean;
  railwayProjectId?: string;
  railwayServiceId?: string;
  railwayEnvironmentId?: string;
  railwayDatabaseServiceId?: string;
  domain?: string;
  url?: string;
  status?: string;
  lastDeployedAt?: string;
  latestDeployment?: RailwayDeploymentInfo;
  database?: RailwayDatabaseInfo | null;
}

interface DeployToRailwayResponse {
  success: boolean;
  deployment: {
    id: string;
    status: string;
    domain: string;
    url: string;
  };
  project: {
    railwayProjectId: string;
    railwayServiceId: string;
    railwayEnvironmentId: string;
    railwayDatabaseServiceId?: string;
    railwayDomain: string;
  };
  database?: RailwayDatabaseInfo | null;
}

async function fetchProjectRailwayStatus(projectId: string): Promise<ProjectRailwayDeploymentStatus> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway`);

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch Railway deployment status');
  }

  return res.json();
}

interface DeployToRailwayParams {
  githubRepo?: string;
  githubBranch?: string;
}

async function deployToRailway(
  projectId: string,
  params?: DeployToRailwayParams
): Promise<DeployToRailwayResponse> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to deploy to Railway');
  }

  return res.json();
}

async function disconnectRailwayDeployment(
  projectId: string, 
  deleteRailwayProject: boolean = false
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteRailwayProject }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to disconnect Railway deployment');
  }

  return res.json();
}

/**
 * Hook to fetch Railway deployment status for a project
 */
export function useProjectRailwayStatus(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'railway'],
    queryFn: () => fetchProjectRailwayStatus(projectId!),
    enabled: !!projectId,
    staleTime: 10 * 1000, // 10 seconds - deployments change frequently
    refetchInterval: (query) => {
      // Poll every 5 seconds while deploying
      const data = query.state.data;
      if (data?.status === 'deploying') {
        return 5000;
      }
      return false;
    },
  });
}

/**
 * Hook to deploy a project to Railway
 */
export function useDeployToRailway(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params?: DeployToRailwayParams) => {
      if (!projectId) throw new Error('Project ID is required');
      return deployToRailway(projectId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

/**
 * Hook to disconnect Railway deployment from a project
 */
export function useDisconnectRailwayDeployment(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (deleteRailwayProject: boolean = false) => {
      if (!projectId) throw new Error('Project ID is required');
      return disconnectRailwayDeployment(projectId, deleteRailwayProject);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

// ============================================
// Database Provisioning Hooks
// ============================================

interface ProvisionDatabaseResponse {
  success: boolean;
  database: {
    serviceId: string;
    serviceName: string;
    status: string;
  };
  message: string;
}

async function provisionRailwayDatabase(projectId: string): Promise<ProvisionDatabaseResponse> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/database`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to provision database');
  }

  return res.json();
}

/**
 * Hook to provision a PostgreSQL database for a Railway-deployed project
 */
export function useProvisionRailwayDatabase(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error('Project ID is required');
      return provisionRailwayDatabase(projectId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

// ============================================
// Database Status Hook
// ============================================

interface DatabaseStatusResponse {
  hasDatabase: boolean;
  database: {
    serviceId: string;
    status: string;
    publicUrl: string | null;
  } | null;
}

async function fetchRailwayDatabaseStatus(projectId: string): Promise<DatabaseStatusResponse> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/database`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch database status');
  }
  return res.json();
}

/**
 * Hook to fetch Railway database status and connection details
 */
export function useRailwayDatabaseStatus(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'railway', 'database'],
    queryFn: () => fetchRailwayDatabaseStatus(projectId!),
    enabled: !!projectId,
    staleTime: 30 * 1000,
  });
}

// ============================================
// Environment Variables Hooks
// ============================================

async function fetchRailwayVariables(projectId: string): Promise<{ variables: Record<string, string> }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/variables`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch variables');
  }
  return res.json();
}

async function updateRailwayVariables(
  projectId: string,
  variables: Record<string, string>
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/variables`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to update variables');
  }
  return res.json();
}

async function deleteRailwayVariable(
  projectId: string,
  name: string
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/variables`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to delete variable');
  }
  return res.json();
}

/**
 * Hook to fetch Railway environment variables for a project
 */
export function useRailwayVariables(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'railway', 'variables'],
    queryFn: () => fetchRailwayVariables(projectId!),
    enabled: !!projectId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to update Railway environment variables
 */
export function useUpdateRailwayVariables(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: Record<string, string>) => {
      if (!projectId) throw new Error('Project ID is required');
      return updateRailwayVariables(projectId, variables);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway', 'variables'] });
    },
  });
}

/**
 * Hook to delete a Railway environment variable
 */
export function useDeleteRailwayVariable(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => {
      if (!projectId) throw new Error('Project ID is required');
      return deleteRailwayVariable(projectId, name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway', 'variables'] });
    },
  });
}

// ============================================
// Domains Hooks
// ============================================

async function fetchRailwayDomains(projectId: string): Promise<{ domains: RailwayDomainsResponse }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/domains`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch domains');
  }
  return res.json();
}

async function regenerateRailwayDomain(projectId: string): Promise<{ domain: { id: string; domain: string }; message: string }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/domains`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to regenerate domain');
  }
  return res.json();
}

async function updateRailwayDomain(
  projectId: string,
  subdomain: string
): Promise<{ domain: { id: string; domain: string }; message: string }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/domains`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to update domain');
  }
  return res.json();
}

async function deleteRailwayDomain(
  projectId: string,
  domainId: string,
  type: 'service' | 'custom'
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/domains`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domainId, type }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to delete domain');
  }
  return res.json();
}

/**
 * Hook to fetch Railway domains for a project
 */
export function useRailwayDomains(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'railway', 'domains'],
    queryFn: () => fetchRailwayDomains(projectId!),
    enabled: !!projectId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to regenerate Railway domain
 */
export function useRegenerateRailwayDomain(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error('Project ID is required');
      return regenerateRailwayDomain(projectId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway', 'domains'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

/**
 * Hook to update Railway domain subdomain
 */
export function useUpdateRailwayDomain(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (subdomain: string) => {
      if (!projectId) throw new Error('Project ID is required');
      return updateRailwayDomain(projectId, subdomain);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway', 'domains'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

/**
 * Hook to delete Railway domain
 */
export function useDeleteRailwayDomain(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domainId, type }: { domainId: string; type: 'service' | 'custom' }) => {
      if (!projectId) throw new Error('Project ID is required');
      return deleteRailwayDomain(projectId, domainId, type);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway', 'domains'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

// ============================================
// Service Management Hooks
// ============================================

async function deleteRailwayService(
  projectId: string,
  deleteProject: boolean = false
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/service?deleteProject=${deleteProject}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to delete service');
  }
  return res.json();
}

async function redeployRailwayService(projectId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/service`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to redeploy service');
  }
  return res.json();
}

/**
 * Hook to delete Railway service or project
 */
export function useDeleteRailwayService(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (deleteProject: boolean = false) => {
      if (!projectId) throw new Error('Project ID is required');
      return deleteRailwayService(projectId, deleteProject);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
}

/**
 * Hook to redeploy Railway service
 */
export function useRedeployRailwayService(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error('Project ID is required');
      return redeployRailwayService(projectId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway'] });
    },
  });
}

// ============================================
// Service Settings Hooks
// ============================================

async function fetchRailwaySettings(projectId: string): Promise<{ settings: RailwayServiceInstance }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/settings`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch settings');
  }
  return res.json();
}

async function updateRailwaySettings2(
  projectId: string,
  settings: RailwayServiceInstanceUpdateInput
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/deploy/railway/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to update settings');
  }
  return res.json();
}

/**
 * Hook to fetch Railway service settings for a project
 */
export function useRailwayServiceSettings(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'railway', 'settings'],
    queryFn: () => fetchRailwaySettings(projectId!),
    enabled: !!projectId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to update Railway service settings
 */
export function useUpdateRailwayServiceSettings(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: RailwayServiceInstanceUpdateInput) => {
      if (!projectId) throw new Error('Project ID is required');
      return updateRailwaySettings2(projectId, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'railway', 'settings'] });
    },
  });
}
