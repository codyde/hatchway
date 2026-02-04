/**
 * React Hook for Build WebSocket Connection
 * 
 * Provides real-time build state updates via WebSocket with:
 * - Automatic reconnection with exponential backoff
 * - State hydration from database on mount
 * - Batched update processing
 * - Connection status tracking
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GenerationState } from '@/types/generation';

interface WebSocketMessage {
  type: string;
  projectId?: string;
  sessionId?: string;
  state?: Partial<GenerationState>;
  updates?: Array<{
    type: string;
    data: unknown;
    timestamp: number;
    _sentry?: { trace?: string; baggage?: string }; // Optional trace context for distributed tracing
  }>;
  timestamp?: number;
  clientId?: string;
  error?: string; // For error messages like state-recovery-failed
  sessionStatus?: string; // Status from state recovery
}

interface UseBuildWebSocketOptions {
  projectId: string;
  sessionId?: string;
  enabled?: boolean;
}

interface AutoFixState {
  projectId: string;
  errorMessage: string;
  isStarting: boolean;
  startedAt: Date;
}

interface UseBuildWebSocketReturn {
  state: GenerationState | null;
  autoFixState: AutoFixState | null;
  isConnected: boolean;
  isReconnecting: boolean;
  error: Error | null;
  reconnect: () => void;
  clearAutoFixState: () => void;
  clearState: () => void; // Clear the build state (used when starting a new build to prevent stale data)
  cancelBuild: () => Promise<boolean>; // Cancel the current build
  isCancelling: boolean; // Whether a cancel is in progress
  sentryTrace: { trace?: string; baggage?: string } | null; // Current trace context from last WebSocket message
  runnerActive: boolean; // True if we've received runner events recently (within last 30s)
}

const DEBUG = false; // Set to true for verbose logging

export function useBuildWebSocket({
  projectId,
  sessionId,
  enabled = true,
}: UseBuildWebSocketOptions): UseBuildWebSocketReturn {
  const [state, setState] = useState<GenerationState | null>(null);
  const [autoFixState, setAutoFixState] = useState<AutoFixState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [sentryTrace, setSentryTrace] = useState<{ trace?: string; baggage?: string } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [lastRunnerEventTime, setLastRunnerEventTime] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000; // 1 second
  const MAX_RECONNECT_DELAY = 30000; // 30 seconds

  /**
   * Clear the auto-fix state (called when auto-fix session takes over)
   */
  const clearAutoFixState = useCallback(() => {
    setAutoFixState(null);
  }, []);

  /**
   * Clear the build state (called when starting a new build to prevent stale data)
   */
  const clearState = useCallback(() => {
    if (DEBUG) console.log('[useBuildWebSocket] Clearing state for new build');
    setState(null);
  }, []);

  /**
   * Cancel the current build
   */
  const cancelBuild = useCallback(async (): Promise<boolean> => {
    if (!projectId || !state?.isActive) {
      if (DEBUG) console.log('[useBuildWebSocket] No active build to cancel');
      return false;
    }

    setIsCancelling(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/cancel-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User cancelled' }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[useBuildWebSocket] Cancel failed:', error);
        return false;
      }

      if (DEBUG) console.log('[useBuildWebSocket] Build cancelled successfully');
      
      // Clear the active state
      setState(prev => prev ? { ...prev, isActive: false } : null);
      return true;
    } catch (err) {
      console.error('[useBuildWebSocket] Failed to cancel build:', err);
      return false;
    } finally {
      setIsCancelling(false);
    }
  }, [projectId, state?.isActive]);
  
  /**
   * Calculate reconnect delay with exponential backoff
   */
  const getReconnectDelay = useCallback(() => {
    const exponentialDelay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current),
      MAX_RECONNECT_DELAY
    );
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }, []);

  /**
   * Convert date fields from strings to Date objects
   */
  const normalizeDates = useCallback((obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    
    const normalized = { ...obj };
    
    // Convert common date fields
    const dateFields = ['startTime', 'endTime', 'timestamp', 'createdAt', 'updatedAt'];
    for (const field of dateFields) {
      if (normalized[field] && typeof normalized[field] === 'string') {
        normalized[field] = new Date(normalized[field]);
      }
    }
    
    // Recursively handle nested objects
    if (normalized.toolsByTodo) {
      for (const todoIndex in normalized.toolsByTodo) {
        normalized.toolsByTodo[todoIndex] = normalized.toolsByTodo[todoIndex].map((tool: any) => ({
          ...tool,
          startTime: tool.startTime ? new Date(tool.startTime) : tool.startTime,
          endTime: tool.endTime ? new Date(tool.endTime) : tool.endTime,
        }));
      }
    }
    
    if (normalized.textByTodo) {
      for (const todoIndex in normalized.textByTodo) {
        normalized.textByTodo[todoIndex] = normalized.textByTodo[todoIndex].map((text: any) => ({
          ...text,
          timestamp: text.timestamp ? new Date(text.timestamp) : text.timestamp,
        }));
      }
    }
    
    return normalized;
  }, []);

  /**
   * Hydrate state from database on mount
   */
  const hydrateState = useCallback(async () => {
    if (!projectId) return;
    
    try {
      if (DEBUG) console.log('[useBuildWebSocket] Hydrating state from database...');
      const response = await fetch(`/api/projects/${projectId}/messages`);
      
      if (!response.ok) {
        throw new Error(`Failed to hydrate state: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Extract latest generation state from sessions
      if (data.sessions && data.sessions.length > 0) {
        const latestSession = data.sessions[0];
        if (latestSession.hydratedState) {
          // Normalize dates in the hydrated state
          const normalizedState = normalizeDates(latestSession.hydratedState) as GenerationState;
          
          console.log('[useBuildWebSocket] Hydration check:', {
            buildId: normalizedState.id,
            isActive: normalizedState.isActive,
            todosCount: normalizedState.todos?.length ?? 0,
            hasSummary: !!normalizedState.buildSummary,
          });
          
          // GUARD: Don't restore completed builds as active state
          // This can happen if the session was completed but not properly marked in DB
          // Only set state if the build is actually active
          if (normalizedState.isActive) {
            console.log('[useBuildWebSocket] ✅ Hydrating active build');
            setState(normalizedState);
          } else {
            console.log('[useBuildWebSocket] ⏭️ Skipping hydration of completed build');
            // Don't set state - completed builds belong in serverBuilds/buildHistory
          }
        }
      }
    } catch (err) {
      console.error('[useBuildWebSocket] Failed to hydrate state:', err);
      setError(err as Error);
    }
  }, [projectId, normalizeDates]);

  /**
   * Process batch update from WebSocket
   */
  const processBatchUpdate = useCallback((message: WebSocketMessage) => {
    const updates = message.updates;
    if (!updates || !Array.isArray(updates) || updates.length === 0) return;
    
    // Track that we received events from the runner
    // This is used to determine if the runner is actively connected
    setLastRunnerEventTime(Date.now());
    
    // Extract trace context from the most recent update that has it
    // This allows linking frontend operations back to backend AI operations
    const latestTraceContext = updates
      .reverse()
      .find(u => u._sentry)?._sentry || null;
    if (latestTraceContext) {
      setSentryTrace(latestTraceContext);
    }
    
    setState((prevState) => {
      // BUG FIX: If prevState is null (before hydration), queue the updates for later
      // instead of dropping them. We'll create a minimal state to hold the updates.
      if (!prevState) {
        if (DEBUG) console.log('[useBuildWebSocket] Received updates before hydration, creating temporary state');
        
        // Create minimal state to hold these updates
        // This will be merged with hydrated state when it arrives
        prevState = {
          id: `temp-${Date.now()}`,
          projectId: message.projectId || '',
          projectName: '',
          operationType: 'continuation',
          todos: [],
          toolsByTodo: {},
          textByTodo: {},
          activeTodoIndex: -1,
          isActive: true,
          startTime: new Date(),
          planningTools: [],
        };
      }
      
      let newState = { ...prevState };
      
      for (const update of updates) {
        switch (update.type) {
          case 'build-started':
            // Build has started - mark as active and update build ID
            const buildStartData = update.data as { buildId?: string; sessionId?: string; projectId?: string };
            if (DEBUG) console.log('[useBuildWebSocket] 🚀 Build started - setting isActive=true, buildId:', buildStartData.buildId);
            newState.isActive = true;
            // CRITICAL: Update the build ID from the server
            // This ensures the frontend state matches the server's build ID
            if (buildStartData.buildId) {
              newState.id = buildStartData.buildId;
            }
            if (buildStartData.projectId) {
              newState.projectId = buildStartData.projectId;
            }
            // If this is an auto-fix build starting, clear the pending autofix state
            if (newState.isAutoFix) {
              setAutoFixState(null);
            }
            break;

          case 'autofix-started':
            // Auto-fix has been triggered - show immediate feedback
            const autofixData = update.data as { projectId: string; errorMessage: string };
            console.log('[useBuildWebSocket] 🔧 Auto-fix started:', autofixData.errorMessage?.slice(0, 100));
            setAutoFixState({
              projectId: autofixData.projectId,
              errorMessage: autofixData.errorMessage,
              isStarting: true,
              startedAt: new Date(),
            });
            break;

          case 'todos-update':
            // New todo list from TodoWrite tool
            const todosData = update.data as {
              todos: Array<{ content: string; status: string; activeForm?: string }>;
              activeTodoIndex: number;
              phase?: 'template' | 'build';
            };
            
            const mappedTodos = todosData.todos.map(t => ({
              content: t.content,
              status: t.status as 'pending' | 'in_progress' | 'completed',
              activeForm: t.activeForm || t.content,
            }));

            // Route todos to the correct array based on phase
            // Type assertion for extended state fields (templateTodos, activeTemplateTodoIndex, currentPhase)
            const extendedState = newState as typeof newState & {
              templateTodos?: typeof mappedTodos;
              activeTemplateTodoIndex?: number;
              currentPhase?: 'template' | 'build';
            };
            
            if (todosData.phase === 'template') {
              // Template phase todos - store separately, don't touch build todos
              if (DEBUG) console.log(`[useBuildWebSocket] 📦 Template todos update: ${todosData.todos.length} todos, active: ${todosData.activeTodoIndex}`);
              extendedState.templateTodos = mappedTodos;
              extendedState.activeTemplateTodoIndex = todosData.activeTodoIndex;
              extendedState.currentPhase = 'template';
            } else {
              // Build phase todos (from agent) - these go to the main todos array
              if (DEBUG) console.log(`[useBuildWebSocket] 🔨 Build todos update: ${todosData.todos.length} todos, active: ${todosData.activeTodoIndex}`);
              newState.todos = mappedTodos;
              newState.activeTodoIndex = todosData.activeTodoIndex;
              extendedState.currentPhase = 'build';

              // Clear activePlanningTool when build todos arrive (planning phase is over)
              if (todosData.todos.length > 0 && newState.activePlanningTool) {
                if (DEBUG) console.log('[useBuildWebSocket] 🏁 Clearing activePlanningTool - planning phase complete');
                newState.activePlanningTool = undefined;
              }
            }
            break;

          case 'build-complete':
            // Build has completed or failed
            const completeData = update.data as { status: 'completed' | 'failed'; summary?: string };
            console.log(`[useBuildWebSocket] 🏁 Build complete received:`, {
              status: completeData.status,
              hasSummary: !!completeData.summary,
              summaryLength: completeData.summary?.length,
              summaryPreview: completeData.summary?.slice(0, 100),
            });
            newState.isActive = false;
            newState.endTime = new Date();
            if (completeData.summary) {
              newState.buildSummary = completeData.summary;
              console.log(`[useBuildWebSocket] 📝 Set buildSummary on state`);
            }
            break;

          case 'build-summary':
            const summaryData = update.data as { summary?: string };
            if (summaryData.summary) {
              newState.buildSummary = summaryData.summary;
            }
            break;

          case 'state-update':
            // Legacy: Merge state update and normalize dates
            const normalizedUpdate = normalizeDates(update.data);
            newState = {
              ...newState,
              ...normalizedUpdate as Partial<GenerationState>,
            };
            break;

          case 'todo-update':
            // Legacy: Update todos
            const todoData = update.data as { todos?: unknown[] };
            if (todoData.todos) {
              newState.todos = todoData.todos as GenerationState['todos'];
            }
            break;

          case 'tool-call':
            // Handle tool calls - both planning phase (todoIndex < 0) and execution phase
            const toolData = update.data as {
              id: string;
              name: string;
              todoIndex: number;
              state: 'input-streaming' | 'input-available' | 'output-available' | 'error';
              input?: unknown;
              output?: unknown;
            };

            if (DEBUG) console.log(`[useBuildWebSocket] 🔧 tool-call: ${toolData.name} (todoIndex=${toolData.todoIndex}, state=${toolData.state})`);

            // Validate todoIndex
            if (typeof toolData.todoIndex !== 'number') {
              if (DEBUG) console.warn(`[useBuildWebSocket] ⚠️ Invalid todoIndex for tool ${toolData.name}:`, toolData.todoIndex);
              break;
            }

            const toolCall = {
              id: toolData.id,
              name: toolData.name,
              input: toolData.input,
              output: toolData.output,
              state: toolData.state,
              startTime: new Date(),
            };

            // Handle planning phase tools (todoIndex < 0 = before first TodoWrite)
            if (toolData.todoIndex < 0) {
              if (DEBUG) console.log(`[useBuildWebSocket] 🎯 Planning phase tool: ${toolData.name} (state=${toolData.state})`);

              // Initialize planningTools array if needed
              if (!newState.planningTools) {
                newState.planningTools = [];
              }

              // Check if tool already exists (prevent duplicates)
              const existingPlanningIndex = newState.planningTools.findIndex(t => t.id === toolData.id);

              if (existingPlanningIndex >= 0) {
                // Update existing tool (e.g., streaming -> completed)
                newState.planningTools = newState.planningTools.map(t =>
                  t.id === toolData.id ? { ...t, ...toolCall, endTime: toolData.state === 'output-available' || toolData.state === 'error' ? new Date() : undefined } : t
                );
              } else {
                // Add new planning tool
                newState.planningTools = [...newState.planningTools, toolCall];
              }

              // Capture build plan from ExitPlanMode tool
              if (toolData.name === 'ExitPlanMode' && toolData.input) {
                const input = toolData.input as { plan?: string };
                if (input.plan) {
                  newState.buildPlan = input.plan;
                }
              }

              // Track active planning tool for shimmer animation
              // KEY FIX: Always set the active tool when we see a new tool (input-available)
              // Don't clear it on output-available - let the NEXT tool replace it
              // This ensures the UI always shows the current/latest tool being used
              if (toolData.state === 'input-streaming' || toolData.state === 'input-available') {
                if (DEBUG) console.log(`[useBuildWebSocket] ✨ Setting activePlanningTool: ${toolData.name}`);
                newState.activePlanningTool = toolCall;
              }
              // Note: We don't clear activePlanningTool on output-available anymore
              // The next input-available will replace it, keeping the UI responsive
              break;
            }

            // Handle execution phase tools (todoIndex >= 0)
            const targetTodoIndex = toolData.todoIndex;
            const existingTools = newState.toolsByTodo[targetTodoIndex] || [];

            // Check if tool already exists (prevent duplicates)
            const existingIndex = existingTools.findIndex(t => t.id === toolData.id);
            if (existingIndex >= 0) {
              break;
            }

            // Only add completed tools to toolsByTodo (for display in todo list)
            if (toolData.state === 'output-available' || toolData.state === 'error') {
              newState.toolsByTodo = {
                ...newState.toolsByTodo,
                [targetTodoIndex]: [
                  ...existingTools,
                  toolCall,
                ],
              };
            }
            break;
        }
      }
      
      return newState;
    });
    
    if (DEBUG) console.log(`[useBuildWebSocket] Processed ${updates.length} updates`);
  }, [normalizeDates]);

  /**
   * Handle WebSocket message
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      if (DEBUG) console.log('[useBuildWebSocket] Message received:', message.type);
      
      switch (message.type) {
        case 'connected':
          setIsConnected(true);
          setIsReconnecting(false);
          reconnectAttemptsRef.current = 0;
          if (DEBUG) console.log('[useBuildWebSocket] Connected:', message.clientId);
          break;
        
        case 'batch-update':
          processBatchUpdate(message);
          break;
        
        case 'state-update':
          // Single state update (less common, used for full state sync)
          if (message.state) {
            setState((prevState) => ({
              ...prevState!,
              ...message.state,
            }));
          }
          break;
        
        case 'heartbeat':
          // Send heartbeat ack
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ 
              type: 'heartbeat', 
              timestamp: Date.now() 
            }));
          }
          break;
        
        case 'heartbeat-ack':
          // Heartbeat acknowledged
          break;
        
        case 'state-recovery':
          // Server sent recovered state on reconnect
          console.log('[useBuildWebSocket] State recovery received:', {
            hasState: !!message.state,
            sessionStatus: message.sessionStatus,
            isActiveInState: message.state?.isActive,
          });
          if (message.state) {
            const recoveredState = normalizeDates(message.state) as GenerationState;
            
            // CRITICAL FIX: Override isActive based on session status from server
            // The rawState stored in DB may have stale isActive=true from when the build was running
            // The session.status column is the source of truth for whether a build is active
            if (message.sessionStatus && message.sessionStatus !== 'active') {
              console.log('[useBuildWebSocket] ⚠️ Overriding isActive from', recoveredState.isActive, 'to false (session status:', message.sessionStatus + ')');
              recoveredState.isActive = false;
            }
            
            // Only restore state if the build is actually active
            // Completed builds should be loaded from serverBuilds/buildHistory, not WebSocket state
            if (recoveredState.isActive) {
              console.log('[useBuildWebSocket] ✅ Restoring active build state');
              setState(recoveredState);
            } else {
              console.log('[useBuildWebSocket] ⏭️ Skipping completed build (belongs in serverBuilds)');
              // Don't set state - completed builds are shown from DB via serverBuilds
            }
          }
          break;
        
        case 'state-recovery-failed':
          // State recovery failed - log but don't error out
          console.warn('[useBuildWebSocket] State recovery failed:', message.error);
          break;
        
        default:
          if (DEBUG) console.log('[useBuildWebSocket] Unknown message type:', message.type);
      }
    } catch (err) {
      console.error('[useBuildWebSocket] Failed to process message:', err);
    }
  }, [processBatchUpdate]);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    if (!enabled || !projectId) {
      if (DEBUG) console.log('[useBuildWebSocket] Connection disabled or no projectId');
      return;
    }
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (DEBUG) console.log('[useBuildWebSocket] Already connected');
      return;
    }
    
    try {
      // Determine WebSocket URL (ws:// for http://, wss:// for https://)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      let url = `${protocol}//${host}/ws?projectId=${projectId}`;
      
      if (sessionId) {
        url += `&sessionId=${sessionId}`;
      }
      
      if (DEBUG) console.log('[useBuildWebSocket] Connecting to:', url);
      
      const ws = new WebSocket(url);
      wsRef.current = ws;
      
      ws.onopen = () => {
        if (DEBUG) console.log('[useBuildWebSocket] WebSocket opened');
        setIsConnected(true);
        setIsReconnecting(false);
        setError(null);
        reconnectAttemptsRef.current = 0;
        
        // Request state recovery on connect/reconnect
        // This ensures we get the latest state from DB after any disconnection
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'get-state' }));
            if (DEBUG) console.log('[useBuildWebSocket] Requested state recovery');
          }
        }, 100);
      };
      
      ws.onmessage = handleMessage;
      
      ws.onclose = () => {
        if (!isMountedRef.current) return;
        
        if (DEBUG) console.log('[useBuildWebSocket] WebSocket closed');
        setIsConnected(false);
        
        // Attempt to reconnect if still enabled
        if (enabled && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          setIsReconnecting(true);
          const delay = getReconnectDelay();
          
          if (DEBUG) console.log(`[useBuildWebSocket] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else {
          setIsReconnecting(false);
          if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
            setError(new Error('Max reconnection attempts reached'));
          }
        }
      };
      
      ws.onerror = (event) => {
        console.error('[useBuildWebSocket] WebSocket error:', event);
        setError(new Error('WebSocket connection error'));
      };
      
    } catch (err) {
      console.error('[useBuildWebSocket] Failed to create WebSocket:', err);
      setError(err as Error);
    }
  }, [enabled, projectId, sessionId, handleMessage, getReconnectDelay]);

  /**
   * Manual reconnect function
   */
  const reconnect = useCallback(() => {
    if (DEBUG) console.log('[useBuildWebSocket] Manual reconnect triggered');
    
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Reset reconnect attempts
    reconnectAttemptsRef.current = 0;
    setError(null);
    
    // Connect
    connect();
  }, [connect]);

  /**
   * Initialize connection on mount or when projectId changes
   */
  useEffect(() => {
    isMountedRef.current = true;
    
    // CRITICAL: Clear state when projectId changes to prevent stale data
    // This ensures we don't show old build data when switching projects
    setState(null);
    setAutoFixState(null);
    
    // Hydrate state from database first
    hydrateState();
    
    // Then connect to WebSocket for real-time updates
    connect();
    
    return () => {
      isMountedRef.current = false;
      
      // Cleanup WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Clear heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [projectId, sessionId, enabled, connect, hydrateState]);

  // Runner is considered active if we received events within the last 30 seconds
  const RUNNER_ACTIVE_THRESHOLD_MS = 30000;
  const runnerActive = lastRunnerEventTime !== null && 
    (Date.now() - lastRunnerEventTime) < RUNNER_ACTIVE_THRESHOLD_MS;

  return {
    state,
    autoFixState,
    isConnected,
    isReconnecting,
    error,
    reconnect,
    clearAutoFixState,
    clearState,
    cancelBuild,
    isCancelling,
    sentryTrace,
    runnerActive,
  };
}

