'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRunnerStatus, type RunnerConnection } from '@/queries/runner';

interface RunnerContextType {
  selectedRunnerId: string;
  setSelectedRunnerId: (id: string) => void;
  availableRunners: RunnerConnection[];
  isLoading: boolean;
  refetchRunners: () => Promise<void>;
}

const RunnerContext = createContext<RunnerContextType | undefined>(undefined);

export function RunnerProvider({ children }: { children: ReactNode }) {
  const [selectedRunnerId, setSelectedRunnerId] = useState<string>(
    () => {
      // Try to load from localStorage
      if (typeof window !== 'undefined') {
        return localStorage.getItem('selectedRunnerId') || (process.env.NEXT_PUBLIC_RUNNER_DEFAULT_ID ?? 'default');
      }
      return process.env.NEXT_PUBLIC_RUNNER_DEFAULT_ID ?? 'default';
    }
  );

  // Use TanStack Query for runner status
  const { data, isLoading, refetch } = useRunnerStatus();
  const availableRunners = data?.connections || [];

  // If selected runner is no longer available, fall back to first available or default
  useEffect(() => {
    if (availableRunners.length > 0) {
      const selectedExists = availableRunners.some((r) => r.runnerId === selectedRunnerId);
      if (!selectedExists) {
        const fallback = availableRunners[0].runnerId;
        console.log(`⚠️ Selected runner ${selectedRunnerId} not found, falling back to ${fallback}`);
        setSelectedRunnerId(fallback);
      }
    }
  }, [availableRunners, selectedRunnerId]);

  // Save selected runner to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedRunnerId', selectedRunnerId);
    }
  }, [selectedRunnerId]);

  return (
    <RunnerContext.Provider
      value={{
        selectedRunnerId,
        setSelectedRunnerId,
        availableRunners,
        isLoading,
        refetchRunners: async () => {
          await refetch();
        },
      }}
    >
      {children}
    </RunnerContext.Provider>
  );
}

export function useRunner() {
  const context = useContext(RunnerContext);
  if (!context) {
    throw new Error('useRunner must be used within RunnerProvider');
  }
  return context;
}
