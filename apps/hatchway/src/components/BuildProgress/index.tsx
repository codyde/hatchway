'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, ChevronDown, ChevronUp, Square } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { GenerationState, TodoItem } from '@/types/generation';
import { BuildHeader } from './BuildHeader';
import { TodoList } from './TodoList';
import { PlanningPhase } from './PlanningPhase';
import { PhaseSection } from './PhaseSection';

interface BuildProgressProps {
  state: GenerationState;
  defaultCollapsed?: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  isCancelling?: boolean;
  onViewFiles?: () => void;
  onStartServer?: () => void;
  templateInfo?: {
    name: string;
    framework: string;
    analyzedBy?: string;
  } | null;
}

// Build Complete Summary component - shows collapsed todos
function BuildCompleteSummary({
  todos,
  buildSummary,
  onExpand,
}: {
  todos: TodoItem[];
  buildSummary?: string;
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

        {/* Collapsible todos section */}
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
  onViewFiles,
  onStartServer,
  templateInfo,
}: BuildProgressProps) {
  // ALWAYS call hooks first (React rules!)
  const [isCardExpanded, setIsCardExpanded] = useState(!defaultCollapsed);
  const todoListRef = useRef<HTMLDivElement>(null);
  const activeTodoRef = useRef<HTMLDivElement>(null);

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
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const isComplete = progress === 100 && !state?.isActive;
  
  // Determine phase states
  const templatePhaseComplete = templateTodos.length > 0 && templateTodos.every((t) => t.status === 'completed');
  const templatePhaseActive = !templatePhaseComplete && templateTodos.some((t) => t.status === 'in_progress');
  const buildPhaseActive = stateWithPhases?.currentPhase === 'build' || (buildTodos.length > 0 && buildTodos.some((t) => t.status === 'in_progress'));
  const buildPhaseComplete = buildTodos.length > 0 && buildTodos.every((t) => t.status === 'completed');

  // Debug logging for state
  useEffect(() => {
    console.log('🔍 BuildProgress state update:', {
      todosLength: state?.todos?.length || 0,
      isActive: state?.isActive,
      activeTodoIndex: state?.activeTodoIndex,
      agentId: state?.agentId,
      claudeModelId: state?.claudeModelId,
      projectName: state?.projectName,
    });

    if (state?.toolsByTodo) {
      const toolCounts = Object.keys(state.toolsByTodo)
        .map((idx) => `todo${idx}: ${state.toolsByTodo[Number(idx)]?.length || 0} tools`)
        .join(', ');
      console.log('   📊 toolsByTodo:', toolCounts || 'empty');
    }
  }, [state]);

  // Auto-collapse card when build completes (only if not defaultCollapsed)
  useEffect(() => {
    if (isComplete && !defaultCollapsed) {
      console.log('🎉 Build complete, auto-collapsing card');
      setIsCardExpanded(false);
    }
  }, [isComplete, defaultCollapsed]);

  // Auto-scroll to active todo when it changes
  useEffect(() => {
    if (!state?.isActive || state.activeTodoIndex < 0) return;

    // Small delay to let the DOM update
    const timer = setTimeout(() => {
      const activeElement = document.querySelector(`[data-todo-index="${state.activeTodoIndex}"]`);
      if (activeElement && todoListRef.current) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
        console.log(`📜 Auto-scrolled to active todo: ${state.activeTodoIndex}`);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [state?.activeTodoIndex, state?.isActive]);

  // Removed auto-switch logic - ONLY todo view now!

  // ALL useMemo/useCallback MUST be before early returns
  const allTodosCompleted = useMemo(() => {
    return state.todos?.length ? state.todos.every((todo) => todo.status === 'completed') : false;
  }, [state.todos]);

  // Validate state AFTER ALL hooks
  if (!state || !state.todos || !Array.isArray(state.todos)) {
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

  // Show planning phase ONLY if no todos yet (Claude is exploring/planning)
  if (total === 0 && state.isActive) {
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
        completed={completed}
        total={total}
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
          {total > 0 ? (
            <div ref={todoListRef}>
              {/* Two-phase display when template todos exist */}
              {templateTodos.length > 0 ? (
                <>
                  {/* Phase 1: Template Configuration */}
                  <PhaseSection
                    phase="template"
                    title="Template Setup"
                    todos={templateTodos}
                    activeTodoIndex={stateWithPhases?.activeTemplateTodoIndex ?? -1}
                    isActive={templatePhaseActive}
                    isComplete={templatePhaseComplete}
                  />
                  
                  {/* Phase 2: Application Build */}
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
                /* Legacy single-phase display (no template phase) */
                <TodoList
                  todos={state.todos}
                  toolsByTodo={state.toolsByTodo}
                  activeTodoIndex={state.activeTodoIndex}
                  allTodosCompleted={allTodosCompleted}
                  onViewFiles={onViewFiles}
                  onStartServer={onStartServer}
                />
              )}
              
              {/* Stop Build button - below the task list */}
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
            </div>
          ) : (
            <div className="p-6 text-center text-gray-400 text-sm">
              {state.isActive ? 'Initializing build...' : 'No tasks to display'}
            </div>
          )}
        </>
      )}

      {/* Build Complete Summary - show collapsed todos when build is done */}
      {isComplete && !isCardExpanded && (
        <BuildCompleteSummary
          todos={state.todos}
          buildSummary={state.buildSummary}
          onExpand={() => setIsCardExpanded(true)}
        />
      )}
    </motion.div>
  );
}
