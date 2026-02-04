/**
 * OpenCode Client Package
 * 
 * Provides a shared OpenCode SDK client for use across the monorepo.
 * Both the frontend (Next.js) and runner can use this to communicate
 * with the OpenCode service.
 */

import { createOpencodeClient } from '@opencode-ai/sdk';

// Re-export our custom types
export * from './types.js';

// Define a type for the client to avoid SDK type issues
type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

// Client instance cache
let cachedClient: OpenCodeClient | null = null;
let cachedBaseUrl: string | null = null;

/**
 * Configuration options for the OpenCode client
 */
export interface OpenCodeClientOptions {
  /** Base URL of the OpenCode service. Defaults to OPENCODE_URL env var. */
  baseUrl?: string;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Throw errors instead of returning them */
  throwOnError?: boolean;
}

/**
 * Get the OpenCode service URL from environment
 */
export function getOpenCodeUrl(): string {
  const url = process.env.OPENCODE_URL;
  if (!url) {
    // Default to localhost in development
    if (process.env.NODE_ENV === 'development' || process.env.HATCHWAY_LOCAL_MODE === 'true') {
      return 'http://localhost:4096';
    }
    throw new Error(
      'OPENCODE_URL environment variable is required. ' +
      'Set it to the URL of your OpenCode service (e.g., http://localhost:4096)'
    );
  }
  return url;
}

/**
 * Create or get a cached OpenCode client
 * 
 * The client is cached per base URL to avoid creating multiple instances.
 * 
 * @example
 * ```typescript
 * import { getOpenCodeClient } from '@hatchway/opencode-client';
 * 
 * const client = getOpenCodeClient();
 * const session = await client.session.create({ body: {} });
 * ```
 */
export function getOpenCodeClient(options: OpenCodeClientOptions = {}): OpenCodeClient {
  const baseUrl = options.baseUrl || getOpenCodeUrl();
  
  // Return cached client if URL matches
  if (cachedClient && cachedBaseUrl === baseUrl) {
    return cachedClient;
  }
  
  // Create new client
  cachedClient = createOpencodeClient({
    baseUrl,
    fetch: options.fetch,
    throwOnError: options.throwOnError ?? false,
  });
  cachedBaseUrl = baseUrl;
  
  return cachedClient;
}

/**
 * Create a fresh OpenCode client (not cached)
 * 
 * Use this when you need a client with different options or
 * want to ensure a fresh connection.
 */
export function createOpenCodeClient(options: OpenCodeClientOptions = {}): OpenCodeClient {
  const baseUrl = options.baseUrl || getOpenCodeUrl();
  
  return createOpencodeClient({
    baseUrl,
    fetch: options.fetch,
    throwOnError: options.throwOnError ?? false,
  });
}

/**
 * Check if the OpenCode service is healthy
 */
export async function checkOpenCodeHealth(options: OpenCodeClientOptions = {}): Promise<{
  healthy: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const client = getOpenCodeClient(options);
    // Use type assertion since SDK types may vary
    const result = await (client as any).global.health();
    
    if (result.data) {
      return {
        healthy: result.data.healthy,
        version: result.data.version,
      };
    }
    
    return {
      healthy: false,
      error: 'No response from health check',
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clear the cached client (useful for testing or reconnection)
 */
export function clearClientCache(): void {
  cachedClient = null;
  cachedBaseUrl = null;
}
