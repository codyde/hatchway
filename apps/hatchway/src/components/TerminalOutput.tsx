'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Convert from 'ansi-to-html';
import { useProjects } from '@/contexts/ProjectContext';

interface ParsedLogEntry {
  text: string;
  replaceLast: boolean;
}

const MAX_LOG_ENTRIES = 1000;
const DEBUG_TERMINAL = false; // Set to true to enable verbose terminal logging

function parseLogChunk(chunk: string): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];
  const normalized = chunk.replace(/\r\n/g, '\n');

  let current = '';
  let replaceLast = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === '\r') {
      if (current) {
        entries.push({ text: current, replaceLast });
        current = '';
      }

      replaceLast = true;
      continue;
    }

    if (char === '\n') {
      if (current) {
        entries.push({ text: current, replaceLast });
        current = '';
      }

      replaceLast = false;
      continue;
    }

    current += char;
  }

  if (current) {
    entries.push({ text: current, replaceLast });
  }

  return entries;
}

interface TerminalOutputProps {
  projectId?: string | null;
  onPortDetected?: (port: number | null) => void;
}

export default function TerminalOutput({ projectId, onPortDetected }: TerminalOutputProps) {
  const { projects } = useProjects();
  const [logs, setLogs] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [detectedPort, setDetectedPort] = useState<number | null>(null);
  const detectedPortRef = useRef<number | null>(null);
  const lastNotifiedPortRef = useRef<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingLogsRef = useRef<ParsedLogEntry[]>([]);
  const flushScheduledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const converter = useRef(new Convert({
    fg: '#d4d4d4',
    bg: '#181225',
    newline: true,
    escapeXML: true,
  }));

  // Get current project to watch dev server status
  const currentProject = projects.find(p => p.id === projectId);
  const devServerStatus = currentProject?.devServerStatus;

  // Debug: Log component mount and projectId changes
  useEffect(() => {
    if (DEBUG_TERMINAL) console.log('🖥️  TerminalOutput mounted, projectId:', projectId);
  }, []);

  useEffect(() => {
    if (DEBUG_TERMINAL) console.log('🔄 TerminalOutput projectId changed:', projectId);
    if (projectId) {
      detectedPortRef.current = null;
      lastNotifiedPortRef.current = null;
      setDetectedPort(null);
      startStreaming();
    } else {
      stopStreaming();
      setLogs([]);
    }

    return () => stopStreaming();
  }, [projectId]);

  const lastStatusRef = useRef<string | null>(null);

  // Reconnect stream across dev server lifecycle states
  useEffect(() => {
    if (DEBUG_TERMINAL) console.log('🔄 Dev server status changed:', devServerStatus);

    const prevStatus = lastStatusRef.current;

    if (!projectId) {
      if (eventSourceRef.current || prevStatus !== null) {
        stopStreaming();
        setLogs([]);
      }
      lastStatusRef.current = null;
      return;
    }

    const currentStatus = devServerStatus || null;

    if (currentStatus === 'starting') {
      if (prevStatus !== 'starting') {
        stopStreaming();
        setLogs([]);
        if (DEBUG_TERMINAL) console.log('🔌 Dev server starting, attaching terminal stream...');
        startStreaming();
      } else if (!eventSourceRef.current) {
        startStreaming();
      }
    } else if (currentStatus === 'running') {
      if (!eventSourceRef.current) {
        if (DEBUG_TERMINAL) console.log('🔌 Dev server running, ensuring terminal stream attached');
        startStreaming();
      }
    } else if (currentStatus === 'stopped' || currentStatus === 'failed' || currentStatus === null) {
      if (eventSourceRef.current || prevStatus !== currentStatus) {
        if (DEBUG_TERMINAL) console.log('🛑 Dev server stopped/failed (or unknown), closing terminal stream');
        stopStreaming();
        setLogs([]);
      }
    }

    lastStatusRef.current = currentStatus;
  }, [devServerStatus, projectId]);

  const connectionAttemptRef = useRef(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);

  const startStreaming = () => {
    if (!projectId) return;

    // Prevent duplicate connection attempts (atomic check-and-set)
    if (connectionAttemptRef.current || eventSourceRef.current) {
      if (DEBUG_TERMINAL) console.log('   ⚠️  Connection attempt already in progress or stream exists, skipping');
      return;
    }

    connectionAttemptRef.current = true;

    if (DEBUG_TERMINAL) console.log(`📡 Starting terminal stream for project: ${projectId} (attempt ${retryCountRef.current + 1})`);

    try {
      const url = `/api/projects/${projectId}/logs?stream=true`;
      const eventSource = new EventSource(url);

      eventSource.onopen = () => {
        if (DEBUG_TERMINAL) console.log('✅ Terminal stream connected');
        setIsStreaming(true);
        retryCountRef.current = 0; // Reset retry counter on successful connection
      };

      eventSource.onmessage = (event) => {
        // Ignore keepalive pings
        if (event.data === ':keepalive') return;

        if (DEBUG_TERMINAL) console.log('📨 Terminal SSE message received:', event.data.substring(0, 200));

        try {
          const data = JSON.parse(event.data);
          if (DEBUG_TERMINAL) console.log('   Parsed data type:', data.type);

          if (data.type === 'log' && data.data) {
            if (DEBUG_TERMINAL) console.log('   Log data length:', data.data.length);
            enqueueLogs(data.data);
          } else if (data.type === 'connected') {
            if (DEBUG_TERMINAL) console.log('   ✅ Connection established');
          } else if (data.type === 'exit') {
            if (DEBUG_TERMINAL) console.log('   ⚠️  Process exited');
            setLogs((prev) => [...prev, '\n--- Process exited ---\n']);
            stopStreaming();
          }
        } catch (e) {
          console.error('Failed to parse log event:', e);
        }
      };

      eventSource.onerror = () => {
        const readyState = eventSource.readyState;

        if (readyState === EventSource.CLOSED) {
          if (DEBUG_TERMINAL) console.log('ℹ️  Terminal stream closed');
          stopStreaming(false);
          scheduleRetry();
        } else if (readyState === EventSource.CONNECTING) {
          if (DEBUG_TERMINAL) console.log('🔄 Terminal stream reconnecting...');
        }
      };

      // Set ref AFTER creating EventSource to ensure atomic operation
      eventSourceRef.current = eventSource;
      connectionAttemptRef.current = false;
    } catch (error) {
      console.error('Failed to start log streaming:', error);
      connectionAttemptRef.current = false;
      scheduleRetry();
    }
  };

  const scheduleRetry = () => {
    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    // Only retry if we have a project and dev server should be running
    if (!projectId || devServerStatus === 'stopped' || devServerStatus === 'failed') {
      if (DEBUG_TERMINAL) console.log('   Skipping retry - no project or server stopped/failed');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s (max)
    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 8000);
    retryCountRef.current++;

    if (DEBUG_TERMINAL) console.log(`🔁 Scheduling retry in ${delay}ms (attempt ${retryCountRef.current})`);

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      if (!eventSourceRef.current && projectId) {
        startStreaming();
      }
    }, delay);
  };

  const stopStreaming = (resetPort: boolean = true) => {
    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    // Close EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Reset connection state
    connectionAttemptRef.current = false;

    // Clear animation frames
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    flushScheduledRef.current = false;
    pendingLogsRef.current = [];

    if (resetPort) {
      detectedPortRef.current = null;
      lastNotifiedPortRef.current = null;
      setDetectedPort(null);
    }

    setIsStreaming(false);
  };

  const fetchLogsAsFallback = async () => {
    if (!projectId) return;

    if (DEBUG_TERMINAL) console.log('🔄 Using fallback: fetching logs via JSON API');
    try {
      const res = await fetch(`/api/projects/${projectId}/logs`);
      const data = await res.json();

      if (data.running && data.logs) {
        setLogs(data.logs);
      }
    } catch (error) {
      console.error('Fallback fetch failed:', error);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const enqueueLogs = (chunk: string) => {
    if (DEBUG_TERMINAL) console.log('📝 enqueueLogs called with chunk length:', chunk.length);
    const entries = parseLogChunk(chunk);
    if (DEBUG_TERMINAL) console.log('   Parsed entries:', entries.length);
    if (!entries.length) return;

    // Store for batched flush
    pendingLogsRef.current.push(...entries);
    if (DEBUG_TERMINAL) console.log('   Pending logs now:', pendingLogsRef.current.length);

    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      rafIdRef.current = requestAnimationFrame(() => {
        flushScheduledRef.current = false;
        rafIdRef.current = null;

        if (pendingLogsRef.current.length === 0) {
          return;
        }

        setLogs((prev) => {
          if (pendingLogsRef.current.length === 0) {
            if (DEBUG_TERMINAL) console.log('   ⚠️  No pending logs to flush');
            return prev;
          }

          if (DEBUG_TERMINAL) console.log(`   Flushing ${pendingLogsRef.current.length} pending logs (prev array has ${prev.length} items)`);

          let next = [...prev];
          let changed = false;

          for (const entry of pendingLogsRef.current) {
            const text = entry.text;
            if (!text) continue;

            if (entry.replaceLast) {
              if (next.length === 0) {
                next = [text];
                changed = true;
              } else if (next[next.length - 1] !== text) {
                next[next.length - 1] = text;
                changed = true;
              }
            } else {
              next.push(text);
              changed = true;
            }

            if (detectedPortRef.current == null) {
              detectPort(text);
            }
          }

          pendingLogsRef.current = [];

          if (!changed) {
            if (DEBUG_TERMINAL) console.log('   ⚠️  No changes detected, returning prev');
            return prev;
          }

          if (next.length > MAX_LOG_ENTRIES) {
            next = next.slice(next.length - MAX_LOG_ENTRIES);
          }

          if (DEBUG_TERMINAL) console.log(`   ✅ Updated logs array: ${prev.length} → ${next.length} items`);
          return next;
        });
      });
    }
  };

  const detectPort = (logText: string) => {
    if (detectedPortRef.current != null) return;

    // Skip lines mentioning ports that are "in use" or "busy"
    if (logText.match(/in use|busy|unavailable|already/i)) {
      if (DEBUG_TERMINAL) console.log('⏭️  Skipping "in use" port message:', logText.trim());
      return;
    }

    const portMatch =
      logText.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/i) ||        // URL with port
      logText.match(/Local:.*?:(\d{4,5})/i) ||                                    // Vite/Next: "Local: http://localhost:5173/"
      logText.match(/port[:\s]+(\d{4,5})/i) ||                                    // Generic "Port 3000"
      logText.match(/ready.*?(\d{4,5})/i) ||                                      // "ready - started server on 3000"
      logText.match(/ready.*?:(\d{4,5})/i) ||                                     // "ready on http://localhost:3000"
      logText.match(/http:\/\/.*?:(\d{4,5})/i) ||                                 // Any HTTP URL
      logText.match(/https:\/\/.*?:(\d{4,5})/i) ||                                // Any HTTPS URL
      logText.match(/Network:.*?:(\d{4,5})/i) ||                                  // Vite Network URL
      logText.match(/started server on.*?:(\d{4,5})/i) ||                         // Next.js format
      logText.match(/listening on.*?:(\d{4,5})/i);                                // Generic "listening on"

    if (portMatch) {
      const port = parseInt(portMatch[1], 10);
      if (port >= 3000 && port <= 65535) {
        if (detectedPortRef.current !== port) {
          if (DEBUG_TERMINAL) console.log(`🔍 Port detected from terminal: ${port}`);
          detectedPortRef.current = port;
          setDetectedPort(port);
        }
      }
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (detectedPort == null) return;
    if (lastNotifiedPortRef.current === detectedPort) return;
    lastNotifiedPortRef.current = detectedPort;
    if (onPortDetected) {
      onPortDetected(detectedPort);
    }
  }, [detectedPort, onPortDetected]);

  useEffect(() => {
    if (detectedPort !== null) return;
    if (lastNotifiedPortRef.current === null) return;
    lastNotifiedPortRef.current = null;
    if (onPortDetected) {
      onPortDetected(null);
    }
  }, [detectedPort, onPortDetected]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-2 flex items-center justify-between bg-black/20">
        <div className="flex items-center gap-2">
          {isStreaming && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 animate-pulse">
              Live
            </span>
          )}
        </div>
        <button
          onClick={clearLogs}
          disabled={logs.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Clear logs"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 overflow-y-auto p-4 terminal-theme font-mono text-sm">
        {logs.length === 0 ? (
          <div className="text-gray-500 flex items-center justify-center h-full">
            {projectId ? 'No output yet. Start the dev server to see logs.' : 'Select a project to view terminal output'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {logs.map((log, i) => (
              <div
                key={i}
                className="text-gray-300 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{
                  __html: converter.current.toHtml(log),
                }}
              />
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
