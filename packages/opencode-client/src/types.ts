/**
 * OpenCode Model Types
 * 
 * Models are specified in provider/model format.
 * This allows using any provider supported by OpenCode.
 */

// Supported providers
export type OpenCodeProvider = 
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'fireworks'
  | 'together'
  | 'opencode'; // OpenCode Zen

// Common model IDs per provider
export type AnthropicModelId = 
  | 'claude-sonnet-5'
  | 'claude-haiku-4-5'
  | 'claude-opus-4-8';

export type OpenAIModelId = 
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'o3'
  | 'o3-mini';

export type GoogleModelId = 
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash';

export type DeepSeekModelId = 
  | 'deepseek-chat'
  | 'deepseek-reasoner';

// Full model ID format: provider/model
export type OpenCodeModelId = 
  | `anthropic/${AnthropicModelId}`
  | `openai/${OpenAIModelId}`
  | `google/${GoogleModelId}`
  | `deepseek/${DeepSeekModelId}`
  | `opencode/${string}`   // OpenCode Zen models
  | `openrouter/${string}` // Any OpenRouter model
  | string;                // Allow any provider/model combo

export const DEFAULT_OPENCODE_MODEL_ID: OpenCodeModelId = 'anthropic/claude-sonnet-5';

// Agent types
export type AgentId = 'opencode' | 'openai-codex';
export const DEFAULT_AGENT_ID: AgentId = 'opencode';

// Model metadata for UI display
export interface ModelMetadata {
  label: string;
  description: string;
  provider: OpenCodeProvider;
}

export const MODEL_METADATA: Record<string, ModelMetadata> = {
  'anthropic/claude-sonnet-5': {
    label: 'Claude Sonnet 5',
    provider: 'anthropic',
    description: 'Best balance of speed and intelligence',
  },
  'anthropic/claude-haiku-4-5': {
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    description: 'Fast and efficient',
  },
  'anthropic/claude-opus-4-8': {
    label: 'Claude Opus 4.8',
    provider: 'anthropic',
    description: 'Most capable for complex tasks',
  },
  'openai/gpt-4o': {
    label: 'GPT-4o',
    provider: 'openai',
    description: 'OpenAI flagship model',
  },
  'openai/o3': {
    label: 'o3',
    provider: 'openai',
    description: 'OpenAI reasoning model',
  },
  'google/gemini-2.5-pro': {
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'Google flagship model',
  },
  'deepseek/deepseek-chat': {
    label: 'DeepSeek Chat',
    provider: 'deepseek',
    description: 'DeepSeek conversational model',
  },
  'deepseek/deepseek-reasoner': {
    label: 'DeepSeek Reasoner',
    provider: 'deepseek',
    description: 'DeepSeek reasoning model',
  },
};

// Legacy model mapping for backwards compatibility
export const LEGACY_MODEL_MAP: Record<string, OpenCodeModelId> = {
  'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',
  'claude-sonnet-5': 'anthropic/claude-sonnet-5',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-5',
  'claude-opus-4-8': 'anthropic/claude-opus-4-8',
};

/**
 * Convert legacy model ID to OpenCode format
 */
export function normalizeModelId(modelId: string): OpenCodeModelId {
  // Already in provider/model format
  if (modelId.includes('/')) {
    return modelId;
  }
  
  // Map legacy format
  return LEGACY_MODEL_MAP[modelId] || `anthropic/${modelId}`;
}

/**
 * Parse model ID into provider and model components
 */
export function parseModelId(modelId: OpenCodeModelId): { provider: string; model: string } {
  const normalized = normalizeModelId(modelId);
  const [provider, ...modelParts] = normalized.split('/');
  return {
    provider: provider || 'anthropic',
    model: modelParts.join('/') || 'claude-sonnet-5',
  };
}

/**
 * Get display label for a model
 */
export function getModelLabel(modelId: OpenCodeModelId): string {
  const normalized = normalizeModelId(modelId);
  return MODEL_METADATA[normalized]?.label ?? modelId;
}
