import { useEffect, useState } from 'react';
import { Box, Text, useApp, useStdout } from 'ink';
import { Banner, ProgressStepper, TaskStream, ConfigSummary, NextSteps, ErrorSummary, BuildErrorView } from '../components/index.js';
import { useInitFlow } from '../hooks/index.js';
import type { ConfigItem } from '../components/ConfigSummary.js';
import type { StreamTask } from '../components/TaskStream.js';
import { colors, symbols } from '../theme.js';
import { getVersionInfo } from '../../utils/version-info.js';

export interface InitConfig {
  workspace: string;
  monorepoPath?: string;
  databaseUrl?: string;
  apiUrl: string;
  runnerId: string;
}

export interface InitScreenProps {
  onInit: (callbacks: InitCallbacks) => Promise<InitConfig>;
  onComplete?: (config: InitConfig) => void;
  onError?: (error: Error) => void;
}

export interface InitCallbacks {
  // Step management
  activateStep: (stepId: string) => void;
  completeStep: (stepId: string) => void;
  failStep: (stepId: string) => void;
  // Task management
  startTask: (taskId: string, detail?: string) => void;
  completeTask: (taskId: string) => void;
  failTask: (taskId: string, error: string) => void;
  // Skip task (remove from display)
  skipTask: (taskId: string) => void;
  // Update task label
  updateTaskLabel: (taskId: string, label: string) => void;
  // Error handling
  setError: (message: string, suggestions: string[]) => void;
  // Build error with full output for scrollable view
  setBuildError: (message: string, errorLines: string[], suggestions: string[]) => void;
}

/**
 * Main init screen - fullscreen centered TUI
 * Shows progress stepper with tasks appearing under the active step
 */
export function InitScreen({ onInit, onComplete, onError }: InitScreenProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const flow = useInitFlow();
  const [finalConfig, setFinalConfig] = useState<InitConfig | null>(null);
  
  // Get version info
  const versionInfo = getVersionInfo();
  
  // Calculate vertical centering
  const terminalHeight = stdout?.rows || 24;
  const contentHeight = 20;
  const topPadding = Math.max(0, Math.floor((terminalHeight - contentHeight) / 3));

  // Run init flow
  useEffect(() => {
    const callbacks: InitCallbacks = {
      activateStep: flow.activateStep,
      completeStep: flow.completeStep,
      failStep: flow.failStep,
      startTask: flow.startTask,
      completeTask: flow.completeTask,
      failTask: flow.failTask,
      skipTask: (taskId: string) => {
        flow.setTaskStatus(taskId, 'completed');
      },
      updateTaskLabel: (taskId: string, label: string) => {
        flow.setTaskStatus(taskId, flow.state.tasks.find(t => t.id === taskId)?.status || 'pending');
      },
      setError: flow.setError,
      setBuildError: flow.setBuildError,
    };

    onInit(callbacks)
      .then((config) => {
        setFinalConfig(config);
        
        // Set config summary items
        const configItems: ConfigItem[] = [
          { label: 'Workspace', value: config.workspace },
          { label: 'Server', value: config.apiUrl },
          { label: 'Runner', value: config.runnerId },
        ];
        
        if (config.monorepoPath) {
          configItems.push({ label: 'Repository', value: config.monorepoPath });
        }
        
        flow.setConfig(configItems);
        flow.markComplete();
        
        if (onComplete) {
          onComplete(config);
        }
      })
      .catch((error) => {
        if (onError) {
          onError(error);
        }
      });
  }, []);

  const { state } = flow;
  
  // Get tasks for current step only, mapped to StreamTask format
  const currentStepTasks: StreamTask[] = flow.getActiveStepTasks().map(task => ({
    id: task.id,
    label: task.label,
    status: task.status,
    detail: task.detail,
    error: task.error,
  }));

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={topPadding}>
      {/* Banner */}
      <Banner />
      
      {/* Version - right under banner */}
      <Box marginTop={1}>
        <Text color={colors.gray} dimColor>
          {versionInfo.display}
        </Text>
      </Box>
      
      {/* Spacer */}
      <Box marginTop={1} />
      
      {/* Progress Stepper (just dots and labels) */}
      <ProgressStepper steps={state.steps} />
      
      {/* Task Stream - shows current step's tasks with typewriter effect */}
      {!state.isComplete && !state.error && (
        <TaskStream 
          stepId={state.phase}
          tasks={currentStepTasks}
        />
      )}
      
      {/* Error Display - show full BuildErrorView for build errors, simple ErrorSummary for others */}
      {state.error && state.error.buildError && (
        <BuildErrorView
          title={state.error.message}
          errorLines={state.error.buildError.errorLines}
          suggestions={state.error.buildError.suggestions}
          onExit={() => exit()}
        />
      )}
      {state.error && !state.error.buildError && (
        <Box marginTop={2}>
          <ErrorSummary 
            message={state.error.message} 
            suggestions={state.error.suggestions} 
          />
        </Box>
      )}
      
      {/* Completion Display - show summary of all completed tasks */}
      {state.isComplete && !state.error && (
        <Box marginTop={2} flexDirection="column" alignItems="center">
          {/* Success message */}
          <Text color={colors.success} bold>
            {symbols.check} Setup complete!
          </Text>
          
          {/* Completed tasks summary */}
          <Box marginTop={1} flexDirection="column">
            {state.tasks.filter(t => t.status === 'completed').map(task => (
              <Box key={task.id}>
                <Text color={colors.success}>{symbols.check}</Text>
                <Text color={colors.gray}> {task.label}</Text>
              </Box>
            ))}
          </Box>
          
          <Box marginTop={1} />
          <ConfigSummary items={state.config} />
          <NextSteps command="hatchway run" url="http://localhost:3000" />
        </Box>
      )}
    </Box>
  );
}
