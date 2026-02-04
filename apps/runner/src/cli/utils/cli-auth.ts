import http from 'node:http';
import { URL } from 'node:url';
import { hostname, platform } from 'node:os';
import { exec } from 'node:child_process';
import chalk from 'chalk';
import { configManager } from './config-manager.js';

/**
 * Open a URL in the default browser (cross-platform)
 */
export async function openBrowser(url: string): Promise<void> {
  const os = platform();
  
  return new Promise((resolve, reject) => {
    let command: string;
    
    switch (os) {
      case 'darwin':
        command = `open "${url}"`;
        break;
      case 'win32':
        command = `start "" "${url}"`;
        break;
      default: // Linux and others
        command = `xdg-open "${url}"`;
    }
    
    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

interface AuthResult {
  success: boolean;
  token?: string;
  error?: string;
}

interface CLIAuthOptions {
  apiUrl?: string;
  deviceName?: string;
  silent?: boolean;
}

/**
 * Find an available port for the callback server
 */
async function findAvailablePort(startPort: number = 9876, endPort: number = 9999): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    const isAvailable = await new Promise<boolean>((resolve) => {
      const server = http.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, '127.0.0.1');
    });
    
    if (isAvailable) {
      return port;
    }
  }
  
  throw new Error('No available ports found for OAuth callback server');
}

/**
 * Get a device name for the runner key
 */
function getDeviceName(): string {
  const host = hostname();
  const date = new Date().toLocaleDateString();
  return `CLI - ${host} - ${date}`;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
function startCallbackServer(port: number): Promise<AuthResult> {
  return new Promise((resolve) => {
    // Track active connections so we can forcefully close them
    const connections = new Set<import('net').Socket>();
    
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      
      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token');
        const status = url.searchParams.get('status');
        const error = url.searchParams.get('error');
        
        // Send response to browser
        res.writeHead(200, { 'Content-Type': 'text/html' });
        
        if (status === 'success' && token) {
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Authentication Successful</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    background: #09090b;
                    color: white;
                  }
                  .container {
                    text-align: center;
                    padding: 40px;
                  }
                  .success {
                    color: #22c55e;
                    font-size: 48px;
                    margin-bottom: 20px;
                  }
                  h1 { margin: 0 0 10px; }
                  p { color: #a1a1aa; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="success">&#10003;</div>
                  <h1>Authentication Successful!</h1>
                  <p>You can close this window and return to your terminal.</p>
                </div>
              </body>
            </html>
          `);
          
          // Close server and resolve - destroy all connections to ensure clean exit
          server.close();
          connections.forEach(conn => conn.destroy());
          resolve({ success: true, token });
        } else {
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Authentication Failed</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    background: #09090b;
                    color: white;
                  }
                  .container {
                    text-align: center;
                    padding: 40px;
                  }
                  .error {
                    color: #ef4444;
                    font-size: 48px;
                    margin-bottom: 20px;
                  }
                  h1 { margin: 0 0 10px; }
                  p { color: #a1a1aa; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="error">&#10007;</div>
                  <h1>Authentication Failed</h1>
                  <p>${error || 'An error occurred during authentication.'}</p>
                  <p>Please close this window and try again.</p>
                </div>
              </body>
            </html>
          `);
          
          server.close();
          connections.forEach(conn => conn.destroy());
          resolve({ success: false, error: error || 'Authentication failed' });
        }
      } else {
        // Handle other paths
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });
    
    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close();
      connections.forEach(conn => conn.destroy());
      resolve({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
    
    server.on('close', () => {
      clearTimeout(timeout);
    });
    
    // Handle server errors (e.g., port became unavailable due to race condition)
    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        resolve({ success: false, error: `Port ${port} is no longer available. Please try again.` });
      } else {
        resolve({ success: false, error: `Server error: ${err.message}` });
      }
    });
    
    // Track connections for cleanup
    server.on('connection', (conn) => {
      connections.add(conn);
      conn.on('close', () => connections.delete(conn));
    });
    
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Perform CLI OAuth authentication flow
 * 
 * 1. Find an available port
 * 2. Start local callback server
 * 3. Request auth session from API
 * 4. Open browser to auth page
 * 5. Wait for callback
 * 6. Return token
 */
export async function performOAuthLogin(options: CLIAuthOptions = {}): Promise<AuthResult> {
  const apiUrl = options.apiUrl || 'https://hatchway.sh';
  const deviceName = options.deviceName || getDeviceName();
  const silent = options.silent || false;
  
  try {
    // Find available port
    if (!silent) {
      console.log(chalk.dim('Finding available port for callback...'));
    }
    const port = await findAvailablePort();
    
    // Start callback server before requesting auth (so it's ready when browser redirects)
    const callbackPromise = startCallbackServer(port);
    
    // Request auth session from API
    if (!silent) {
      console.log(chalk.dim('Initiating authentication...'));
    }
    
    const response = await fetch(`${apiUrl}/api/auth/cli/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        callbackPort: port,
        callbackHost: 'localhost',
        deviceName,
      }),
    });
    
    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to start authentication' };
    }
    
    const { authUrl } = await response.json();
    
    // Open browser
    if (!silent) {
      console.log('');
      console.log(chalk.cyan('Opening browser for authentication...'));
      console.log(chalk.dim(`If the browser doesn't open, visit:`));
      console.log(chalk.underline(authUrl));
      console.log('');
    }
    
    try {
      await openBrowser(authUrl);
    } catch {
      // Browser failed to open - user will need to copy/paste URL
      if (!silent) {
        console.log(chalk.yellow('Could not open browser automatically.'));
      }
    }
    
    if (!silent) {
      console.log(chalk.yellow('Waiting for authentication...'));
      console.log(chalk.dim('(Press Ctrl+C to cancel)'));
    }
    
    // Wait for callback
    const result = await callbackPromise;
    
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
    };
  }
}

/**
 * Check if we have a valid stored token
 */
export function hasStoredToken(): boolean {
  const token = getStoredToken();
  return token !== null && token.startsWith('sv_');
}

/**
 * Get the stored runner token
 */
export function getStoredToken(): string | null {
  const config = configManager.get();
  
  // Check for runner token in config
  if (config.server?.secret && config.server.secret.startsWith('sv_')) {
    return config.server.secret;
  }
  
  // Legacy: check broker config
  if (config.broker?.secret && config.broker.secret.startsWith('sv_')) {
    return config.broker.secret;
  }
  
  return null;
}

/**
 * Store the runner token in config
 */
export function storeToken(token: string, apiUrl?: string): void {
  // Determine the WebSocket URL from the API URL
  let wsUrl = 'wss://hatchway.sh/ws/runner';
  if (apiUrl) {
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${url.host}/ws/runner`;
  }
  
  // Store in the server config
  configManager.set('server', {
    wsUrl,
    secret: token,
  });
  
  // Also set the apiUrl if provided
  if (apiUrl) {
    configManager.set('apiUrl', apiUrl);
  }
}

/**
 * Clear the stored token
 */
export function clearToken(): void {
  const config = configManager.get();
  
  // Clear server secret
  if (config.server) {
    configManager.set('server', {
      ...config.server,
      secret: '',
    });
  }
  
  // Clear legacy broker secret
  if (config.broker) {
    configManager.set('broker', {
      ...config.broker,
      secret: '',
    });
  }
}

/**
 * Validate the stored token against the server
 */
export async function validateToken(token: string, apiUrl: string): Promise<boolean> {
  try {
    // Try to fetch user's runner keys - this will fail if token is invalid
    const response = await fetch(`${apiUrl}/api/runner-keys`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    return response.ok;
  } catch {
    return false;
  }
}
