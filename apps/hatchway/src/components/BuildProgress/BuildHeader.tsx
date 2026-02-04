'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, Sparkles, ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  getClaudeModelLabel,
  DEFAULT_CLAUDE_MODEL_ID,
  type AgentId,
  type ClaudeModelId,
} from '@hatchway/agent-core/client';

interface BuildHeaderProps {
  projectName: string;
  agentId?: AgentId;
  claudeModelId?: ClaudeModelId;
  completed: number;
  total: number;
  progress: number;
  isComplete: boolean;
  isActive: boolean;
  isCardExpanded: boolean;
  onToggleExpand: () => void;
  onClose?: () => void;
  templateInfo?: {
    name: string;
    framework: string;
    analyzedBy?: string;
  } | null;
}

export function BuildHeader({
  projectName,
  agentId,
  claudeModelId,
  completed,
  total,
  progress,
  isComplete,
  isActive,
  isCardExpanded,
  onToggleExpand,
  onClose,
  templateInfo,
}: BuildHeaderProps) {
  // Agent values validated

  const agentLabel =
    agentId === 'openai-codex'
      ? 'OpenAI GPT-5 Codex'
      : `Claude Code • ${getClaudeModelLabel(claudeModelId ?? DEFAULT_CLAUDE_MODEL_ID)}`;

  return (
    <>
      {/* Header - Always clickable when there are todos */}
      <div
        className={`relative border-b border-theme-primary\/20 theme-card-header px-4 py-3 ${
          total > 0 ? 'cursor-pointer hover:bg-theme-primary-muted transition-colors' : ''
        }`}
        onClick={() => total > 0 && onToggleExpand()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary-muted text-theme-primary">
              {isComplete ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {isComplete ? '✓ Build Complete!' : `Building ${projectName}`}
              </h3>
              {isCardExpanded ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {completed} of {total} complete
                  </p>
                  {templateInfo && (
                    <p className="text-xs text-theme-accent opacity-80">
                      {templateInfo.framework}
                      {templateInfo.analyzedBy && ` • Selected by ${templateInfo.analyzedBy}`}
                      {agentId && ` • ${agentLabel}`}
                    </p>
                  )}
                  {!templateInfo && agentId && (
                    <p className="text-xs text-theme-accent opacity-80">{agentLabel}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    {completed} of {total} complete • Click to expand
                  </p>
                  {templateInfo && (
                    <p className="text-xs text-theme-accent opacity-70">
                      {templateInfo.framework}
                      {templateInfo.analyzedBy && ` • ${templateInfo.analyzedBy}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className={`text-xl font-bold ${isComplete ? 'text-green-600 dark:text-green-400' : 'text-theme-primary'}`}>
                {Math.round(progress)}%
              </div>
            </div>
            {total > 0 && (
              <div className="ml-2">
                {isCardExpanded ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
            )}
            {!isActive && onClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-accent"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="h-full progress-theme"
          />
        </div>
      </div>
    </>
  );
}
