/**
 * Dependency-free HTML-injection reverse proxy, shipped INTO the Railway
 * sandbox and run with the sandbox's own Node (built-ins only — the sandbox
 * has no node_modules of ours, so we can't use the runner's http-proxy-based
 * injection-proxy here).
 *
 * Mirrors what the local runner does (tunnel → injection proxy → dev server):
 * railgate points at this proxy, the proxy forwards to the dev server and
 * injects the element-selection <script> into HTML responses. Without it the
 * sandbox preview loads railgate's raw HTML and the "select element" tool —
 * which needs the script present in the previewed page — does nothing.
 *
 * Reads the selection script from /tmp/selection-script.js (written alongside
 * this file) so we don't have to escape it into the source. Listens on
 * PROXY_PORT, forwards to TARGET_PORT (both via env), passes non-HTML and
 * WebSocket upgrades (HMR) straight through.
 */

/** Fixed in-sandbox port for the injection proxy (kept clear of dev-server ports). */
export const INJECT_PROXY_PORT = 8420;

/** Absolute path of the proxy script inside the sandbox. */
export const INJECT_PROXY_PATH = '/tmp/inject-proxy.cjs';

/** Absolute path of the raw selection script inside the sandbox. */
export const SELECTION_SCRIPT_PATH = '/tmp/selection-script.js';

export const INJECT_PROXY_SOURCE = String.raw`
'use strict';
const http = require('http');
const net = require('net');
const zlib = require('zlib');
const fs = require('fs');

const TARGET_PORT = Number(process.env.TARGET_PORT);
const PROXY_PORT = Number(process.env.PROXY_PORT);

let SCRIPT_TAG = '';
try {
  SCRIPT_TAG = '<script>' + fs.readFileSync('${SELECTION_SCRIPT_PATH}', 'utf8') + '</script>';
} catch (e) {
  console.error('[inject-proxy] could not read selection script:', e && e.message);
}

function injectInto(html) {
  if (!SCRIPT_TAG) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, SCRIPT_TAG + '</body>');
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, SCRIPT_TAG + '</html>');
  return html + SCRIPT_TAG;
}

const server = http.createServer((req, res) => {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + TARGET_PORT }),
    },
    (upRes) => {
      const ct = String(upRes.headers['content-type'] || '');
      if (!ct.includes('text/html')) {
        res.writeHead(upRes.statusCode || 200, upRes.headers);
        upRes.pipe(res);
        return;
      }
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        let raw = Buffer.concat(chunks);
        const enc = String(upRes.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') raw = zlib.gunzipSync(raw);
          else if (enc === 'deflate') raw = zlib.inflateSync(raw);
          else if (enc === 'br') raw = zlib.brotliDecompressSync(raw);
        } catch (e) {
          // Can't decode — pass the original bytes through untouched.
          res.writeHead(upRes.statusCode || 200, upRes.headers);
          res.end(Buffer.concat(chunks));
          return;
        }
        const out = Buffer.from(injectInto(raw.toString('utf8')), 'utf8');
        const headers = Object.assign({}, upRes.headers);
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];
        headers['content-length'] = out.length;
        res.writeHead(upRes.statusCode || 200, headers);
        res.end(out);
      });
      upRes.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    }
  );
  upstream.on('error', () => {
    if (res.headersSent) { try { res.end(); } catch (e) {} return; }
    // Dev server not accepting connections yet (still compiling/binding). For a
    // top-level HTML navigation, serve an auto-refreshing splash so the preview
    // recovers on its own instead of showing a hard "upstream error". Other
    // requests (assets/XHR) just get a 503 the page will retry.
    var accept = String(req.headers['accept'] || '');
    if (req.method === 'GET' && accept.indexOf('text/html') !== -1) {
      res.writeHead(503, { 'content-type': 'text/html', 'retry-after': '2', 'cache-control': 'no-store' });
      res.end('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Starting preview…</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#0b0b0f;color:#9aa0b0;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><div style="font-size:14px;opacity:.8">Starting preview…</div><div style="font-size:12px;opacity:.5;margin-top:8px">the dev server is still warming up</div></div></body></html>');
    } else {
      res.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '2' });
      res.end('dev server warming up');
    }
  });
  req.pipe(upstream);
});

// Pass WebSocket upgrades (HMR) straight through at the TCP level.
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(TARGET_PORT, '127.0.0.1', () => {
    let raw = req.method + ' ' + req.url + ' HTTP/1.1\r\n';
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1] + '\r\n';
    }
    upstream.write(raw + '\r\n');
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log('[inject-proxy] listening on ' + PROXY_PORT + ' -> 127.0.0.1:' + TARGET_PORT);
});
`;
