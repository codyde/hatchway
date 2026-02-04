'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import type { TodoItem } from '@/types/generation';

interface CompletedTodosSummaryProps {
  todos: TodoItem[];
  defaultExpanded?: boolean;
}

/**
 * A collapsible summary of completed todos displayed inline in the chat flow.
 * Shows as a simple expandable list above the build summary message.
 */
export function CompletedTodosSummary({ todos, defaultExpanded = false }: CompletedTodosSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const completedCount = todos.filter(t => t.status === 'completed').length;

  if (todos.length === 0) return null;

  return (
    <div>
      {/* Expandable header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
          <span className="font-medium">{completedCount} task{completedCount !== 1 ? 's' : ''} completed</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {/* Expandable todo list */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1 pl-2 border-l border-border">
              {todos.map((todo, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs py-0.5">
                  <CheckCircle2 className="w-3 h-3 text-green-600/70 dark:text-green-400/60 flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{todo.content}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
