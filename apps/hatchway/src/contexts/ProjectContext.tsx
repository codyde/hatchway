'use client';

import React, { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectsList, useProjectFiles, type Project as ProjectType, type FileNode as FileNodeType } from '@/queries/projects';
import { useRunnerStatus } from '@/queries/runner';
import { mergeProjectUpdate } from '@/lib/project-cache';

// Re-export types for backward compatibility
export type Project = ProjectType;
export type FileNode = FileNodeType;

interface ProjectContextType {
  projects: Project[];
  files: FileNode[];
  isLoading: boolean;
  refetch: () => void;
  runnerOnline: boolean | null;
  setActiveProjectId: (id: string | null) => void;
  updateProject: (project: Project) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Use TanStack Query hooks
  const projectsQuery = useProjectsList();
  const filesQuery = useProjectFiles(activeProjectId);
  const runnerStatusQuery = useRunnerStatus();

  // Derive data from queries
  const projects = projectsQuery.data?.projects || [];
  const files = filesQuery.data?.files || [];
  const isLoading = projectsQuery.isLoading;
  const runnerOnline = runnerStatusQuery.data?.connections.length ? true : null;

  const refetch = () => {
    projectsQuery.refetch();
    runnerStatusQuery.refetch();
    if (activeProjectId) {
      filesQuery.refetch();
    }
  };

  // Status-stream updates and query refetches must feed the same canonical
  // project list. Keeping a second component-local project snapshot can leave
  // the preview body on stale provisioning state while the browser chrome has
  // already received the live URL.
  const updateProject = useCallback((project: Project) => {
    queryClient.setQueryData<{ projects: Project[] }>(['projects'], (current) => {
      if (!current) return current;
      const projects = mergeProjectUpdate(current.projects, project);
      return projects === current.projects ? current : { ...current, projects };
    });
  }, [queryClient]);

  return (
    <ProjectContext.Provider
      value={{ projects, files, isLoading, refetch, runnerOnline, setActiveProjectId, updateProject }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProjects must be used within a ProjectProvider');
  }
  return context;
}
