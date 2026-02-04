'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Project } from '@/contexts/ProjectContext';

export type ProjectUpdateEvent = {
  type: 'project:updated';
  project: Partial<Project> & { id: string };
};

export type ProjectCreatedEvent = {
  type: 'project:created';
  project: Project;
};

export type ProjectDeletedEvent = {
  type: 'project:deleted';
  projectId: string;
};

export type ProjectStatusEvent = {
  type: 'project:status_changed';
  projectId: string;
  status?: Project['status'];
  devServerStatus?: Project['devServerStatus'];
  devServerPort?: number | null;
  tunnelUrl?: string | null;
};

export type ProjectEvent =
  | ProjectUpdateEvent
  | ProjectCreatedEvent
  | ProjectDeletedEvent
  | ProjectStatusEvent;

interface UseProjectWebSocketOptions {
  onProjectUpdate?: (event: ProjectUpdateEvent) => void;
  onProjectCreated?: (event: ProjectCreatedEvent) => void;
  onProjectDeleted?: (event: ProjectDeletedEvent) => void;
  onProjectStatusChange?: (event: ProjectStatusEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useProjectWebSocket(options: UseProjectWebSocketOptions = {}) {
  const {
    onProjectUpdate,
    onProjectCreated,
    onProjectDeleted,
    onProjectStatusChange,
    onConnect,
    onDisconnect,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;

  const connect = useCallback(() => {
    // Skip if already connected or reconnecting
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      // Connect to broker's client WebSocket endpoint
      const brokerPort = process.env.NEXT_PUBLIC_BROKER_PORT || '4000';
      const brokerHost = process.env.NEXT_PUBLIC_BROKER_HOST || 'localhost';
      const wsUrl = `ws://${brokerHost}:${brokerPort}/client-socket`;

      console.log(`[WebSocket] Connecting to ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected to project updates');
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ProjectEvent;

          switch (data.type) {
            case 'project:updated':
              onProjectUpdate?.(data);
              break;
            case 'project:created':
              onProjectCreated?.(data);
              break;
            case 'project:deleted':
              onProjectDeleted?.(data);
              break;
            case 'project:status_changed':
              onProjectStatusChange?.(data);
              break;
            default:
              console.warn('[WebSocket] Unknown event type:', data);
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        onDisconnect?.();
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current);
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else {
          console.log('[WebSocket] Max reconnect attempts reached, giving up');
        }
      };
    } catch (error) {
      console.error('[WebSocket] Failed to connect:', error);
    }
  }, [onConnect, onDisconnect, onProjectUpdate, onProjectCreated, onProjectDeleted, onProjectStatusChange]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    reconnect: connect,
    disconnect,
  };
}
