import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { SELECTION_SCRIPT } from '@hatchway/agent-core/lib/selection/injector';
import { httpProxyManager, buildWebSocketServer } from '@hatchway/agent-core/lib/websocket';

// Feature flag for WebSocket proxy (can be controlled via env var)
// When enabled, uses WebSocket tunnel instead of Cloudflare tunnel for remote access
// Check both server-side and NEXT_PUBLIC_ versions for flexibility
const USE_WS_PROXY = process.env.USE_WS_PROXY === 'true' || process.env.NEXT_PUBLIC_USE_WS_PROXY === 'true';

/**
 * Fetch via WebSocket proxy (HTTP-over-WebSocket)
 * Used when frontend is remote and USE_WS_PROXY is enabled
 */
async function fetchViaWsProxy(
  runnerId: string,
  projectId: string, 
  port: number,
  path: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  body?: Buffer
): Promise<Response> {
  const result = await httpProxyManager.proxyRequest(runnerId, projectId, port, {
    method,
    path,
    headers,
    body,
  });
  
  // Convert proxy result to Response object
  // Convert Buffer to Uint8Array for Response constructor
  return new Response(new Uint8Array(result.body), {
    status: result.statusCode,
    headers: result.headers,
  });
}

/**
 * Simple, robust proxy for dev servers
 * Routes ALL requests through this endpoint to avoid CORS issues
 */

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

// POST support for TanStack Start server functions
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const path = url.searchParams.get('path') || '/';
  let proj: (typeof projects.$inferSelect) | undefined;

  try {
    // Get project
    const project = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (project.length === 0) {
      return new NextResponse('Project not found', { status: 404 });
    }

    proj = project[0];

    // Check if server running
    if (proj.devServerStatus !== 'running' || !proj.devServerPort) {
      return new NextResponse('Dev server not running', { status: 503 });
    }

    // Determine target URL
    const requestHost = req.headers.get('host') || '';
    const frontendIsLocal = requestHost.includes('localhost') || requestHost.includes('127.0.0.1');

    let targetUrl: string;
    let useWsProxy = false;
    
    if (frontendIsLocal) {
      targetUrl = `http://localhost:${proj.devServerPort}${path}`;
    } else if (USE_WS_PROXY && proj.runnerId && buildWebSocketServer.isRunnerConnected(proj.runnerId)) {
      // WebSocket proxy enabled and runner is connected
      console.log(`[proxy POST] Using WebSocket proxy to runner ${proj.runnerId}`);
      useWsProxy = true;
      targetUrl = ''; // Not used when useWsProxy is true
    } else if (proj.tunnelUrl) {
      targetUrl = `${proj.tunnelUrl}${path}`;
    } else if (USE_WS_PROXY && proj.runnerId) {
      // WebSocket proxy enabled but runner not connected
      return new NextResponse('Waiting for runner connection...', {
        status: 202,
        headers: { 'X-Tunnel-Status': 'pending', 'X-Proxy-Mode': 'websocket' }
      });
    } else {
      return new NextResponse('Waiting for tunnel...', {
        status: 202,
        headers: { 'X-Tunnel-Status': 'pending' }
      });
    }

    // Forward POST request with body - use arrayBuffer to preserve binary data
    const bodyBuffer = await req.arrayBuffer();
    let response: Response;
    
    if (useWsProxy && proj.runnerId && proj.devServerPort) {
      // Use WebSocket proxy
      response = await fetchViaWsProxy(
        proj.runnerId,
        id,
        proj.devServerPort,
        path,
        'POST',
        { 
          'Content-Type': req.headers.get('content-type') || 'application/json',
          'Accept': req.headers.get('accept') || '*/*'
        },
        bodyBuffer.byteLength > 0 ? Buffer.from(bodyBuffer) : undefined
      );
    } else {
      // Direct fetch to target URL
      response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': req.headers.get('content-type') || 'application/json',
        },
        body: bodyBuffer,
      });
    }

    // Return response as-is with CORS headers
    const responseBody = await response.arrayBuffer();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('❌ Proxy POST error:', error);
    return new NextResponse(
      `Proxy failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const path = url.searchParams.get('path') || '/';
  let proj: (typeof projects.$inferSelect) | undefined;

  try {
    // Get project
    const project = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (project.length === 0) {
      return new NextResponse('Project not found', { status: 404 });
    }

    proj = project[0];

    // Check if server running
    if (proj.devServerStatus !== 'running' || !proj.devServerPort) {
      return new NextResponse('Dev server not running', { status: 503 });
    }

    // Determine target URL based on where the USER is accessing the frontend from
    // Check the Host header to see if frontend is being accessed locally or remotely
    const requestHost = req.headers.get('host') || '';
    const frontendIsLocal = requestHost.includes('localhost') || requestHost.includes('127.0.0.1');

    let targetUrl: string;
    let useWsProxy = false;

    if (frontendIsLocal) {
      // User accessing frontend via localhost (e.g., http://localhost:3000)
      // This means frontend and runner are on the SAME machine
      // Proxy can directly access runner's localhost
      targetUrl = `http://localhost:${proj.devServerPort}${path}`;
    } else if (USE_WS_PROXY && proj.runnerId && buildWebSocketServer.isRunnerConnected(proj.runnerId)) {
      // WebSocket proxy enabled and runner is connected
      // Use HTTP-over-WebSocket to reach the dev server
      console.log(`[proxy] Frontend accessed via ${requestHost} - using WebSocket proxy to runner ${proj.runnerId}`);
      useWsProxy = true;
      targetUrl = ''; // Not used when useWsProxy is true
    } else if (proj.tunnelUrl) {
      // User accessing frontend via remote URL (e.g., hatchway.up.railway.app)
      // Frontend and runner are on DIFFERENT machines
      // Proxy must use tunnel to reach runner
      targetUrl = `${proj.tunnelUrl}${path}`;
      console.log(`[proxy] Frontend accessed via ${requestHost} - using tunnel ${proj.tunnelUrl}`);
    } else if (USE_WS_PROXY && proj.runnerId) {
      // WebSocket proxy enabled but runner not connected - wait
      console.warn(`[proxy] Remote access via ${requestHost} - waiting for runner ${proj.runnerId} to connect`);
      return new NextResponse(
        'Waiting for runner connection...',
        { status: 202, headers: { 'X-Tunnel-Status': 'pending', 'X-Proxy-Mode': 'websocket' } }
      );
    } else {
      // Frontend accessed remotely but no tunnel exists yet
      // Return a special status that frontend can detect and handle gracefully
      console.warn(`[proxy] Remote access via ${requestHost} - waiting for tunnel to be created for project ${id}`);
      return new NextResponse(
        'Waiting for tunnel...',
        { status: 202, headers: { 'X-Tunnel-Status': 'pending' } }
      );
    }
    let response: Response;
    try {
      if (useWsProxy && proj.runnerId && proj.devServerPort) {
        // Use WebSocket proxy
        response = await fetchViaWsProxy(
          proj.runnerId,
          id,
          proj.devServerPort,
          path,
          'GET',
          { 'Accept': req.headers.get('accept') || '*/*' }
        );
      } else {
        // Direct fetch to target URL
        response = await fetch(targetUrl, {
          // Add timeout to prevent hanging on failed imports
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });
      }
    } catch (error) {
      // Handle network errors and failed dynamic imports gracefully
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[proxy] Request timeout for ${path}`);
        return new NextResponse(
          `Request timeout: Failed to fetch ${path}`,
          { status: 504 }
        );
      }
      // Handle failed dynamic import module errors (e.g., Astro modules)
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        console.error(`[proxy] Failed to fetch module: ${path}`, error);
        return new NextResponse(
          `Failed to fetch module: ${path}. The module may not exist or the dev server may be restarting.`,
          { 
            status: 404,
            headers: {
              'Content-Type': 'text/plain',
              'Access-Control-Allow-Origin': '*',
            }
          }
        );
      }
      throw error;
    }

    // Check if response is ok before processing
    if (!response.ok) {
      console.error(`[proxy] Upstream error: ${response.status} for ${path}`);
      return new NextResponse(
        `Upstream error: ${response.status} ${response.statusText}`,
        { 
          status: response.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }

    const contentType = response.headers.get('content-type') || '';
    const isViteChunk = path.includes('/node_modules/.vite/') || /chunk-[A-Z0-9]+\.js/i.test(path);

    // HTML - Inject base tag, Vite config, and selection script
    if (contentType.includes('text/html')) {
      let html = await response.text();

      // Inject base tag, pathname fix, and request interceptors FIRST (before ANY content)
      // CRITICAL: These must run before ANY other scripts to intercept Vite's requests
      const earlyScripts = `<script>
(function() {
  var proxyPrefix = '/api/projects/${id}/proxy?path=';
  
  // Helper to check if a path should be proxied
  function shouldProxy(path) {
    if (!path || typeof path !== 'string') return false;
    if (path.includes('/api/projects/')) return false;
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('//')) return false;
    // Check for known framework paths that need proxying
    if (path.startsWith('/src/') || 
        path.startsWith('/@') || 
        path.startsWith('/node_modules/') ||
        path.startsWith('/_serverFn/') ||
        path.startsWith('/_next/')) {  // Next.js chunks
      return true;
    }
    // Check for static assets by file extension
    if (path.match(/\\.(css|js|ts|tsx|jsx|mjs|json|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico)(\\?.*)?$/i)) {
      return true;
    }
    return false;
  }
  
  function proxyUrl(path) {
    return proxyPrefix + encodeURIComponent(path);
  }

  // CRITICAL: Override webpack's public path for Next.js chunk loading
  // Webpack uses __webpack_public_path__ (which becomes __webpack_require__.p) to construct chunk URLs
  // We need to override this BEFORE webpack bootstrap runs
  // Setting it to empty string makes webpack use relative paths, which our base tag then handles
  window.__webpack_public_path__ = proxyPrefix.replace('?path=', '?path=%2F');
  
  // Also try to intercept when webpack sets __webpack_require__.p
  // This handles cases where webpack has already bootstrapped
  Object.defineProperty(window, '__webpack_require__', {
    configurable: true,
    set: function(wr) {
      if (wr && typeof wr === 'object') {
        // Intercept the 'p' property (publicPath) when it gets set
        var originalP = wr.p;
        Object.defineProperty(wr, 'p', {
          configurable: true,
          get: function() { return proxyPrefix.replace('?path=', '?path=%2F'); },
          set: function(v) { originalP = v; }
        });
      }
      Object.defineProperty(window, '__webpack_require__', {
        configurable: true,
        writable: true,
        value: wr
      });
    },
    get: function() { return undefined; }
  });

  // Path normalization for TanStack Router
  try {
    var url = new URL(window.location.href);
    var actualPath = url.searchParams.get('path') || '/';
    if (window.location.pathname !== actualPath) {
      var newUrl = window.location.origin + actualPath + (url.hash || '');
      history.replaceState(null, '', newUrl);
    }
  } catch (e) {
    console.warn('[Hatchway] Path normalization failed:', e);
  }

  // Fetch interceptor
  var originalFetch = window.fetch;
  window.fetch = function(resource, options) {
    if (typeof resource === 'string' && shouldProxy(resource)) {
      return originalFetch(proxyUrl(resource), options);
    }
    return originalFetch(resource, options);
  };

  // XMLHttpRequest interceptor
  var originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && shouldProxy(url)) {
      arguments[1] = proxyUrl(url);
    }
    return originalXHROpen.apply(this, arguments);
  };

  // Intercept dynamic element creation for link/script/img elements via setAttribute
  var originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'href' || name === 'src') && typeof value === 'string' && shouldProxy(value)) {
      value = proxyUrl(value);
    }
    return originalSetAttribute.call(this, name, value);
  };

  // CRITICAL: Intercept direct property assignments for script.src and link.href
  // Webpack/Next.js set these directly, not via setAttribute
  // This catches dynamic chunk loading that bypasses setAttribute
  
  // Intercept script.src direct assignments
  var scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if (scriptSrcDescriptor && scriptSrcDescriptor.set) {
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      set: function(value) {
        if (typeof value === 'string' && shouldProxy(value)) {
          value = proxyUrl(value);
        }
        scriptSrcDescriptor.set.call(this, value);
      },
      get: scriptSrcDescriptor.get,
      configurable: true
    });
  }

  // Intercept link.href direct assignments (for CSS chunks)
  var linkHrefDescriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
  if (linkHrefDescriptor && linkHrefDescriptor.set) {
    Object.defineProperty(HTMLLinkElement.prototype, 'href', {
      set: function(value) {
        if (typeof value === 'string' && shouldProxy(value)) {
          value = proxyUrl(value);
        }
        linkHrefDescriptor.set.call(this, value);
      },
      get: linkHrefDescriptor.get,
      configurable: true
    });
  }

  // Intercept img.src direct assignments (for dynamically loaded images)
  var imgSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imgSrcDescriptor && imgSrcDescriptor.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      set: function(value) {
        if (typeof value === 'string' && shouldProxy(value)) {
          value = proxyUrl(value);
        }
        imgSrcDescriptor.set.call(this, value);
      },
      get: imgSrcDescriptor.get,
      configurable: true
    });
  }
})();
</script>`;

      const baseTag = `<head>
    ${earlyScripts}
    <base href="/api/projects/${id}/proxy?path=/">`;
      if (/<head>/i.test(html)) {
        html = html.replace(/<head>/i, baseTag);
      }

      // Rewrite src/href attributes that point to absolute root paths
      html = html.replace(
        /(src|href)=(["'])(\/(?!\/)[^"']*)(["'])/gi,
        (match, attr, quote, assetPath) => {
          if (assetPath.startsWith('/api/projects/')) return match;

          // CRITICAL: Add ?direct for CSS files to get actual CSS from Vite
          let pathWithParams = assetPath;
          if (assetPath.match(/\.css$/i) && !assetPath.includes('?')) {
            pathWithParams = `${assetPath}?direct`;
          }

          const proxyUrl = `/api/projects/${id}/proxy?path=${encodeURIComponent(pathWithParams)}`;
          return `${attr}=${quote}${proxyUrl}${quote}`;
        }
      );

      // Rewrite inline module imports in <script type="module"> tags
      // Must handle attributes like async, defer, etc.
      html = html.replace(
        /<script\s+([^>]*?type=["']module["'][^>]*?)>([\s\S]*?)<\/script>/gi,
        (match, attrs, scriptContent) => {
          // Rewrite imports inside inline scripts
          const rewritten = scriptContent.replace(
            /(from\s+["']|import\s*\(["'])(\/[^"']+)(["'])/g,
            (importMatch: string, prefix: string, importPath: string, suffix: string) => {
              const proxyUrl = `/api/projects/${id}/proxy?path=${encodeURIComponent(importPath)}`;
              return `${prefix}${proxyUrl}${suffix}`;
            }
          );
          return `<script ${attrs}>${rewritten}</script>`;
        }
      );

      // Inject selection script before closing body
      const scriptTag = `<script>${SELECTION_SCRIPT}</script></body>`;
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, scriptTag);
      } else {
        html += `<script>${SELECTION_SCRIPT}</script>`;
      }

      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // JavaScript/TypeScript - Rewrite imports to go through proxy
    // CRITICAL: Also rewrite CSS imports for TanStack Start
    // NOTE: In Vite dev mode, .css files return JavaScript (HMR wrapper), not actual CSS
    if (
      contentType.includes('javascript') ||
      contentType.includes('typescript') ||
      path.includes('/@vite/') ||
      path.includes('/@react-refresh') ||
      path.endsWith('.tsx') ||
      path.endsWith('.ts') ||
      path.endsWith('.jsx') ||
      path.endsWith('.mjs') ||
      (path.endsWith('.css') && !path.includes('?direct'))
    ) {
      let js = await response.text();

      // CRITICAL: Handle Vite ?url responses specially
      // They export URL strings like: export default "/src/styles.css"
      const isViteUrlExport = path.includes('?url');

      if (isViteUrlExport) {
        // For ?url exports, rewrite the exported path to include proxy and ?direct
        // This prevents hydration mismatches
        js = js.replace(
          /export\s+default\s+"(\/[^"]+\.css)"/g,
          (match, cssPath) => {
            const pathWithDirect = `${cssPath}?direct`;
            const proxyUrl = `/api/projects/${id}/proxy?path=${encodeURIComponent(pathWithDirect)}`;
            return `export default "${proxyUrl}"`;
          }
        );
      } else {
        // TanStack Start Fix: Rewrite CSS imports with ?url parameter
        // Pattern: import appCss from '../styles.css?url'
        // This is the ROOT CAUSE fix - CSS URLs are embedded in JS constants
        js = js.replace(
          /(from\s+["'])([^"']+\.css)(\?url)?(["'])/g,
          (match, prefix, cssPath, urlParam, suffix) => {
            // Skip if already proxied
            if (cssPath.includes('/api/projects/')) return match;

            // Resolve relative paths to absolute
            let absolutePath = cssPath;
            if (cssPath.startsWith('./') || cssPath.startsWith('../')) {
              // Get the directory of the current module
              const moduleDir = path.substring(0, path.lastIndexOf('/'));
              // Resolve relative to absolute
              const resolved = new URL(cssPath, `http://dummy${moduleDir}/`).pathname;
              absolutePath = resolved;
            }

            // Keep the ?url parameter when proxying
            const proxyUrl = `/api/projects/${id}/proxy?path=${encodeURIComponent(absolutePath)}${urlParam || ''}`;
            return `${prefix}${proxyUrl}${suffix}`;
          }
        );
      }

      // Rewrite ALL absolute imports to go through our proxy
      // But NOT for Vite ?url responses (they just export URL strings)
      if (!isViteUrlExport) {
        js = js.replace(
          /(from\s+["']|import\s*\(\s*["']|import\s+["']|require\s*\(\s*["']|export\s+\*\s+from\s+["'])(\/[^"']+)(["'])/g,
          (match, prefix, importPath, suffix) => {
            // Skip if already proxied
            if (importPath.includes('/api/projects/')) return match;

            const proxyUrl = `/api/projects/${id}/proxy?path=${encodeURIComponent(importPath)}`;
            return `${prefix}${proxyUrl}${suffix}`;
          }
        );
      }

      const cacheControl = isViteChunk
        ? 'public, max-age=600, immutable'
        : 'no-cache';

      return new NextResponse(js, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // CSS - Rewrite url() paths
    if (contentType.includes('text/css') || contentType.includes('stylesheet')) {
      let css = await response.text();

      css = css.replace(
        /url\(\s*(['"]?)(?!http|data:|#)([^'")]+)\1\s*\)/gi,
        (match, quote, urlPath) => {
          const cleanPath = urlPath.trim();
          const absolutePath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
          const proxyUrl = `/api/projects/${id}/proxy?path=${encodeURIComponent(absolutePath)}`;
          return `url(${quote}${proxyUrl}${quote})`;
        }
      );

      const cacheControl = isViteChunk
        ? 'public, max-age=600, immutable'
        : 'no-cache';

      return new NextResponse(css, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Everything else - Just proxy with CORS headers
    // Preserve ALL headers from upstream (important for TanStack Start server functions)
    const buffer = await response.arrayBuffer();

    const headers = new Headers();
    // Copy all upstream headers
    response.headers.forEach((value, key) => {
      headers.set(key, value);
    });

    // Add/override CORS headers
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', '*');

    // Override cache control for server functions and API routes to prevent stale data
    if (path.startsWith('/_serverFn/') || path.startsWith('/api/')) {
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    return new NextResponse(buffer, { headers });

  } catch (error) {
    console.error('❌ Proxy error:', error);
    console.error('   Project:', id);
    console.error('   Path:', path);
    console.error('   Port:', proj?.devServerPort);
    console.error('   Tunnel URL:', proj?.tunnelUrl);
    console.error('   Dev server status:', proj?.devServerStatus);
    return new NextResponse(
      `Proxy failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
}
