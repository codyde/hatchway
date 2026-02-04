'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, Loader2, Package, Hammer } from 'lucide-react';
import type { TodoItem } from '@/types/generation';

interface PhaseSectionProps {
  phase: 'template' | 'build';
  title: string;
  todos: TodoItem[];
  activeTodoIndex: number;
  isActive: boolean;
  isComplete: boolean;
}

export function PhaseSection({
  phase,
  title,
  todos,
  activeTodoIndex,
  isActive,
  isComplete,
}: PhaseSectionProps) {
  const PhaseIcon = phase === 'template' ? Package : Hammer;
  
  // Don't render if no todos
  if (todos.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-3 last:mb-0"
    >
      {/* Phase Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : isActive ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="h-4 w-4 text-theme-primary" />
            </motion.div>
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
          <PhaseIcon className={`h-4 w-4 ${isComplete ? 'text-green-600/70 dark:text-green-400/60' : isActive ? 'text-theme-primary' : 'text-muted-foreground'}`} />
          <span className={`text-xs font-medium uppercase tracking-wide ${
            isComplete ? 'text-green-700 dark:text-green-400/80' : isActive ? 'text-theme-accent' : 'text-muted-foreground'
          }`}>
            {title}
          </span>
        </div>
        {isComplete && (
          <span className="text-xs text-muted-foreground ml-auto">
            {todos.length} task{todos.length !== 1 ? 's' : ''} completed
          </span>
        )}
      </div>

      {/* Phase Todos */}
      <div className="py-2">
        <AnimatePresence mode="popLayout">
          {todos.map((todo, index) => {
            return (
              <motion.div
                key={`${phase}-${todo.content}-${index}`}
                data-todo-index={index}
                data-phase={phase}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.03 }}
                className="mb-1 last:mb-0"
              >
                <div className="flex items-center gap-2 px-3 py-1">
                  {/* Status icon */}
                  <div className="flex-shrink-0">
                    {todo.status === 'completed' ? (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      </motion.div>
                    ) : todo.status === 'in_progress' ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      >
                        <Loader2 className="h-3.5 w-3.5 text-theme-primary" />
                      </motion.div>
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Todo text */}
                  <p
                    className={`text-sm ${
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
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
