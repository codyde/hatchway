import Conf from 'conf';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Theme names for the TUI
export type ThemeName = 'sentry' | 'ocean' | 'ember' | 'forest' | 'noir';

export interface RunnerConfig {
  version: string;
  workspace: string;
  monorepoPath?: string; // Path to cloned hatchway repository
  databaseUrl?: string; // PostgreSQL connection string
  apiUrl?: string; // API base URL (e.g., http://localhost:3000)
  autoUpdate?: boolean; // Enable automatic CLI updates (default: true)
  // Server connection config (formerly "broker" - now connects directly to Next.js)
  server: {
    wsUrl: string; // WebSocket URL (e.g., ws://localhost:3000/ws/runner)
    secret: string;
  };
  // Legacy broker config for backward compatibility
  broker?: {
    url: string;
    httpUrl?: string;
    secret: string;
  };
  runner: {
    id: string; // This runner's ID and default ID for web app in local mode
    lastRunnerId?: string; // Last used runner ID (for runner mode)
    reconnectAttempts?: number;
    heartbeatInterval?: number;
  };
  tunnel?: {
    provider: 'cloudflare';
    autoCreate: boolean;
  };
  // TUI preferences
  ui?: {
    theme: ThemeName;
  };
}

/**
 * Config manager using conf library
 * Handles platform-specific config locations
 */
export class ConfigManager {
  private conf: Conf<RunnerConfig>;

  constructor() {
    this.conf = new Conf<RunnerConfig>({
      projectName: 'hatchway',
      projectSuffix: '', // No suffix, just 'hatchway'
      defaults: this.getDefaults(),
    });
  }

  private getDefaults(): RunnerConfig {
    return {
      version: '0.1.0',
      workspace: join(homedir(), 'hatchway-workspace'),
      apiUrl: 'http://localhost:3000', // Default API URL
      server: {
        wsUrl: 'ws://localhost:3000/ws/runner', // Direct WebSocket connection to Next.js
        secret: 'dev-secret', // Default local secret
      },
      runner: {
        id: 'local',
        reconnectAttempts: 5,
        heartbeatInterval: 15000,
      },
      tunnel: {
        provider: 'cloudflare',
        autoCreate: true,
      },
    };
  }

  get(key?: keyof RunnerConfig): any {
    if (!key) {
      return this.conf.store;
    }
    return this.conf.get(key);
  }

  set(key: keyof RunnerConfig | string, value: any): void {
    this.conf.set(key as any, value);
  }

  delete(key: keyof RunnerConfig): void {
    this.conf.delete(key);
  }

  reset(): void {
    this.conf.clear();
    this.conf.store = this.getDefaults();
  }

  has(key: keyof RunnerConfig): boolean {
    return this.conf.has(key);
  }

  get path(): string {
    return this.conf.path;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.conf.store;

    if (!config.workspace) {
      errors.push('Workspace path is required');
    }

    // Check for server config (new) or legacy broker config
    const hasServerConfig = config.server?.secret && config.server?.wsUrl;
    const hasLegacyBrokerConfig = config.broker?.secret && config.broker?.url;
    
    if (!hasServerConfig && !hasLegacyBrokerConfig) {
      errors.push('Server shared secret is required');
      errors.push('Server WebSocket URL is required');
    }

    if (!config.runner?.id) {
      errors.push('Runner ID is required');
    }

    // Check if workspace exists
    if (config.workspace && !existsSync(config.workspace)) {
      errors.push(`Workspace directory does not exist: ${config.workspace}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if config has been initialized properly
   * Requires monorepo to be cloned and databaseUrl to be configured
   */
  isInitialized(): boolean {
    const monorepoPath = this.get('monorepoPath');
    const databaseUrl = this.get('databaseUrl');
    
    // Must have monorepo path set and the directory must exist
    if (!monorepoPath || !existsSync(monorepoPath)) {
      return false;
    }
    
    // Must have database URL configured
    if (!databaseUrl) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get the WebSocket URL (supports both new and legacy config)
   */
  getWsUrl(): string {
    const server = this.get('server');
    const broker = this.get('broker');
    
    // Prefer new server config
    if (server?.wsUrl) {
      return server.wsUrl;
    }
    
    // Fall back to legacy broker URL
    return broker?.url ?? 'ws://localhost:3000/ws/runner';
  }
  
  /**
   * Get the shared secret (supports both new and legacy config)
   */
  getSecret(): string {
    const server = this.get('server');
    const broker = this.get('broker');
    
    // Prefer new server config
    if (server?.secret) {
      return server.secret;
    }
    
    // Fall back to legacy broker secret
    return broker?.secret ?? '';
  }
}

export const configManager = new ConfigManager();
