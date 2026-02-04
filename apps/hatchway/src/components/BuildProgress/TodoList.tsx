'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { TodoItem, ToolCall } from '@/types/generation';

interface TodoListProps {
  todos: TodoItem[];
  toolsByTodo: Record<number, ToolCall[]>;
  activeTodoIndex: number;
  allTodosCompleted: boolean;
  onViewFiles?: () => void;
  onStartServer?: () => void;
}

// Helper: Get the last non-TodoWrite tool for a todo
function getLastDisplayableTool(tools: ToolCall[]): ToolCall | null {
  const filtered = tools.filter((t) => t.name !== 'TodoWrite');
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

// Helper: Extract resource string from tool input
function getToolResource(tool: ToolCall): string {
  if (!tool.input) return '';
  const input = tool.input as Record<string, unknown>;

  // Priority order for resource extraction
  if (input.file_path) {
    const path = input.file_path as string;
    // Extract relative path after workspace directory
    const match = path.match(/hatchway-workspace\/[^/]+\/(.+)$/);
    return match ? match[1] : path;
  }
  if (input.path) {
    const path = input.path as string;
    const match = path.match(/hatchway-workspace\/[^/]+\/(.+)$/);
    return match ? match[1] : path;
  }
  if (input.command) {
    const cmd = input.command as string;
    return cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
  }
  if (input.query) {
    const query = input.query as string;
    return query.length > 60 ? query.substring(0, 60) + '...' : query;
  }
  if (input.pattern) return input.pattern as string;

  return '';
}

// Thinking state display when no tool is active yet
function ThinkingDisplay() {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="ml-6 mt-1 flex items-center gap-2 text-xs overflow-hidden"
    >
      <span className="text-gray-600">└─</span>
      <span className="font-mono shimmer-text">Thinking...</span>
    </motion.div>
  );
}

// Inline component for active tool display with shimmer
function ActiveToolDisplay({ tool }: { tool: ToolCall }) {
  const resource = getToolResource(tool);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="ml-6 mt-1 flex items-center gap-2 text-xs overflow-hidden"
    >
      {/* Tree branch connector */}
      <span className="text-gray-600">└─</span>

      {/* Tool name with shimmer, resource in gray */}
      <span className="font-mono shimmer-text">{tool.name}</span>
      {resource && <span className="font-mono text-gray-500 truncate max-w-[300px]">{resource}</span>}

      {/* Activity indicator */}
      <Loader2 className="w-3 h-3 text-theme-primary animate-spin flex-shrink-0" />
    </motion.div>
  );
}

export function TodoList({
  todos,
  toolsByTodo,
  activeTodoIndex,
  allTodosCompleted,
  onViewFiles,
  onStartServer,
}: TodoListProps) {
  return (
    <div className="p-3">
      <AnimatePresence mode="popLayout">
        {todos.map((todo, index) => {
          const isActive = index === activeTodoIndex && todo.status === 'in_progress';
          const lastTool = isActive ? getLastDisplayableTool(toolsByTodo[index] || []) : null;

          return (
            <motion.div
              key={`${todo.content}-${index}`}
              data-todo-index={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ delay: index * 0.03 }}
              className="mb-1.5 last:mb-0"
            >
              {/* Todo Item - Flat, non-clickable */}
              <div className="flex items-center gap-2 px-2 py-1">
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {todo.status === 'completed' ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </motion.div>
                  ) : todo.status === 'in_progress' ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    >
                      <Loader2 className="h-4 w-4 text-theme-primary" />
                    </motion.div>
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Todo text */}
                <p
                  className={`text-sm font-medium ${
                    todo.status === 'completed'
                      ? 'text-muted-foreground line-through'
                      : todo.status === 'in_progress'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                  }`}
                >
                  {todo.status === 'in_progress' ? todo.activeForm : todo.content}
                </p>
              </div>

              {/* Active tool display - only for in_progress todo */}
              <AnimatePresence>
                {isActive && (lastTool ? <ActiveToolDisplay tool={lastTool} /> : <ThinkingDisplay />)}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
