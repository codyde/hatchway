import { useQuery } from '@tanstack/react-query';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  originalPrompt: string | null;
  icon: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  projectType: string | null;
  detectedFramework: string | null;
  path: string;
  runCommand: string | null;
  port: number | null;
  devServerPid: number | null;
  devServerPort: number | null;
  devServerStatus: 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'failed' | null;
  tunnelUrl: string | null;
  runnerId: string | null;
  runnerConnected: boolean; // Whether the project's runner is currently connected
  generationState: string | null;
  tags: any | null;
  lastActivityAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Index signature to allow compatibility with ProjectSummary
  [key: string]: unknown;
}

export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
}

interface ProjectsResponse {
  projects: Project[];
}

interface ProjectFilesResponse {
  files: FileNode[];
}

async function fetchProjects(): Promise<ProjectsResponse> {
  const res = await fetch('/api/projects');
  if (!res.ok) {
    throw new Error('Failed to fetch projects');
  }
  return res.json();
}

async function fetchProject(projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${projectId}`);
  if (!res.ok) {
    throw new Error('Failed to fetch project');
  }
  return res.json();
}

async function fetchProjectFiles(projectId: string): Promise<ProjectFilesResponse> {
  const res = await fetch(`/api/projects/${projectId}/files`);
  if (!res.ok) {
    throw new Error('Failed to fetch project files');
  }
  return res.json();
}

/**
 * Hook to fetch all projects
 */
export function useProjectsList() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch a single project by ID
 */
export function useProject(projectId: string | undefined | null) {
  return useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => fetchProject(projectId!),
    enabled: !!projectId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch files for a specific project
 */
export function useProjectFiles(projectId: string | undefined | null) {
  return useQuery({
    queryKey: ['projects', projectId, 'files'],
    queryFn: () => fetchProjectFiles(projectId!),
    enabled: !!projectId,
    staleTime: 60000, // 60 seconds - files don't change often
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch content of a specific file
 */
async function fetchFileContent(projectId: string, filePath: string): Promise<string> {
  const res = await fetch(
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`
  );
  if (!res.ok) {
    throw new Error('Failed to fetch file content');
  }
  return res.text();
}

export function useFileContent(
  projectId: string | undefined | null,
  filePath: string | undefined | null
) {
  return useQuery({
    queryKey: ['projects', projectId, 'files', filePath, 'content'],
    queryFn: () => fetchFileContent(projectId!, filePath!),
    enabled: !!projectId && !!filePath,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch logs for a project
 */
interface LogsResponse {
  logs: string[];
  hasMore: boolean;
}

async function fetchProjectLogs(projectId: string, page: number = 0): Promise<LogsResponse> {
  const res = await fetch(`/api/projects/${projectId}/logs?page=${page}&limit=100`);
  if (!res.ok) {
    throw new Error('Failed to fetch project logs');
  }
  return res.json();
}

export function useProjectLogs(projectId: string | undefined | null, page: number = 0) {
  return useQuery({
    queryKey: ['projects', projectId, 'logs', page],
    queryFn: () => fetchProjectLogs(projectId!, page),
    enabled: !!projectId,
    staleTime: 10000, // 10 seconds
    // Note: For smooth pagination in v5, consider using placeholderData with previous data
  });
}

/**
 * Hook to fetch build/generation messages for a project (infinite scroll)
 */
export interface MessagePart {
  type: string;
  text?: string;
  image?: string;
  mimeType?: string;
  fileName?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  state?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts?: MessagePart[];
  timestamp: Date;
}

export interface Session {
  id: string;
  hydratedState?: unknown;
}

export interface MessagesResponse {
  messages: Message[];
  sessions: Session[];
  nextCursor?: number;
}

async function fetchProjectMessages(
  projectId: string,
  cursor: number = 0
): Promise<MessagesResponse> {
  const res = await fetch(`/api/projects/${projectId}/messages?cursor=${cursor}&limit=50`);
  if (!res.ok) {
    throw new Error('Failed to fetch project messages');
  }
  return res.json();
}

export function useProjectMessages(projectId: string | undefined | null) {
  return useQuery({
    queryKey: ['projects', projectId, 'messages'],
    queryFn: () => fetchProjectMessages(projectId!),
    enabled: !!projectId,
    staleTime: 5000, // 5 seconds - reduced to ensure invalidations take effect quickly
    refetchOnWindowFocus: true,
  });
}
