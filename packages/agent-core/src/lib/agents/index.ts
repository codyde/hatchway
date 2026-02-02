import type { AgentId } from '../../types/agent';
import { getAgentStrategy, registerAgentStrategy } from './strategy';

let initialized = false;

/**
 * Lazy-load strategies to prevent server-only code from being bundled in client
 * Strategies are only loaded when first requested (server-side only)
 */
async function ensureRegistry() {
  if (initialized) {
    return;
  }

  // Dynamic imports prevent webpack from bundling server-only code
  const [
    { default: claudeStrategy },
    { default: codexStrategy },
    { default: droidStrategy }
  ] = await Promise.all([
    import('./claude-strategy'),
    import('./codex-strategy'),
    import('./droid-strategy')
  ]);

  registerAgentStrategy('claude-code', claudeStrategy);
  registerAgentStrategy('openai-codex', codexStrategy);
  registerAgentStrategy('factory-droid', droidStrategy);
  initialized = true;
}

export async function resolveAgentStrategy(agentId: AgentId) {
  await ensureRegistry();
  return getAgentStrategy(agentId);
}

export * from './strategy';
