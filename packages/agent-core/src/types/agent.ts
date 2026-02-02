/**
 * Agent and Model Types
 * 
 * Supports both legacy Claude-only format and new OpenCode multi-provider format.
 */

// Agent types - 'claude-code' is the default, 'opencode' enabled via OPENCODE_URL env var
// 'factory-droid' uses the Factory Droid SDK for builds
export type AgentId = 'claude-code' | 'opencode' | 'openai-codex' | 'factory-droid';

export const DEFAULT_AGENT_ID: AgentId = 'claude-code';

// Legacy Claude-specific model IDs (backwards compatibility)
export type ClaudeModelId = 'claude-haiku-4-5' | 'claude-sonnet-4-5' | 'claude-opus-4-5';

export const DEFAULT_CLAUDE_MODEL_ID: ClaudeModelId = 'claude-sonnet-4-5';

// New OpenCode model format: provider/model
export type OpenCodeModelId = 
  | `anthropic/${ClaudeModelId}`
  | `anthropic/${string}`
  | `openai/${string}`
  | `google/${string}`
  | `deepseek/${string}`
  | `opencode/${string}`
  | `openrouter/${string}`
  | string;

export const DEFAULT_OPENCODE_MODEL_ID: OpenCodeModelId = 'anthropic/claude-sonnet-4-5';

// Legacy model mapping
export const LEGACY_MODEL_MAP: Record<string, OpenCodeModelId> = {
  'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
  'claude-opus-4-5': 'anthropic/claude-opus-4-5',
  'gpt-5-codex': 'openai/gpt-5.2-codex',
  'gpt-5.2-codex': 'openai/gpt-5.2-codex',
};

/**
 * Convert legacy model ID to OpenCode format
 */
export function normalizeModelId(modelId: string): OpenCodeModelId {
  if (modelId.includes('/')) {
    return modelId;
  }
  return LEGACY_MODEL_MAP[modelId] || `anthropic/${modelId}`;
}

/**
 * Parse model ID into provider and model components
 */
export function parseModelId(modelId: string): { provider: string; model: string } {
  const normalized = normalizeModelId(modelId);
  const [provider, ...modelParts] = normalized.split('/');
  return {
    provider: provider || 'anthropic',
    model: modelParts.join('/') || 'claude-sonnet-4-5',
  };
}

// Model metadata for UI display
export interface ModelMetadata {
  label: string;
  description: string;
  provider?: string;
}

export const CLAUDE_MODEL_METADATA: Record<ClaudeModelId, ModelMetadata> = {
  'claude-haiku-4-5': {
    label: 'Claude Haiku 4.5',
    description: 'Fast and efficient Claude model',
    provider: 'anthropic',
  },
  'claude-sonnet-4-5': {
    label: 'Claude Sonnet 4.5',
    description: 'Balanced performance and quality',
    provider: 'anthropic',
  },
  'claude-opus-4-5': {
    label: 'Claude Opus 4.5',
    description: 'Most capable Claude model for complex tasks',
    provider: 'anthropic',
  },
};

// Extended model metadata including all providers
export const MODEL_METADATA: Record<string, ModelMetadata> = {
  'anthropic/claude-haiku-4-5': {
    label: 'Claude Haiku 4.5',
    description: 'Fast and efficient',
    provider: 'anthropic',
  },
  'anthropic/claude-sonnet-4-5': {
    label: 'Claude Sonnet 4.5',
    description: 'Balanced performance and quality',
    provider: 'anthropic',
  },
  'anthropic/claude-opus-4-5': {
    label: 'Claude Opus 4.5',
    description: 'Most capable for complex tasks',
    provider: 'anthropic',
  },
  'openai/gpt-4o': {
    label: 'GPT-4o',
    description: 'OpenAI flagship model',
    provider: 'openai',
  },
  'openai/o3': {
    label: 'o3',
    description: 'OpenAI reasoning model',
    provider: 'openai',
  },
  'google/gemini-2.5-pro': {
    label: 'Gemini 2.5 Pro',
    description: 'Google flagship model',
    provider: 'google',
  },
  'deepseek/deepseek-chat': {
    label: 'DeepSeek Chat',
    description: 'DeepSeek conversational model',
    provider: 'deepseek',
  },
  'deepseek/deepseek-reasoner': {
    label: 'DeepSeek Reasoner',
    description: 'DeepSeek reasoning model',
    provider: 'deepseek',
  },
  'openai/gpt-5.2-codex': {
    label: 'GPT-5.2 Codex',
    description: 'OpenAI Codex - Advanced code generation',
    provider: 'openai',
  },
};

export function getClaudeModelLabel(modelId: ClaudeModelId): string {
  return CLAUDE_MODEL_METADATA[modelId]?.label ?? modelId;
}

export function getModelLabel(modelId: string): string {
  const normalized = normalizeModelId(modelId);
  return MODEL_METADATA[normalized]?.label ?? CLAUDE_MODEL_METADATA[modelId as ClaudeModelId]?.label ?? modelId;
}
