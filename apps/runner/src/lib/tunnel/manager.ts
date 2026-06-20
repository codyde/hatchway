import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ensureCloudflared } from './auto-install.js';
import { createInjectionProxy, findAvailablePort, type InjectionProxy } from '../injection-proxy.js';

/** Default port for the injection proxy */
const DEFAULT_INJECTION_PROXY_PORT = 4000;

interface TunnelInfo {
  url: string;
  /** Original dev server port */
  port: number;
  /** Injection proxy port (tunnel connects to this) */
  proxyPort: number;
  process: ChildProcess;
  /** Injection proxy instance (for cleanup) */
  injectionProxy?: InjectionProxy;
}

export class TunnelManager extends EventEmitter {
  private tunnels = new Map<number, TunnelInfo>();
  private cloudflaredPath: string | null = null;
  private silent = false; // Suppress console output

  /**
   * Set silent mode (for TUI)
   */
  setSilent(silent: boolean): void {
    this.silent = silent;
  }

  /**
   * Conditional logging
   */
  private log(...args: unknown[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  /**
   * Create a tunnel for a specific port
   * Returns the public tunnel URL
   * 
   * The tunnel is created through an injection proxy that adds the element
   * selection script to HTML responses. This enables the "select element"
   * feature to work when the frontend is hosted remotely.
   */
  async createTunnel(port: number, maxRetries = 5): Promise<string> {
    // Check if tunnel already exists for this port
    if (this.tunnels.has(port)) {
      const existing = this.tunnels.get(port)!;
      this.log(`🔗 Tunnel already exists for port ${port}: ${existing.url}`);
      return existing.url;
    }

    // Ingress backend: railgate (self-hosted relay) when configured, else cloudflared.
    // Sandbox mode injects RAILGATE_RELAY_URL so the dev server is exposed at
    // https://<RAILGATE_SUBDOMAIN>.<RAILGATE_BASE_DOMAIN> via the relay.
    const useRailgate = !!process.env.RAILGATE_RELAY_URL;

    // Ensure cloudflared is installed (only for the cloudflared backend)
    if (!useRailgate && !this.cloudflaredPath) {
      this.cloudflaredPath = await ensureCloudflared(this.silent);
    }

    // Step 1: Start injection proxy
    // This proxy injects the element selection script into HTML responses
    let injectionProxy: InjectionProxy | undefined;
    let proxyPort = DEFAULT_INJECTION_PROXY_PORT;

    try {
      // Find an available port for the proxy
      proxyPort = await findAvailablePort(DEFAULT_INJECTION_PROXY_PORT);
      
      injectionProxy = await createInjectionProxy({
        targetPort: port,
        proxyPort,
        onError: (err) => this.log(`[injection-proxy] Error: ${err.message}`),
        log: (...args) => this.log(...args),
      });
      
      this.log(`✅ Injection proxy started: localhost:${proxyPort} → localhost:${port}`);
    } catch (err) {
      // Fallback: tunnel directly to dev server (selection won't work but preview will)
      this.log(`⚠️  Injection proxy failed to start: ${err instanceof Error ? err.message : String(err)}`);
      this.log(`⚠️  Falling back to direct tunnel (element selection will not work)`);
      proxyPort = port; // Fall back to direct connection
    }

    // Step 2: Create tunnel to proxy port (or dev server if proxy failed)
    const tunnelTargetPort = injectionProxy ? proxyPort : port;

    // Try creating tunnel with smart retries
    const errors: string[] = [];
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await (useRailgate
          ? this._createRailgateTunnelAttempt(port, tunnelTargetPort, injectionProxy)
          : this._createTunnelAttempt(port, tunnelTargetPort, injectionProxy));
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        errors.push(errorMsg);
        console.error(`Tunnel creation attempt ${attempt}/${maxRetries} failed:`, errorMsg);

        // Check if this is a permanent error (fail fast)
        if (this._isPermanentError(errorMsg)) {
          // Clean up injection proxy on permanent failure
          if (injectionProxy) {
            await injectionProxy.close().catch(() => {});
          }
          throw new Error(`Permanent failure: ${errorMsg}`);
        }

        if (attempt === maxRetries) {
          // Clean up injection proxy on final failure
          if (injectionProxy) {
            await injectionProxy.close().catch(() => {});
          }
          throw new Error(`Failed to create tunnel after ${maxRetries} attempts: ${errors.join('; ')}`);
        }

        // Exponential backoff with jitter to prevent thundering herd
        const baseDelay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s
        const jitter = Math.random() * 1000; // 0-1s random jitter
        const delay = baseDelay + jitter;
        this.log(`Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Clean up injection proxy on failure
    if (injectionProxy) {
      await injectionProxy.close().catch(() => {});
    }
    throw new Error('Tunnel creation failed after all retries');
  }

  /**
   * Check if an error is permanent (no point retrying)
   */
  private _isPermanentError(errorMsg: string): boolean {
    const permanentErrors = [
      'port already in use',
      'cloudflared not found',
      'permission denied',
      'cannot find',
      'enoent',
      'eacces',
    ];

    const lowerMsg = errorMsg.toLowerCase();
    return permanentErrors.some(err => lowerMsg.includes(err));
  }

  /**
   * Extract tunnel URL from cloudflared output
   */
  private _extractTunnelUrl(output: string): string | null {
    // Format: "Your quick Tunnel has been created! Visit it at: https://xxx.trycloudflare.com"
    // Or just: "https://xxx.trycloudflare.com"
    const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    return match ? match[0] : null;
  }

  /**
   * Verify tunnel is actually responding (async, non-blocking)
   * This runs in background and only logs results
   */
  private async _verifyTunnelReady(url: string, maxWaitMs = 15000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every 1 second (less aggressive)

    this.log(`🔍 [Background] Verifying tunnel is ready: ${url}`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Any response (even errors) means tunnel is connected
        // We just need to verify it's resolving and routing
        if (response.status < 500 || response.ok) {
          const elapsed = Date.now() - startTime;
          this.log(`✅ [Background] Tunnel verified in ${elapsed}ms`);
          return true;
        }
      } catch (error) {
        // Expected while DNS propagates or tunnel initializes
        // Will keep retrying silently
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    this.log(`⏱️  [Background] Verification timeout after ${maxWaitMs}ms (tunnel may still work)`);
    return false;
  }

  /**
   * Single attempt to create a tunnel
   * @param devServerPort - The original dev server port (used as key in tunnels map)
   * @param tunnelTargetPort - The port to tunnel to (proxy port or dev server port if proxy failed)
   * @param injectionProxy - Optional injection proxy instance for cleanup
   */
  private async _createTunnelAttempt(
    devServerPort: number, 
    tunnelTargetPort: number,
    injectionProxy?: InjectionProxy
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const isUsingProxy = tunnelTargetPort !== devServerPort;
      this.log(`[tunnel] Creating tunnel for port ${tunnelTargetPort}${isUsingProxy ? ` (proxy for dev server on ${devServerPort})` : ''}...`);

      // Direct binary execution with unbuffered streams
      const proc = spawn(this.cloudflaredPath!, [
        'tunnel',
        '--url', `http://localhost:${tunnelTargetPort}`,
        '--no-autoupdate',
      ], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Set streams to unbuffered mode immediately for responsive output
      if (proc.stdout) {
        proc.stdout.setEncoding('utf8');
        proc.stdout.resume();
      }
      if (proc.stderr) {
        proc.stderr.setEncoding('utf8');
        proc.stderr.resume();
      }

      this.log(`[tunnel] Cloudflared spawned with PID: ${proc.pid}`);

      let resolved = false;
      let tunnelUrl: string | null = null;
      let tunnelRegistered = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('Tunnel creation timeout (30s)'));
        }
      }, 30000);

      // Shared handler for both stdout and stderr
      const handleOutput = async (data: Buffer) => {
        const output = data.toString();

        // Step 1: Extract URL
        if (!tunnelUrl) {
          const url = this._extractTunnelUrl(output);
          if (url) {
            tunnelUrl = url;
            this.log(`✅ Tunnel URL received: ${url} → localhost:${tunnelTargetPort}${isUsingProxy ? ` → localhost:${devServerPort}` : ''}`);
            // Store with dev server port as key, but include proxy info
            this.tunnels.set(devServerPort, { 
              url, 
              port: devServerPort, 
              proxyPort: tunnelTargetPort,
              process: proc,
              injectionProxy,
            });
          }
        }

        // Step 2: Wait for tunnel registration (edge connection established)
        if (tunnelUrl && !tunnelRegistered && output.includes('Registered tunnel connection')) {
          tunnelRegistered = true;
          this.log(`✅ Tunnel registered with Cloudflare edge (DNS propagating)`);

          // Wait 3 seconds after registration for DNS to propagate
          this.log(`⏳ Waiting 3 seconds for DNS to fully propagate...`);
          await new Promise(r => setTimeout(r, 3000));

          // Step 3: Return only after registration + 3 second buffer
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);

            this.log(`✅ Tunnel ready: ${tunnelUrl}`);
            if (isUsingProxy) {
              this.log(`✅ Element selection enabled via injection proxy`);
            }

            // Note: Backend verification skipped for localhost tunnels
            // The tunnel connects localhost to Cloudflare - backend can't verify it
            // Frontend will verify DNS before loading in iframe

            resolve(tunnelUrl);
          }
        }
      };

      proc.stdout.on('data', handleOutput);

      proc.stderr.on('data', (data: Buffer) => {
        const output = data.toString();

        // Log errors (cloudflared uses stderr for all output)
        // Only show real errors, not shutdown messages
        const lower = output.toLowerCase();
        if ((lower.includes('error') || lower.includes('fatal')) &&
            !lower.includes('context canceled') &&
            !lower.includes('connection terminated') &&
            !lower.includes('no more connections active')) {
          this.log(`[cloudflared:${devServerPort}] ${output.trim()}`);
        }

        // Check for tunnel URL in stderr too
        handleOutput(data);
      });

      proc.on('exit', (code, signal) => {
        this.log(`Tunnel exited for port ${devServerPort} with code ${code} signal ${signal}`);
        // Clean up injection proxy when tunnel exits
        const tunnel = this.tunnels.get(devServerPort);
        if (tunnel?.injectionProxy) {
          tunnel.injectionProxy.close().catch(() => {});
        }
        this.tunnels.delete(devServerPort);
        this.emit('tunnel-closed', devServerPort);
      });

      proc.on('error', (error) => {
        if (!resolved) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  /** Deterministic public URL for the railgate tunnel, from injected env. */
  private _railgatePublicUrl(): string | null {
    const sub = process.env.RAILGATE_SUBDOMAIN;
    const base = process.env.RAILGATE_BASE_DOMAIN;
    return sub && base ? `https://${sub}.${base}` : null;
  }

  /**
   * Single attempt to expose a port via the railgate relay (self-hosted tunnel).
   * The railgate client (baked into the sandbox image) reads RAILGATE_RELAY_URL /
   * RAILGATE_TOKEN / RAILGATE_SUBDOMAIN from env and dials out to the relay.
   * --force reclaims the stable subdomain so the URL persists across restarts.
   */
  private _createRailgateTunnelAttempt(
    devServerPort: number,
    tunnelTargetPort: number,
    injectionProxy?: InjectionProxy,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const subdomain = process.env.RAILGATE_SUBDOMAIN;
      const args = ['http', String(tunnelTargetPort), '--force'];
      if (subdomain) args.push('--subdomain', subdomain);
      this.log(`[tunnel] Starting railgate: railgate ${args.join(' ')} (dev server on ${devServerPort})`);

      const proc = spawn('railgate', args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let resolved = false;
      let parsedUrl: string | null = null;

      const finish = (url: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.tunnels.set(devServerPort, {
          url,
          port: devServerPort,
          proxyPort: tunnelTargetPort,
          process: proc,
          injectionProxy,
        });
        this.log(`✅ railgate tunnel ready: ${url} → localhost:${tunnelTargetPort}`);
        resolve(url);
      };

      const timeout = setTimeout(() => {
        if (resolved) return;
        // Best-effort: the URL is deterministic, so resolve with it even if we
        // never saw an explicit "active" marker (relay routes once connected).
        const url = parsedUrl ?? this._railgatePublicUrl();
        if (url) {
          this.log(`[tunnel] railgate URL (unconfirmed after 30s): ${url}`);
          finish(url);
        } else {
          proc.kill();
          reject(new Error('railgate tunnel timeout (30s) and no RAILGATE_BASE_DOMAIN to construct URL'));
        }
      }, 30000);

      const onData = (data: Buffer) => {
        const output = data.toString();
        if (!parsedUrl) {
          const m = output.match(/https:\/\/[a-zA-Z0-9.-]+/);
          if (m) parsedUrl = m[0];
        }
        if (!resolved && /tunnel active|registered|connected/i.test(output)) {
          const url = parsedUrl ?? this._railgatePublicUrl();
          if (url) finish(url);
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('exit', (code, signal) => {
        this.log(`railgate tunnel exited for port ${devServerPort} with code ${code} signal ${signal}`);
        const tunnel = this.tunnels.get(devServerPort);
        if (tunnel?.injectionProxy) tunnel.injectionProxy.close().catch(() => {});
        this.tunnels.delete(devServerPort);
        this.emit('tunnel-closed', devServerPort);
      });

      proc.on('error', (error) => {
        if (!resolved) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  /**
   * Close tunnel for a specific port
   */
  async closeTunnel(port: number): Promise<void> {
    const tunnel = this.tunnels.get(port);
    if (!tunnel) {
      this.log(`No tunnel found for port ${port}`);
      return;
    }

    this.log(`🔗 Closing tunnel for port ${port}...`);

    // Close injection proxy first (if exists) with timeout
    if (tunnel.injectionProxy) {
      try {
        // Use Promise.race to enforce timeout - injection proxy close can hang
        // if there are active HTTP keep-alive connections
        const PROXY_CLOSE_TIMEOUT_MS = 3000;
        await Promise.race([
          tunnel.injectionProxy.close(),
          new Promise<void>((resolve) => setTimeout(() => {
            this.log(`⚠️  Injection proxy close timed out after ${PROXY_CLOSE_TIMEOUT_MS}ms, continuing...`);
            resolve();
          }, PROXY_CLOSE_TIMEOUT_MS))
        ]);
        this.log(`✅ Injection proxy closed for port ${port}`);
      } catch (err) {
        this.log(`⚠️  Error closing injection proxy: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if not dead after 1 second
        if (!tunnel.process.killed) {
          tunnel.process.kill('SIGKILL');
        }
        this.tunnels.delete(port);
        resolve();
      }, 1000);

      tunnel.process.once('exit', () => {
        clearTimeout(timeout);
        this.tunnels.delete(port);
        resolve();
      });

      // Send SIGTERM
      tunnel.process.kill('SIGTERM');
    });
  }

  /**
   * Close all active tunnels
   */
  async closeAll(): Promise<void> {
    this.log(`🔗 Closing ${this.tunnels.size} active tunnel(s)...`);

    const ports = Array.from(this.tunnels.keys());
    await Promise.all(ports.map(port => this.closeTunnel(port)));
  }

  /**
   * Get tunnel URL for a specific port (if exists)
   */
  getTunnelUrl(port: number): string | null {
    const tunnel = this.tunnels.get(port);
    return tunnel ? tunnel.url : null;
  }

  /**
   * Get all active tunnels
   */
  getActiveTunnels(): Array<{ port: number; url: string }> {
    return Array.from(this.tunnels.values()).map(({ port, url }) => ({ port, url }));
  }
}

// Singleton instance
export const tunnelManager = new TunnelManager();
