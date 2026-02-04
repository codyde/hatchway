/**
 * Smart Todo Tracker
 *
 * Maintains task state and automatically infers progress from tool completions.
 * Combines AI-reported status with inferred state for maximum reliability.
 */

import type { TodoItem } from '@hatchway/agent-core/types/generation';
import { buildLogger } from '@hatchway/agent-core/lib/logging/build-logger';

export interface SmartTodoTracker {
  todos: TodoItem[];
  currentIndex: number;
}

/**
 * Create a new tracker with initial todos
 */
export function createSmartTracker(initialTodos: TodoItem[]): SmartTodoTracker {
  // Find the first in-progress task, or mark first as in-progress
  let currentIndex = initialTodos.findIndex(t => t.status === 'in_progress');

  if (currentIndex === -1) {
    // No task in progress, start with first pending task
    currentIndex = initialTodos.findIndex(t => t.status === 'pending');
    if (currentIndex !== -1) {
      initialTodos[currentIndex].status = 'in_progress';
    } else {
      currentIndex = 0;
    }
  }

  buildLogger.codexQuery.taskListStatus(
    initialTodos.filter(t => t.status === 'completed').length,
    initialTodos.filter(t => t.status === 'in_progress').length,
    initialTodos.filter(t => t.status === 'pending').length,
    initialTodos.length
  );

  return {
    todos: initialTodos,
    currentIndex,
  };
}

/**
 * Check if all tasks are complete
 */
export function isComplete(tracker: SmartTodoTracker): boolean {
  return tracker.todos.length > 0 &&
         tracker.todos.every(t => t.status === 'completed');
}

/**
 * Get current task
 */
export function getCurrentTask(tracker: SmartTodoTracker): TodoItem | null {
  return tracker.todos[tracker.currentIndex] || null;
}
