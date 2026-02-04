'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import type { TodoItem } from '@/types/generation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ErrorDetectedSectionProps {
  errorMessage?: string;
  todos: TodoItem[];
  buildSummary?: string;
  isActive: boolean;
  defaultExpanded?: boolean;
}

/**
 * A section displayed when an auto-fix session is triggered.
 * Shows the detected error, the fix todos, and the fix summary.
 */
export function ErrorDetectedSection({
  errorMessage,
  todos,
  buildSummary,
  isActive,
  defaultExpanded = true,
}: ErrorDetectedSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;

  return (
    <div className="space-y-3">
      {/* Error Detected Header */}
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <p className="text-xs uppercase tracking-[0.3em] text-amber-400 font-medium">
          Error Detected
        </p>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
            {errorMessage}
          </pre>
        </div>
      )}

      {/* Auto-Fix Status */}
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20">
          <Wrench className="w-3 h-3 text-blue-400" />
        </div>
        <span className="text-xs text-blue-400 font-medium">
          {isActive ? 'Fixing automatically...' : 'Auto-fix completed'}
        </span>
      </div>

      {/* Fix Tasks */}
      {todos.length > 0 && (
        <div>
          {/* Expandable header */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <div className="flex items-center gap-1.5">
              {isActive ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
              )}
              <span className="font-medium">
                {isActive 
                  ? `${completedCount}/${totalCount} fix tasks completed`
                  : `${completedCount} fix task${completedCount !== 1 ? 's' : ''} completed`
                }
              </span>
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
                      {todo.status === 'completed' ? (
                        <CheckCircle2 className="w-3 h-3 text-green-600/70 dark:text-green-400/60 flex-shrink-0 mt-0.5" />
                      ) : todo.status === 'in_progress' ? (
                        <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-3 h-3 border border-muted-foreground rounded-full flex-shrink-0 mt-0.5" />
                      )}
                      <span className={todo.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'}>
                        {todo.content}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Fix Summary */}
      {buildSummary && !isActive && (
        <div className="space-y-2 mt-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
            Fix summary
          </p>
          <div className="prose prose-invert max-w-none text-sm leading-relaxed prose-p:text-gray-300 prose-strong:text-gray-200 prose-code:text-blue-300 prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {buildSummary}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
