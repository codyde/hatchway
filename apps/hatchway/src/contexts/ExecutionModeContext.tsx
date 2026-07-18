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

/** Default for new projects / landing page when the user has no stored preference. */
export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'sandbox';

interface ExecutionModeContextValue {
  executionMode: ExecutionMode;
  /**
   * Update the active mode. When `persist` is true (default), write the user's
   * preference to localStorage so the next new project uses it. Project-scoped
   * seeding should pass `persist: false` so opening a local project does not
   * make sandbox stop being the default for new builds.
   */
  setExecutionMode: (mode: ExecutionMode, options?: { persist?: boolean }) => void;
}

// Bumped key so pre-sandbox-default "local" prefs do not stick forever.
const STORAGE_KEY = 'hatchway.executionMode';

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

  const setExecutionMode = useCallback((mode: ExecutionMode, options?: { persist?: boolean }) => {
    setExecutionModeState(mode);
    if (options?.persist === false) return;
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
