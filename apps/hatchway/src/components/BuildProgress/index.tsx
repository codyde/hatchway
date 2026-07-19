'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, ChevronDown, ChevronUp, Square, AlertTriangle } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { GenerationState, TodoItem, ActivityItem } from '@/types/generation';
import { BuildHeader } from './BuildHeader';
import { TodoList } from './TodoList';
import { PlanningPhase } from './PlanningPhase';
import { PhaseSection } from './PhaseSection';
import { ActivityFeed } from './ActivityFeed';

interface BuildProgressProps {
  state: GenerationState;
  defaultCollapsed?: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  isCancelling?: boolean;

  templateInfo?: {
    name: string;
    framework: string;
    analyzedBy?: string;
  } | null;
}

/** Reconstruct a chronological chat feed when live activityFeed is empty (reconnect / history).
 * Chat is narrative-only: Claude text + high-level status. Tools never appear here.
 */
function deriveActivityFeed(state: GenerationState): ActivityItem[] {
  if (state.activityFeed && state.activityFeed.length > 0) {
    return state.activityFeed.filter((item) => item.kind === 'text' || item.kind === 'status');
  }

  const items: ActivityItem[] = [];

  // Narrative text keyed by todo index (including 0 before todos exist)
  const textEntries = Object.entries(state.textByTodo || {})
    .flatMap(([idx, texts]) =>
      (texts || []).map((text) => ({ index: Number(idx), text }))
    )
    .filter((entry) => entry.text?.text?.trim());

  for (const { index, text } of textEntries) {
    items.push({
      id: `text-derived-${text.id}`,
      kind: 'text',
      timestamp: text.timestamp || state.startTime,
      label: text.text,
      status: 'info',
      todoIndex: Number.isFinite(index) ? index : 0,
    });
  }

  // Surface the active todo form as a lightweight Claude status line when we
  // have no narrative yet (Claude Code often works silently via tools).
  const activeIdx = state.activeTodoIndex ?? -1;
  const activeTodo = activeIdx >= 0 ? state.todos?.[activeIdx] : undefined;
  if (activeTodo && (activeTodo.status === 'in_progress' || activeTodo.status === 'completed')) {
    const label = (activeTodo.status === 'in_progress' ? activeTodo.activeForm : activeTodo.content) || activeTodo.content;
    if (label?.trim()) {
      items.push({
        id: `text-todo-status-${activeIdx}-${label.slice(0, 40)}`,
        kind: 'text',
        timestamp: state.startTime,
        label,
        status: 'info',
        todoIndex: activeIdx,
      });
    }
  }

  if (state.buildSummary) {
    items.push({
      id: 'text-summary-derived',
      kind: 'text',
      timestamp: state.endTime || new Date(),
      label: state.buildSummary.slice(0, 400),
      status: 'info',
    });
  }

  if (state.previewError) {
    items.push({
      id: 'status-preview-error-derived',
      kind: 'status',
      timestamp: state.endTime || new Date(),
      label: state.previewError,
      status: 'error',
    });
  }

  return items;
}

// Build Complete Summary component - shows collapsed todos
function BuildCompleteSummary({
  todos,
  buildSummary,
  previewError,
  onExpand,
}: {
  todos: TodoItem[];
  buildSummary?: string;
  previewError?: string;
  onExpand: () => void;
}) {
  const [showTodos, setShowTodos] = useState(false);

  return (
    <div className="border-t border-theme-primary\/20">
      {/* Summary section */}
      <div className="p-4">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-2">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">Build Complete</span>
        </div>

        {buildSummary && (
          <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
            {buildSummary}
          </p>
        )}

        {previewError && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{previewError}</span>
          </div>
        )}

        {/* Collapsible todos section */}
        {todos.length > 0 && (
          <button
            onClick={() => setShowTodos(!showTodos)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showTodos ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            <span>{todos.length} tasks completed</span>
          </button>
        )}

        <AnimatePresence>
          {showTodos && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-1 pl-2 border-l border-border">
                {todos.map((todo, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3 h-3 text-green-600/70 dark:text-green-400/60" />
                    <span className="text-muted-foreground">{todo.content}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={onExpand}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Show activity
        </button>
      </div>
    </div>
  );
}

export default function BuildProgress({
  state,
  defaultCollapsed = false,
  onClose,
  onCancel,
  isCancelling = false,
  templateInfo,
}: BuildProgressProps) {
  // ALWAYS call hooks first (React rules!)
  const [isCardExpanded, setIsCardExpanded] = useState(!defaultCollapsed);
  const [showTodoFallback, setShowTodoFallback] = useState(false);
  const todoListRef = useRef<HTMLDivElement>(null);

  // Calculate totals across both phases
  // Note: templateTodos and currentPhase are new fields added to GenerationState
  const stateWithPhases = state as GenerationState & {
    templateTodos?: TodoItem[];
    activeTemplateTodoIndex?: number;
    currentPhase?: 'template' | 'build';
  };
  const templateTodos = stateWithPhases?.templateTodos || [];
  const buildTodos = state?.todos || [];
  const templateCompleted = templateTodos.filter((t) => t.status === 'completed').length;
  const buildCompleted = buildTodos.filter((t) => t.status === 'completed').length;
  const completed = templateCompleted + buildCompleted;
  const total = templateTodos.length + buildTodos.length;
  const activityItems = useMemo(() => (state ? deriveActivityFeed(state) : []), [state]);
  const hasActivity = activityItems.length > 0;
  // Progress prefers todos when present; otherwise activity-based indeterminate progress while active
  const progress = total > 0 ? (completed / total) * 100 : state?.isActive ? 15 : hasActivity ? 100 : 0;
  const isComplete = Boolean(state && !state.isActive && (total === 0 ? hasActivity || !!state.buildSummary : completed === total));
  
  // Determine phase states
  const templatePhaseComplete = templateTodos.length > 0 && templateTodos.every((t) => t.status === 'completed');
  const templatePhaseActive = !templatePhaseComplete && templateTodos.some((t) => t.status === 'in_progress');
  const buildPhaseActive = stateWithPhases?.currentPhase === 'build' || (buildTodos.length > 0 && buildTodos.some((t) => t.status === 'in_progress'));
  const buildPhaseComplete = buildTodos.length > 0 && buildTodos.every((t) => t.status === 'completed');

  // Debug logging for state
  useEffect(() => {
    console.log('🔍 BuildProgress state update:', {
      todosLength: state?.todos?.length || 0,
      activityLength: activityItems.length,
      isActive: state?.isActive,
      activeTodoIndex: state?.activeTodoIndex,
      agentId: state?.agentId,
      claudeModelId: state?.claudeModelId,
      projectName: state?.projectName,
    });
  }, [state, activityItems.length]);

  // Auto-collapse card when build completes (only if not defaultCollapsed)
  useEffect(() => {
    if (isComplete && !defaultCollapsed) {
      console.log('🎉 Build complete, auto-collapsing card');
      setIsCardExpanded(false);
    }
  }, [isComplete, defaultCollapsed]);

  // Auto-scroll to active todo when it changes (todo fallback view)
  useEffect(() => {
    if (!state?.isActive || state.activeTodoIndex < 0 || !showTodoFallback) return;

    const timer = setTimeout(() => {
      const activeElement = document.querySelector(`[data-todo-index="${state.activeTodoIndex}"]`);
      if (activeElement && todoListRef.current) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [state?.activeTodoIndex, state?.isActive, showTodoFallback]);

  const allTodosCompleted = useMemo(() => {
    return state?.todos?.length ? state.todos.every((todo) => todo.status === 'completed') : false;
  }, [state?.todos]);

  // Validate state AFTER ALL hooks
  if (!state) {
    console.error('⚠️ Invalid generation state:', state);
    return (
      <div className="p-4 border border-red-500/30 rounded-lg bg-red-500/10">
        <p className="text-red-400 text-sm">Invalid build state. Please try again.</p>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-2 px-3 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 rounded"
          >
            Dismiss
          </button>
        )}
      </div>
    );
  }

  // Early planning shimmer only when we have no activity yet
  if (!hasActivity && total === 0 && state.isActive) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full p-4 rounded-xl theme-card"
      >
        <PlanningPhase
          activePlanningTool={state.activePlanningTool}
          projectName={state.projectName}
        />
        {onCancel && (
          <div className="mt-4">
            <button
              onClick={onCancel}
              disabled={isCancelling}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-red-400 transition-colors rounded-lg border border-white/10 hover:border-red-500/30 hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCancelling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Cancelling...</span>
                </>
              ) : (
                <>
                  <Square className="w-4 h-4" />
                  <span>Stop Build</span>
                </>
              )}
            </button>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full overflow-hidden rounded-xl theme-card shadow-2xl backdrop-blur-sm"
    >
      <BuildHeader
        projectName={state.projectName}
        agentId={state.agentId}
        claudeModelId={state.claudeModelId}
        completed={total > 0 ? completed : Math.min(activityItems.length, 1)}
        total={total > 0 ? total : Math.max(activityItems.length, 1)}
        progress={progress}
        isComplete={isComplete}
        isActive={state.isActive}
        isCardExpanded={isCardExpanded}
        onToggleExpand={() => setIsCardExpanded(!isCardExpanded)}
        onClose={onClose}
        templateInfo={templateInfo}
      />

      {/* Content - Only show when expanded */}
      {isCardExpanded && (
        <>
          <div className="flex items-center justify-between px-4 pt-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              {showTodoFallback ? 'Tasks' : 'Chat'}
            </p>
            {total > 0 && (
              <button
                type="button"
                onClick={() => setShowTodoFallback((v) => !v)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showTodoFallback ? 'Show chat' : 'Show tasks'}
              </button>
            )}
          </div>

          {showTodoFallback && total > 0 ? (
            <div ref={todoListRef}>
              {templateTodos.length > 0 ? (
                <>
                  <PhaseSection
                    phase="template"
                    title="Template Setup"
                    todos={templateTodos}
                    activeTodoIndex={stateWithPhases?.activeTemplateTodoIndex ?? -1}
                    isActive={templatePhaseActive}
                    isComplete={templatePhaseComplete}
                  />
                  {buildTodos.length > 0 && (
                    <PhaseSection
                      phase="build"
                      title="Application Build"
                      todos={buildTodos}
                      activeTodoIndex={state.activeTodoIndex}
                      isActive={buildPhaseActive}
                      isComplete={buildPhaseComplete}
                    />
                  )}
                </>
              ) : (
                <TodoList
                  todos={state.todos || []}
                  toolsByTodo={state.toolsByTodo || {}}
                  activeTodoIndex={state.activeTodoIndex}
                  allTodosCompleted={allTodosCompleted}
                />
              )}
            </div>
          ) : (
            <ActivityFeed
              items={activityItems}
              isActive={state.isActive}
              emptyLabel={state.isActive ? 'Starting agent…' : 'No activity recorded'}
              agentLabel={
                state.agentId === 'openai-codex'
                  ? 'Codex'
                  : state.agentId === 'opencode'
                    ? 'OpenCode'
                    : state.agentId === 'factory-droid'
                      ? 'Droid'
                      : 'Claude'
              }
            />
          )}

          {state.previewError && (
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{state.previewError}</span>
            </div>
          )}
              
          {/* Stop Build button - below the activity feed */}
          {state.isActive && onCancel && (
            <div className="px-4 pb-4">
              <button
                onClick={onCancel}
                disabled={isCancelling}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-red-400 transition-colors rounded-lg border border-white/10 hover:border-red-500/30 hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Cancelling...</span>
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4" />
                    <span>Stop Build</span>
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Build Complete Summary - show collapsed todos when build is done */}
      {isComplete && !isCardExpanded && (
        <BuildCompleteSummary
          todos={state.todos || []}
          buildSummary={state.buildSummary}
          previewError={state.previewError}
          onExpand={() => setIsCardExpanded(true)}
        />
      )}
    </motion.div>
  );
}
