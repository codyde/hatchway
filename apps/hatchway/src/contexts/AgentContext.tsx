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
import {
  DEFAULT_AGENT_ID,
  DEFAULT_CLAUDE_MODEL_ID,
  CLAUDE_MODEL_METADATA,
  type AgentId,
  type ClaudeModelId,
} from '@hatchway/agent-core/client';

export interface AgentOption {
  id: AgentId;
  label: string;
  description: string;
}

export interface ClaudeModelOption {
  id: ClaudeModelId;
  label: string;
  description: string;
}

interface AgentContextValue {
  selectedAgentId: AgentId;
  setSelectedAgentId: (id: AgentId) => void;
  agents: AgentOption[];
  selectedClaudeModelId: ClaudeModelId;
  setSelectedClaudeModelId: (id: ClaudeModelId) => void;
  claudeModels: ClaudeModelOption[];
}

const AGENTS: AgentOption[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Anthropic Claude Code toolkit with MCP integration',
  },
  {
    id: 'openai-codex',
    label: 'OpenAI Codex',
    description: 'OpenAI Codex agent with sandbox support',
  },
];

const STORAGE_KEY = 'selectedAgentId';
const CLAUDE_MODEL_STORAGE_KEY = 'selectedClaudeModelId';

const CLAUDE_MODELS: ClaudeModelOption[] = Object.entries(CLAUDE_MODEL_METADATA).map(
  ([id, metadata]) => ({
    id: id as ClaudeModelId,
    label: metadata.label,
    description: metadata.description,
  }),
);

const AgentContext = createContext<AgentContextValue | undefined>(undefined);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [selectedAgentId, setSelectedAgentIdState] = useState<AgentId>(DEFAULT_AGENT_ID);
  const [selectedClaudeModelId, setSelectedClaudeModelIdState] = useState<ClaudeModelId>(
    DEFAULT_CLAUDE_MODEL_ID,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'claude-code' || stored === 'openai-codex') {
      setSelectedAgentIdState(stored);
    }

    const storedClaudeModel = window.localStorage.getItem(CLAUDE_MODEL_STORAGE_KEY);
    if (storedClaudeModel === 'claude-haiku-4-5' || storedClaudeModel === 'claude-sonnet-4-5' || storedClaudeModel === 'claude-opus-4-5') {
      setSelectedClaudeModelIdState(storedClaudeModel);
    }
  }, []);

  const setSelectedAgentId = useCallback((id: AgentId) => {
    setSelectedAgentIdState(id);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const setSelectedClaudeModelId = useCallback((id: ClaudeModelId) => {
    setSelectedClaudeModelIdState(id);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CLAUDE_MODEL_STORAGE_KEY, id);
    }
  }, []);

  const value = useMemo<AgentContextValue>(
    () => ({
      selectedAgentId,
      setSelectedAgentId,
      agents: AGENTS,
      selectedClaudeModelId,
      setSelectedClaudeModelId,
      claudeModels: CLAUDE_MODELS,
    }),
    [selectedAgentId, setSelectedAgentId, selectedClaudeModelId, setSelectedClaudeModelId],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within an AgentProvider');
  }
  return context;
}
