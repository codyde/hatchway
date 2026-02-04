'use client';

import { useState } from 'react';
import { 
  Github, 
  ExternalLink, 
  GitBranch, 
  Clock, 
  AlertCircle, 
  GitCommit,
  Upload,
  RefreshCw,
  Settings,
  Unlink,
  Loader2,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GitHubStatus } from '@hatchway/agent-core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { useSyncGitHub, useUpdateGitHubSettings, useDisconnectGitHub } from '@/mutations/github';
import { useToast } from '@/components/ui/toast';

interface GitHubDropdownProps {
  projectId: string;
  status: GitHubStatus;
  className?: string;
  variant?: 'default' | 'compact';
  /** Callback to trigger a push via agent (sends chat message) */
  onPushClick?: () => void;
  /** Whether a generation/build is currently running */
  isGenerating?: boolean;
}

/**
 * Dropdown menu showing GitHub repo info and actions
 */
export function GitHubDropdown({
  projectId,
  status,
  className,
  variant = 'default',
  onPushClick,
  isGenerating = false,
}: GitHubDropdownProps) {
  const { addToast } = useToast();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  
  const syncMutation = useSyncGitHub(projectId);
  const settingsMutation = useUpdateGitHubSettings(projectId);
  const disconnectMutation = useDisconnectGitHub(projectId);

  const handlePush = () => {
    if (onPushClick) {
      onPushClick();
    } else {
      addToast('info', 'Push handler not configured');
    }
  };

  const handleSync = async () => {
    try {
      await syncMutation.mutateAsync();
      addToast('success', 'Fetching latest repository info.');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to sync');
    }
  };

  const handleToggleAutoPush = async () => {
    try {
      await settingsMutation.mutateAsync({ autoPush: !status.autoPush });
      addToast(
        'success',
        status.autoPush 
          ? 'Auto-push disabled. Changes will no longer be pushed automatically.'
          : 'Auto-push enabled. Changes will be pushed after successful builds.'
      );
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to update settings');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectMutation.mutateAsync();
      addToast('success', 'GitHub integration has been removed from this project.');
      setShowDisconnectConfirm(false);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to disconnect');
    }
  };

  const formatRelativeTime = (date: Date | string | null) => {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const repoName = status.repo?.split('/')[1] || status.repo || 'Unknown';
  const isLoading = isGenerating || syncMutation.isPending || 
                    settingsMutation.isPending || disconnectMutation.isPending;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
            'bg-green-500/10 hover:bg-green-500/20 border border-green-600/30 hover:border-green-500/50',
            'text-green-700 hover:text-green-600 dark:text-green-400 dark:hover:text-green-300',
            className
          )}
        >
          <Github className="w-3.5 h-3.5" />
          {variant === 'default' && (
            <span className="truncate max-w-[100px]">{repoName}</span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent 
        className="w-72 bg-popover border-border" 
        align="end"
        sideOffset={8}
      >
        {/* Repository Header */}
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Github className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground truncate">
              {status.repo}
            </span>
          </div>
          {status.url && (
            <a
              href={status.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 mt-1 text-xs text-blue-400 hover:text-blue-300"
            >
              <ExternalLink className="w-3 h-3" />
              Open on GitHub
            </a>
          )}
        </div>

        {/* Repository Info */}
        <div className="px-3 py-2 space-y-1.5 text-xs border-b border-border">
          <div className="flex items-center gap-2 text-muted-foreground">
            <GitBranch className="w-3 h-3" />
            <span>Branch: <span className="text-foreground">{status.branch || 'main'}</span></span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Last push: <span className="text-foreground">{formatRelativeTime(status.lastPushedAt)}</span></span>
          </div>
          {status.meta?.openIssuesCount !== undefined && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="w-3 h-3" />
              <span>Open issues: <span className="text-foreground">{status.meta.openIssuesCount}</span></span>
            </div>
          )}
        </div>

        {/* Recent Commits */}
        {status.meta?.recentCommits && status.meta.recentCommits.length > 0 && (
          <div className="px-3 py-2 border-b border-border">
            <DropdownMenuLabel className="px-0 py-1 text-xs text-muted-foreground">
              Recent Commits
            </DropdownMenuLabel>
            <div className="space-y-1">
              {status.meta.recentCommits.slice(0, 3).map((commit) => (
                <div key={commit.sha} className="flex items-start gap-2 text-xs">
                  <GitCommit className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="text-muted-foreground truncate">{commit.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="py-1">
          <DropdownMenuItem
            onClick={handlePush}
            disabled={isLoading}
            className="text-foreground hover:bg-accent cursor-pointer"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="w-4 h-4 text-muted-foreground" />
            )}
            <span>{isGenerating ? 'Pushing...' : 'Push Changes'}</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={handleSync}
            disabled={isLoading}
            className="text-foreground hover:bg-accent cursor-pointer"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            )}
            <span>Refresh Info</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator className="bg-border" />

          {/* Auto-push Toggle */}
          <DropdownMenuCheckboxItem
            checked={status.autoPush}
            onCheckedChange={handleToggleAutoPush}
            disabled={settingsMutation.isPending}
            className="text-foreground hover:bg-accent"
          >
            <span>Auto-push after builds</span>
          </DropdownMenuCheckboxItem>

          <DropdownMenuSeparator className="bg-border" />

          {/* Disconnect */}
          {showDisconnectConfirm ? (
            <div className="px-2 py-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                Are you sure? This won&apos;t delete the GitHub repository.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleDisconnect}
                  disabled={disconnectMutation.isPending}
                  className="flex-1 px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                >
                  {disconnectMutation.isPending ? 'Disconnecting...' : 'Confirm'}
                </button>
                <button
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="flex-1 px-2 py-1 text-xs bg-muted hover:bg-accent text-foreground rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <DropdownMenuItem
              onClick={() => setShowDisconnectConfirm(true)}
              className="text-red-400 hover:bg-red-900/20 cursor-pointer"
            >
              <Unlink className="w-4 h-4" />
              <span>Disconnect GitHub</span>
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
