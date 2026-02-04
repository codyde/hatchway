/**
 * Injection Proxy for Remote Runner Support
 * 
 * This proxy sits between the dev server and the Cloudflare tunnel,
 * injecting the element selection script into HTML responses.
 * 
 * This enables the "select element" feature to work when:
 * - Frontend is hosted remotely (e.g., Vercel)
 * - Runner is running locally on user's machine
 * - Traffic flows through Cloudflare tunnel
 * 
 * Without this proxy, the selection script can't be injected because
 * the iframe loads from a different origin (the tunnel URL).
 */

import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import zlib from 'zlib';
import { SELECTION_SCRIPT } from '@hatchway/agent-core/lib/selection/injector';

export interface InjectionProxyOptions {
  /** Dev server port to proxy to (e.g., 3000) */
  targetPort: number;
  /** Port for this proxy to listen on (default: 4000) */
  proxyPort?: number;
  /** Optional error handler */
  onError?: (err: Error) => void;
  /** Optional log function */
  log?: (...args: unknown[]) => void;
}

export interface InjectionProxy {
  /** Port the proxy is listening on */
  port: number;
  /** The HTTP server instance */
  server: http.Server;
  /** Close the proxy server */
  close: () => Promise<void>;
}

const DEFAULT_PROXY_PORT = 4000;

/**
 * Create an injection proxy that forwards requests to a dev server
 * while injecting the selection script into HTML responses.
 */
export async function createInjectionProxy(options: InjectionProxyOptions): Promise<InjectionProxy> {
  const { 
    targetPort, 
    proxyPort = DEFAULT_PROXY_PORT, 
    onError,
    log = console.log 
  } = options;

  const targetUrl = `http://localhost:${targetPort}`;

  // Create proxy with WebSocket support
  const proxy = httpProxy.createProxyServer({
    target: targetUrl,
    ws: true,
    selfHandleResponse: true, // We need to modify HTML responses
    changeOrigin: true,
  });

  const server = http.createServer((req, res) => {
    // Forward the request through proxy
    proxy.web(req, res, {}, (err) => {
      if (err) {
        onError?.(err);
        // Try to send error response if headers not sent
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Proxy error: ${err.message}`);
        }
      }
    });
  });

  // Handle WebSocket upgrades (critical for HMR in Vite/Next.js/etc)
  server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head, {}, (err) => {
      if (err) {
        onError?.(err);
        socket.destroy();
      }
    });
  });

  // Intercept responses to inject script into HTML
  proxy.on('proxyRes', (proxyRes, req, res) => {
    const contentType = proxyRes.headers['content-type'] || '';
    const isHtml = contentType.includes('text/html');

    if (!isHtml) {
      // Pass through non-HTML responses unchanged
      // Copy all headers
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    // Handle HTML - collect chunks and inject script
    const chunks: Buffer[] = [];
    const encoding = proxyRes.headers['content-encoding'];

    proxyRes.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proxyRes.on('end', () => {
      try {
        let body = Buffer.concat(chunks);

        // Decompress if needed
        if (encoding === 'gzip') {
          try {
            body = zlib.gunzipSync(body);
          } catch {
            // If decompression fails, pass through unchanged
            const headers = { ...proxyRes.headers };
            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(Buffer.concat(chunks));
            return;
          }
        } else if (encoding === 'deflate') {
          try {
            body = zlib.inflateSync(body);
          } catch {
            const headers = { ...proxyRes.headers };
            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(Buffer.concat(chunks));
            return;
          }
        } else if (encoding === 'br') {
          try {
            body = zlib.brotliDecompressSync(body);
          } catch {
            const headers = { ...proxyRes.headers };
            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(Buffer.concat(chunks));
            return;
          }
        }

        let html = body.toString('utf-8');

        // Inject selection script before </body> or </html> or at end
        const scriptTag = `<script>${SELECTION_SCRIPT}</script>`;
        
        if (html.toLowerCase().includes('</body>')) {
          html = html.replace(/<\/body>/i, `${scriptTag}</body>`);
        } else if (html.toLowerCase().includes('</html>')) {
          html = html.replace(/<\/html>/i, `${scriptTag}</html>`);
        } else {
          // Fallback: append at end
          html += scriptTag;
        }

        // Prepare response
        const responseBody = Buffer.from(html, 'utf-8');
        
        // Copy headers, update content-length, remove encoding (we decompressed)
        const headers: Record<string, string | number | string[] | undefined> = { ...proxyRes.headers };
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];
        headers['content-length'] = responseBody.length;

        res.writeHead(proxyRes.statusCode || 200, headers);
        res.end(responseBody);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
        // On error, try to pass through original response
        if (!res.headersSent) {
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          res.end(Buffer.concat(chunks));
        }
      }
    });

    proxyRes.on('error', (err) => {
      onError?.(err);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Proxy response error: ${err.message}`);
      }
    });
  });

  // Handle proxy errors
  proxy.on('error', (err, req, res) => {
    onError?.(err);
    if (res && 'writeHead' in res && !res.headersSent) {
      (res as http.ServerResponse).writeHead(502, { 'Content-Type': 'text/plain' });
      (res as http.ServerResponse).end(`Proxy error: ${err.message}`);
    }
  });

  // Start server and return promise
  return new Promise((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Injection proxy port ${proxyPort} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(proxyPort, '127.0.0.1', () => {
      log(`[injection-proxy] Started on port ${proxyPort} → localhost:${targetPort}`);
      
      resolve({
        port: proxyPort,
        server,
        close: () => new Promise<void>((resolveClose) => {
          // Add timeout to prevent hanging if connections don't close
          const CLOSE_TIMEOUT_MS = 2000;
          let resolved = false;
          
          const timeoutId = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              log(`[injection-proxy] Force closing after ${CLOSE_TIMEOUT_MS}ms timeout`);
              // Force destroy the server if it hasn't closed
              try {
                server.closeAllConnections?.();
              } catch {
                // closeAllConnections may not be available in older Node versions
              }
              resolveClose();
            }
          }, CLOSE_TIMEOUT_MS);
          
          proxy.close(() => {
            server.close(() => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeoutId);
                log(`[injection-proxy] Stopped`);
              }
              resolveClose();
            });
          });
        }),
      });
    });
  });
}

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find an available port starting from the given port
 */
export async function findAvailablePort(startPort: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
