/**
 * React Hook for HMR WebSocket Proxy
 * 
 * Manages HMR (Hot Module Replacement) communication between the preview iframe
 * and the remote dev server via WebSocket tunneling.
 * 
 * Flow:
 * 1. Iframe posts 'hatchway:hmr:connect' message
 * 2. This hook sends 'hmr-connect' via WebSocket to server
 * 3. Server forwards to runner which connects to actual Vite HMR
 * 4. HMR messages flow back through the same path
 */

import { useEffect, useRef, useCallback } from 'react';

interface UseHmrProxyOptions {
  projectId: string;
  runnerId?: string;
  devServerPort?: number;
  enabled?: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement>;
}

interface HmrConnection {
  connectionId: string;
  port: number;
  protocol?: string;
}

const DEBUG = false;

export function useHmrProxy({
  projectId,
  runnerId,
  devServerPort = 5173,
  enabled = true,
  iframeRef,
}: UseHmrProxyOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const activeConnectionsRef = useRef<Map<string, HmrConnection>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const iframeReadyRef = useRef(false);

  /**
   * Send message to iframe
   */
  const sendToIframe = useCallback((type: string, data: any) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) {
      if (DEBUG) console.warn('[useHmrProxy] Cannot send to iframe - no contentWindow');
      return;
    }
    
    iframe.contentWindow.postMessage({ type, ...data }, '*');
  }, [iframeRef]);

  /**
   * Send HMR message via WebSocket
   */
  const sendWsMessage = useCallback((message: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (DEBUG) console.warn('[useHmrProxy] WebSocket not ready');
      return false;
    }
    
    wsRef.current.send(JSON.stringify(message));
    return true;
  }, []);

  /**
   * Handle HMR connect request from iframe
   */
  const handleHmrConnect = useCallback((data: any) => {
    const { connectionId, port, protocol } = data;
    
    if (DEBUG) console.log('[useHmrProxy] HMR connect request:', connectionId, port);
    
    // Store connection info
    activeConnectionsRef.current.set(connectionId, { connectionId, port, protocol });
    
    // Send connect request via WebSocket
    sendWsMessage({
      type: 'hmr-connect',
      connectionId,
      port,
      protocol,
      runnerId,
      projectId,
    });
  }, [projectId, runnerId, sendWsMessage]);

  /**
   * Handle HMR send request from iframe
   */
  const handleHmrSend = useCallback((data: any) => {
    const { connectionId, message } = data;
    
    sendWsMessage({
      type: 'hmr-send',
      connectionId,
      message,
    });
  }, [sendWsMessage]);

  /**
   * Handle HMR disconnect request from iframe
   */
  const handleHmrDisconnect = useCallback((data: any) => {
    const { connectionId } = data;
    
    if (DEBUG) console.log('[useHmrProxy] HMR disconnect:', connectionId);
    
    activeConnectionsRef.current.delete(connectionId);
    
    sendWsMessage({
      type: 'hmr-disconnect',
      connectionId,
    });
  }, [sendWsMessage]);

  /**
   * Handle messages from iframe
   */
  const handleIframeMessage = useCallback((event: MessageEvent) => {
    // Verify message is from our iframe
    if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
      return;
    }
    
    const { type } = event.data || {};
    if (!type?.startsWith('hatchway:hmr:')) return;
    
    switch (type) {
      case 'hatchway:hmr:connect':
        handleHmrConnect(event.data);
        break;
      case 'hatchway:hmr:send':
        handleHmrSend(event.data);
        break;
      case 'hatchway:hmr:disconnect':
        handleHmrDisconnect(event.data);
        break;
      case 'hatchway:hmr:ready':
        if (DEBUG) console.log('[useHmrProxy] Iframe HMR script ready, sending port config:', devServerPort);
        iframeReadyRef.current = true;
        // Send the dev server port to the iframe
        sendToIframe('hatchway:hmr:config', { port: devServerPort });
        break;
    }
  }, [iframeRef, handleHmrConnect, handleHmrSend, handleHmrDisconnect]);

  /**
   * Handle WebSocket messages (HMR events from server)
   */
  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'hmr-connected':
          if (DEBUG) console.log('[useHmrProxy] HMR connected:', message.connectionId);
          sendToIframe('hatchway:hmr:connected', { connectionId: message.connectionId });
          break;
          
        case 'hmr-message':
          sendToIframe('hatchway:hmr:message', { 
            connectionId: message.connectionId, 
            message: message.message 
          });
          break;
          
        case 'hmr-closed':
          if (DEBUG) console.log('[useHmrProxy] HMR closed:', message.connectionId);
          activeConnectionsRef.current.delete(message.connectionId);
          sendToIframe('hatchway:hmr:closed', {
            connectionId: message.connectionId,
            code: message.code,
            reason: message.reason,
          });
          break;
          
        case 'hmr-error':
          console.error('[useHmrProxy] HMR error:', message.connectionId, message.error);
          activeConnectionsRef.current.delete(message.connectionId);
          sendToIframe('hatchway:hmr:error', {
            connectionId: message.connectionId,
            error: message.error,
          });
          break;
      }
    } catch (err) {
      // Not JSON or not relevant message - ignore
    }
  }, [sendToIframe]);

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (!enabled || !projectId) return;
    
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?projectId=${projectId}`;
    
    if (DEBUG) console.log('[useHmrProxy] Connecting to:', url);
    
    const ws = new WebSocket(url);
    wsRef.current = ws;
    
    ws.onopen = () => {
      if (DEBUG) console.log('[useHmrProxy] WebSocket connected');
    };
    
    ws.onmessage = handleWsMessage;
    
    ws.onclose = () => {
      if (DEBUG) console.log('[useHmrProxy] WebSocket closed');
      
      // Clear all active connections
      for (const connectionId of activeConnectionsRef.current.keys()) {
        sendToIframe('hatchway:hmr:closed', {
          connectionId,
          code: 1006,
          reason: 'WebSocket connection lost',
        });
      }
      activeConnectionsRef.current.clear();
      
      // Try to reconnect after delay
      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };
    
    ws.onerror = (error) => {
      console.error('[useHmrProxy] WebSocket error:', error);
    };
  }, [enabled, projectId, handleWsMessage, sendToIframe]);

  /**
   * Initialize WebSocket and message listeners
   */
  useEffect(() => {
    if (!enabled) return;
    
    // Listen for iframe messages
    window.addEventListener('message', handleIframeMessage);
    
    // Connect WebSocket
    connect();
    
    return () => {
      window.removeEventListener('message', handleIframeMessage);
      iframeReadyRef.current = false;
      
      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Notify iframe of all closed connections
      for (const connectionId of activeConnectionsRef.current.keys()) {
        sendToIframe('hatchway:hmr:closed', {
          connectionId,
          code: 1000,
          reason: 'Component unmounted',
        });
      }
      activeConnectionsRef.current.clear();
    };
  }, [enabled, connect, handleIframeMessage, sendToIframe]);

  /**
   * Send port config to iframe when port changes
   */
  useEffect(() => {
    if (enabled && iframeReadyRef.current && devServerPort) {
      if (DEBUG) console.log('[useHmrProxy] Port changed, sending config:', devServerPort);
      sendToIframe('hatchway:hmr:config', { port: devServerPort });
    }
  }, [enabled, devServerPort, sendToIframe]);

  return {
    activeConnections: activeConnectionsRef.current.size,
  };
}
