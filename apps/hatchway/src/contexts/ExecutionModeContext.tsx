'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ExecutionMode = 'local' | 'sandbox';

export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'local';

interface ExecutionModeContextValue {
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;
}

const STORAGE_KEY = 'executionMode';

const ExecutionModeContext = createContext<ExecutionModeContextValue | undefined>(undefined);

export function ExecutionModeProvider({ children }: { children: ReactNode }) {
  const [executionMode, setExecutionModeState] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'local' || stored === 'sandbox') {
      setExecutionModeState(stored);
    }
  }, []);

  const setExecutionMode = useCallback((mode: ExecutionMode) => {
    setExecutionModeState(mode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
  }, []);

  const value = useMemo<ExecutionModeContextValue>(
    () => ({ executionMode, setExecutionMode }),
    [executionMode, setExecutionMode],
  );

  return <ExecutionModeContext.Provider value={value}>{children}</ExecutionModeContext.Provider>;
}

export function useExecutionMode() {
  const context = useContext(ExecutionModeContext);
  if (!context) {
    throw new Error('useExecutionMode must be used within an ExecutionModeProvider');
  }
  return context;
}
