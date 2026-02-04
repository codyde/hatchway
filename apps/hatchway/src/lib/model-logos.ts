/**
 * Get the logo path for a model value
 * This is a simple lookup that works on both client and server
 */
export function getModelLogo(modelValue: string): string | null {
  const logoMap: Record<string, string> = {
    'claude-sonnet-4-5': '/claude.png',
    'claude-opus-4-5': '/claude.png',
    'claude-haiku-4-5': '/claude.png',
    'gpt-5-codex': '/openai.png',
    'gpt-5.2-codex': '/openai.png',
    'openai/gpt-5.2-codex': '/openai.png'
  };
  return logoMap[modelValue] || null;
}

