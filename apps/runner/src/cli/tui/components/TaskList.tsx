import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { colors, symbols, layout } from '../theme.js';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Task {
  id: string;
  label: string;
  status: TaskStatus;
  detail?: string;
  error?: string;
}

interface TaskListProps {
  tasks: Task[];
}

/**
 * Animated task list with spinner for running tasks
 * All items are left-aligned with consistent formatting:
 * 
 * ✓  Repository cloned
 * ✓  Dependencies installed
 * ⠋  Building packages...
 *    └─ @hatchway/agent-core
 * ○  Database setup
 */
export function TaskList({ tasks }: TaskListProps) {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  // Animate spinner
  useEffect(() => {
    const hasRunningTask = tasks.some(t => t.status === 'running');
    if (!hasRunningTask) return;

    const interval = setInterval(() => {
      setSpinnerIndex(prev => (prev + 1) % symbols.spinnerFrames.length);
    }, layout.spinnerInterval);

    return () => clearInterval(interval);
  }, [tasks]);

  const getStatusSymbol = (status: TaskStatus): string => {
    switch (status) {
      case 'completed':
        return symbols.check;
      case 'failed':
        return symbols.cross;
      case 'running':
        return symbols.spinnerFrames[spinnerIndex];
      default:
        return symbols.hollowDot;
    }
  };

  const getStatusColor = (status: TaskStatus): string => {
    switch (status) {
      case 'completed':
        return colors.success;
      case 'failed':
        return colors.error;
      case 'running':
        return colors.cyan;
      default:
        return colors.dimGray;
    }
  };

  // Use the same width as ProgressStepper for alignment
  return (
    <Box flexDirection="column" width={layout.progressWidth}>
      {tasks.map(task => (
        <Box key={task.id} flexDirection="column">
          {/* Main task line - fixed format: "✓  Label" */}
          <Box>
            <Text color={getStatusColor(task.status)}>
              {getStatusSymbol(task.status)}{'  '}{task.label}
            </Text>
          </Box>
          
          {/* Detail line (if present and task is running or failed) */}
          {task.detail && (task.status === 'running' || task.status === 'failed') && (
            <Box paddingLeft={3}>
              <Text color={colors.dimGray}>
                {symbols.treeConnector} {task.detail}
              </Text>
            </Box>
          )}
          
          {/* Error message (if failed) */}
          {task.error && task.status === 'failed' && (
            <Box paddingLeft={3}>
              <Text color={colors.error}>
                {symbols.treeConnector} {task.error}
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
