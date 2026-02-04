'use client';

import { useState } from 'react';
import { 
  Database, 
  ExternalLink, 
  Clock, 
  AlertTriangle,
  Unlink,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NeonDBStatus } from '@hatchway/agent-core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface NeonDBDropdownProps {
  projectId: string;
  status: NeonDBStatus;
  className?: string;
  variant?: 'default' | 'compact';
}

/**
 * Dropdown menu showing NeonDB info and actions
 */
export function NeonDBDropdown({
  projectId,
  status,
  className,
  variant = 'default',
}: NeonDBDropdownProps) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/neondb`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'neondb'] });
      addToast('success', 'NeonDB integration has been removed from this project.');
      setShowDisconnectConfirm(false);
    },
    onError: (error) => {
      addToast('error', error instanceof Error ? error.message : 'Failed to disconnect');
    },
  });

  const handleCopyHost = async () => {
    if (status.host) {
      await navigator.clipboard.writeText(status.host);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast('success', 'Host copied to clipboard');
    }
  };

  const formatTimeRemaining = (date: Date | string | null) => {
    if (!date) return null;
    const d = new Date(date);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    
    if (diffMs <= 0) return 'Expired';
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffHours > 0) return `${diffHours}h ${diffMins}m remaining`;
    return `${diffMins}m remaining`;
  };

  const formatRelativeTime = (date: Date | string | null) => {
    if (!date) return 'Unknown';
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

  const isLoading = disconnectMutation.isPending;
  const timeRemaining = formatTimeRemaining(status.expiresAt);
  const isExpiringSoon = status.expiresAt && 
    new Date(status.expiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000; // Less than 24 hours

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
            'bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-600/30 hover:border-emerald-500/50',
            'text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300',
            className
          )}
        >
          <Database className="w-3.5 h-3.5" />
          {variant === 'default' && (
            <span className="truncate max-w-[100px]">{status.database || 'neondb'}</span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent 
        className="w-72 bg-popover border-border" 
        align="end"
        sideOffset={8}
      >
        {/* Database Header */}
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-foreground">
              NeonDB PostgreSQL
            </span>
          </div>
          {status.host && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-xs text-muted-foreground truncate flex-1">{status.host}</span>
              <button 
                onClick={handleCopyHost}
                className="text-muted-foreground hover:text-foreground p-0.5"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-green-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Database Info */}
        <div className="px-3 py-2 space-y-1.5 text-xs border-b border-border">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="w-3 h-3" />
            <span>Database: <span className="text-foreground">{status.database || 'neondb'}</span></span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Created: <span className="text-foreground">{formatRelativeTime(status.createdAt)}</span></span>
          </div>
          
          {/* Expiration Warning */}
          {status.claimUrl && timeRemaining && (
            <div className={cn(
              'flex items-center gap-2',
              isExpiringSoon ? 'text-yellow-400' : 'text-gray-400'
            )}>
              <AlertTriangle className="w-3 h-3" />
              <span>{timeRemaining}</span>
            </div>
          )}
        </div>

        {/* Claim URL Section */}
        {status.claimUrl && (
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs text-yellow-400 mb-2">
              Claim this database to keep it permanently:
            </p>
            <a
              href={status.claimUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
            >
              <ExternalLink className="w-3 h-3" />
              Claim Database
            </a>
          </div>
        )}

        {/* Actions */}
        <div className="py-1">
          {/* Disconnect */}
          {showDisconnectConfirm ? (
            <div className="px-2 py-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                Remove database info from this project?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="flex-1 px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                >
                  {disconnectMutation.isPending ? 'Removing...' : 'Confirm'}
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
              <span>Remove Database</span>
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
