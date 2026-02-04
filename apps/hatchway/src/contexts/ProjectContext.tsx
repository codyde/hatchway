'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useProjectsList, useProjectFiles, type Project as ProjectType, type FileNode as FileNodeType } from '@/queries/projects';
import { useRunnerStatus } from '@/queries/runner';

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
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

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

  return (
    <ProjectContext.Provider
      value={{ projects, files, isLoading, refetch, runnerOnline, setActiveProjectId }}
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
