'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import type { ToolCall } from '@/types/generation';

interface PlanningPhaseProps {
  activePlanningTool?: ToolCall;
  projectName?: string;
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
    return match ? match[1] : path.split('/').slice(-2).join('/');
  }
  if (input.path) {
    const path = input.path as string;
    const match = path.match(/hatchway-workspace\/[^/]+\/(.+)$/);
    return match ? match[1] : path.split('/').slice(-2).join('/');
  }
  if (input.command) {
    const cmd = input.command as string;
    return cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
  }
  if (input.query) {
    const query = input.query as string;
    return query.length > 40 ? query.substring(0, 40) + '...' : query;
  }
  if (input.pattern) return input.pattern as string;

  return '';
}

// Get a friendly name for the tool action
function getToolDisplayName(toolName: string): string {
  const displayNames: Record<string, string> = {
    'Bash': 'Running command',
    'Read': 'Reading',
    'Write': 'Writing',
    'Glob': 'Finding files',
    'Grep': 'Searching',
    'EnterPlanMode': 'Entering plan mode',
    'ExitPlanMode': 'Finalizing plan',
    'Task': 'Exploring',
    'WebFetch': 'Fetching',
  };
  return displayNames[toolName] || toolName;
}

export function PlanningPhase({ activePlanningTool, projectName }: PlanningPhaseProps) {
  const displayName = activePlanningTool ? getToolDisplayName(activePlanningTool.name) : null;
  const resource = activePlanningTool ? getToolResource(activePlanningTool) : null;

  return (
    <div className="space-y-2">
      {/* Main status line with shimmer */}
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 text-theme-primary animate-spin" />
        <span className="text-sm shimmer-text">Analyzing project</span>
        {projectName && <span className="text-sm text-gray-500">· {projectName}</span>}
      </div>

      {/* Current tool call with shimmer */}
      <AnimatePresence mode="wait">
        {activePlanningTool && (
          <motion.div
            key={activePlanningTool.id}
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="ml-6 flex items-center gap-2 text-xs"
          >
            <span className="text-gray-600">└─</span>
            <span className="font-mono shimmer-text">{displayName}</span>
            {resource && (
              <span className="font-mono text-gray-500 truncate max-w-[250px]">{resource}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
