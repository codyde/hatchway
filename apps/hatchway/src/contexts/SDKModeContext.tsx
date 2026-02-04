'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type SDKMode = 'agent' | 'opencode' | 'droid';

interface SDKModeContextValue {
  sdkMode: SDKMode;
  setSDKMode: (mode: SDKMode) => void;
  sdkModeLabel: string;
  /** List of SDK modes that are enabled via environment variables */
  enabledModes: SDKMode[];
}

const SDK_MODE_LABELS: Record<SDKMode, string> = {
  agent: 'Agent SDK (Claude)',
  opencode: 'OpenCode SDK (Codex)',
  droid: 'Droid SDK (Factory)',
};

/**
 * Environment-based SDK enablement
 * 
 * - agent: Always enabled (default SDK with Claude + Codex models)
 * - opencode: Enabled when ENABLE_OPENCODE_SDK=true
 * - droid: Enabled when ENABLE_FACTORY_SDK=true
 */
export const SDK_ENABLED: Record<SDKMode, boolean> = {
  agent: true, // Always enabled (default)
  opencode: process.env.NEXT_PUBLIC_ENABLE_OPENCODE_SDK === 'true',
  droid: process.env.NEXT_PUBLIC_ENABLE_FACTORY_SDK === 'true',
};

/**
 * Get list of enabled SDK modes based on environment variables
 */
export function getEnabledSDKModes(): SDKMode[] {
  return (['agent', 'opencode', 'droid'] as SDKMode[]).filter(mode => SDK_ENABLED[mode]);
}

// Model arrays for each SDK mode - add new models here as needed
export const AGENT_SDK_MODELS = [
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-haiku-4-5',
  'gpt-5.2-codex',
];

export const OPENCODE_SDK_MODELS: string[] = [
  // Add OpenCode-specific models here when available
];

export const DROID_SDK_MODELS = [
  'factory-droid-opus',
  'factory-droid-codex',
  'factory-droid-glm',
];

/**
 * Get all models for enabled SDKs only
 * This is the primary function used by TagDropdown to filter available models
 */
export function getModelsForEnabledSDKs(): string[] {
  const models: string[] = [];
  if (SDK_ENABLED.agent) {
    models.push(...AGENT_SDK_MODELS);
  }
  if (SDK_ENABLED.opencode) {
    models.push(...OPENCODE_SDK_MODELS);
  }
  if (SDK_ENABLED.droid) {
    models.push(...DROID_SDK_MODELS);
  }
  return models;
}

const SDKModeContext = createContext<SDKModeContextValue | null>(null);

export function SDKModeProvider({ children }: { children: ReactNode }) {
  // Default to 'agent' mode - the first enabled mode
  const enabledModes = getEnabledSDKModes();
  const [sdkMode, setSDKModeState] = useState<SDKMode>(enabledModes[0] || 'agent');

  // On mount, check if previously stored mode is still valid (enabled)
  useEffect(() => {
    const stored = localStorage.getItem('sdkMode') as SDKMode | null;
    if (stored && SDK_ENABLED[stored]) {
      // Only restore if the stored mode is still enabled
      setSDKModeState(stored);
    } else if (!SDK_ENABLED[sdkMode]) {
      // If current mode is not enabled, switch to first enabled mode
      setSDKModeState(enabledModes[0] || 'agent');
    }
  }, []);

  const setSDKMode = (mode: SDKMode) => {
    // Only allow setting to enabled modes
    if (!SDK_ENABLED[mode]) {
      console.warn(`[SDKModeContext] Cannot set SDK mode to '${mode}' - not enabled`);
      return;
    }
    setSDKModeState(mode);
    localStorage.setItem('sdkMode', mode);
  };

  return (
    <SDKModeContext.Provider
      value={{
        sdkMode,
        setSDKMode,
        sdkModeLabel: SDK_MODE_LABELS[sdkMode],
        enabledModes,
      }}
    >
      {children}
    </SDKModeContext.Provider>
  );
}

export function useSDKMode() {
  const context = useContext(SDKModeContext);
  if (!context) {
    throw new Error('useSDKMode must be used within a SDKModeProvider');
  }
  return context;
}

// Helper to get models for a specific SDK mode
export function getModelsForSDKMode(mode: SDKMode): string[] {
  switch (mode) {
    case 'agent':
      return AGENT_SDK_MODELS;
    case 'opencode':
      return OPENCODE_SDK_MODELS;
    case 'droid':
      return DROID_SDK_MODELS;
    default:
      return [];
  }
}

// Helper to get the default model for an SDK mode
export function getDefaultModelForSDKMode(mode: SDKMode): string {
  switch (mode) {
    case 'agent':
      return 'claude-haiku-4-5';
    case 'opencode':
      return 'gpt-5.2-codex';
    case 'droid':
      return 'factory-droid-opus';
    default:
      return 'claude-haiku-4-5';
  }
}

/**
 * Check if a specific SDK is enabled via environment variable
 */
export function isSDKEnabled(mode: SDKMode): boolean {
  return SDK_ENABLED[mode];
}
