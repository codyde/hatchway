/**
 * HMR Proxy Script - Injected into preview iframe
 * 
 * This script intercepts Vite's HMR WebSocket connections and replaces them
 * with a fake WebSocket that communicates via postMessage to the parent frame.
 * 
 * Flow:
 * 1. Vite tries to create: new WebSocket('ws://localhost:5173', 'vite-hmr')
 * 2. We intercept and create a FakeWebSocket instead
 * 3. FakeWebSocket sends messages via postMessage to parent window
 * 4. Parent (PreviewPanel) receives and forwards through the main WS connection
 * 5. HMR messages from server flow back via postMessage
 */

export const HMR_PROXY_SCRIPT = `
(function() {
  // Only run in iframe context
  if (window === window.parent) {
    return;
  }

  // Track if we've initialized
  if (window.__hatchwayHmrProxyInit) {
    return;
  }
  window.__hatchwayHmrProxyInit = true;

  // Store original WebSocket constructor
  const OriginalWebSocket = window.WebSocket;
  
  // Track active fake WebSocket connections
  const activeConnections = new Map();
  
  // Dev server port - set by parent via postMessage
  // null means we haven't received config yet
  let devServerPort = null;
  
  // Queue of connections waiting for port config
  const pendingConnections = [];

  /**
   * FakeWebSocket - Mimics WebSocket API but uses postMessage
   */
  class FakeWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = WebSocket.CONNECTING;
      this.bufferedAmount = 0;
      this.extensions = '';
      this.protocol = Array.isArray(protocols) ? protocols[0] : (protocols || '');
      this.binaryType = 'blob';
      
      // Event handlers
      this.onopen = null;
      this.onclose = null;
      this.onmessage = null;
      this.onerror = null;
      
      // Event listeners
      this._listeners = {
        open: [],
        close: [],
        message: [],
        error: [],
      };
      
      // Generate connection ID
      this._connectionId = 'hmr-' + Math.random().toString(36).substring(2, 11);
      
      // Store in active connections
      activeConnections.set(this._connectionId, this);
      
      // Request connection from parent
      this._requestConnect();
    }
    
    _requestConnect() {
      // Try to get port: first from parent config, then from URL
      let port = devServerPort;
      
      if (port === null) {
        // Try to extract from URL
        try {
          const urlObj = new URL(this.url);
          const urlPort = parseInt(urlObj.port, 10);
          // Only use URL port if it's a valid dev server port (not 80/443)
          if (urlPort && urlPort !== 80 && urlPort !== 443) {
            port = urlPort;
          }
        } catch (e) {}
      }
      
      // If we still don't have a valid port, HMR is disabled
      if (port === null || port === 80 || port === 443) {
        console.warn('[HMR Proxy] Cannot determine dev server port - HMR disabled for remote preview. URL:', this.url);
        // Queue for later in case parent sends config
        pendingConnections.push(this);
        return;
      }
      
      // Send connect request to parent
      window.parent.postMessage({
        type: 'hatchway:hmr:connect',
        connectionId: this._connectionId,
        port: port,
        protocol: this.protocol,
      }, '*');
    }
    
    send(data) {
      if (this.readyState !== WebSocket.OPEN) {
        throw new DOMException('WebSocket is not open', 'InvalidStateError');
      }
      
      // Forward message to parent
      window.parent.postMessage({
        type: 'hatchway:hmr:send',
        connectionId: this._connectionId,
        message: typeof data === 'string' ? data : JSON.stringify(data),
      }, '*');
    }
    
    close(code = 1000, reason = '') {
      if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) {
        return;
      }
      
      this.readyState = WebSocket.CLOSING;
      
      // Tell parent to close connection
      window.parent.postMessage({
        type: 'hatchway:hmr:disconnect',
        connectionId: this._connectionId,
        code: code,
        reason: reason,
      }, '*');
      
      // Clean up
      activeConnections.delete(this._connectionId);
    }
    
    addEventListener(type, listener) {
      if (this._listeners[type]) {
        this._listeners[type].push(listener);
      }
    }
    
    removeEventListener(type, listener) {
      if (this._listeners[type]) {
        const idx = this._listeners[type].indexOf(listener);
        if (idx !== -1) {
          this._listeners[type].splice(idx, 1);
        }
      }
    }
    
    dispatchEvent(event) {
      const listeners = this._listeners[event.type] || [];
      for (const listener of listeners) {
        listener.call(this, event);
      }
      
      // Also call on* handler if set
      const handler = this['on' + event.type];
      if (typeof handler === 'function') {
        handler.call(this, event);
      }
      
      return true;
    }
    
    // Called when connection is established (from parent message)
    _onConnected() {
      this.readyState = WebSocket.OPEN;
      
      const event = new Event('open');
      this.dispatchEvent(event);
    }
    
    // Called when message received (from parent message)
    _onMessage(data) {
      const event = new MessageEvent('message', { data });
      this.dispatchEvent(event);
    }
    
    // Called when connection closed (from parent message)
    _onClosed(code, reason) {
      this.readyState = WebSocket.CLOSED;
      activeConnections.delete(this._connectionId);
      
      const event = new CloseEvent('close', { code, reason, wasClean: code === 1000 });
      this.dispatchEvent(event);
    }
    
    // Called when error occurs (from parent message)
    _onError(message) {
      const event = new Event('error');
      this.dispatchEvent(event);
    }
  }
  
  // Add static properties
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;

  /**
   * Check if this WebSocket connection should be intercepted
   * We intercept Vite HMR connections (protocol 'vite-hmr' or URL pattern)
   */
  function shouldIntercept(url, protocols) {
    // Check for vite-hmr protocol
    if (protocols) {
      const protocolList = Array.isArray(protocols) ? protocols : [protocols];
      if (protocolList.includes('vite-hmr')) {
        return true;
      }
    }
    
    // Check URL patterns for common dev server WebSocket endpoints
    try {
      const urlObj = new URL(url, window.location.href);
      
      // Vite HMR typically connects to localhost or 127.0.0.1
      const isLocalhost = urlObj.hostname === 'localhost' || 
                          urlObj.hostname === '127.0.0.1' ||
                          urlObj.hostname === '0.0.0.0';
      
      // Check for common HMR paths
      const isHmrPath = urlObj.pathname === '/' || 
                        urlObj.pathname.includes('/__vite') ||
                        urlObj.pathname.includes('/ws');
      
      // Common dev server ports
      const isDevPort = [3000, 3001, 5173, 5174, 8080, 8081].includes(parseInt(urlObj.port, 10));
      
      return isLocalhost && (isHmrPath || isDevPort);
    } catch (e) {
      return false;
    }
  }

  /**
   * Proxy WebSocket constructor
   */
  const ProxiedWebSocket = function(url, protocols) {
    if (shouldIntercept(url, protocols)) {
      return new FakeWebSocket(url, protocols);
    }
    
    // Let non-HMR connections through (shouldn't happen in proxy mode)
    return new OriginalWebSocket(url, protocols);
  };
  
  // Copy static properties
  ProxiedWebSocket.CONNECTING = WebSocket.CONNECTING;
  ProxiedWebSocket.OPEN = WebSocket.OPEN;
  ProxiedWebSocket.CLOSING = WebSocket.CLOSING;
  ProxiedWebSocket.CLOSED = WebSocket.CLOSED;
  ProxiedWebSocket.prototype = OriginalWebSocket.prototype;
  
  // Override global WebSocket
  window.WebSocket = ProxiedWebSocket;
  
  /**
   * Listen for messages from parent window (HMR events and config)
   */
  window.addEventListener('message', function(event) {
    // Only handle messages from parent
    if (event.source !== window.parent) return;
    
    const { type, connectionId, message, code, reason, error, port } = event.data || {};
    
    if (!type || !type.startsWith('hatchway:hmr:')) return;

    // Handle config message to set dev server port
    if (type === 'hatchway:hmr:config') {
      if (port && typeof port === 'number') {
        devServerPort = port;
        
        // Process any queued connections
        while (pendingConnections.length > 0) {
          const conn = pendingConnections.shift();
          conn._requestConnect();
        }
      }
      return;
    }
    
    const conn = activeConnections.get(connectionId);
    if (!conn) {
      return;
    }
    
    switch (type) {
      case 'hatchway:hmr:connected':
        conn._onConnected();
        break;

      case 'hatchway:hmr:message':
        conn._onMessage(message);
        break;

      case 'hatchway:hmr:closed':
        conn._onClosed(code || 1000, reason || '');
        break;

      case 'hatchway:hmr:error':
        conn._onError(error || 'Unknown error');
        break;
    }
  });
  
  // Announce ready to parent
  window.parent.postMessage({ type: 'hatchway:hmr:ready' }, '*');
})();
`;
