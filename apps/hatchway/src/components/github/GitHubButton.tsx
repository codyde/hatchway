'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Github, Loader2, Globe, Lock, ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGitHubStatus, useGitHubConnection } from '@/queries/github';
import { useCreateGitHubRepo } from '@/mutations/github';
import { GitHubDropdown } from './GitHubDropdown';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

export type RepoVisibility = 'public' | 'private';

interface GitHubButtonProps {
  projectId: string;
  projectSlug: string;
  /** Callback after repo is created - receives the repo URL for skill to push code */
  onRepoCreated?: (repoUrl: string, cloneUrl: string) => void;
  /** Callback to trigger a push via agent */
  onPushClick?: () => void;
  className?: string;
  variant?: 'default' | 'compact';
  /** Whether a generation/build is currently running */
  isGenerating?: boolean;
}

/**
 * GitHub integration button that shows either:
 * - "Setup GitHub" button when not connected (creates repo via API, then triggers code push)
 * - GitHub dropdown with repo info when connected
 */
export function GitHubButton({
  projectId,
  projectSlug,
  onRepoCreated,
  onPushClick,
  className,
  variant = 'default',
  isGenerating = false,
}: GitHubButtonProps) {
  const { data: status, isLoading, refetch } = useGitHubStatus(projectId);
  const { data: githubConnection, isLoading: isLoadingConnection, refetch: refetchConnection } = useGitHubConnection();
  const createRepoMutation = useCreateGitHubRepo(projectId);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessingPending, setIsProcessingPending] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasProcessedUrlParams = useRef(false);

  // Function to create repo - extracted so it can be called from pending flow
  const createRepo = useCallback(async (visibility: RepoVisibility) => {
    setError(null);
    setShowDropdown(false);
    
    try {
      const result = await createRepoMutation.mutateAsync({ visibility });
      
      if (result.needsReauth) {
        // Redirect to GitHub OAuth
        redirectToGitHubOAuth(visibility);
        return;
      }

      if (result.success && result.url && result.cloneUrl) {
        // Repo created successfully - trigger skill to push code
        onRepoCreated?.(result.url, result.cloneUrl);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      console.error('Failed to create GitHub repo:', err);
      setError(err instanceof Error ? err.message : 'Failed to create repository');
    }
  }, [createRepoMutation, onRepoCreated]);

  // Redirect to GitHub OAuth connect endpoint
  const redirectToGitHubOAuth = useCallback((visibility: RepoVisibility) => {
    const connectUrl = new URL('/api/auth/github/connect', window.location.origin);
    connectUrl.searchParams.set('returnUrl', window.location.pathname);
    connectUrl.searchParams.set('visibility', visibility);
    connectUrl.searchParams.set('projectId', projectId);
    window.location.href = connectUrl.toString();
  }, [projectId]);

  // Complete GitHub connection after OAuth callback
  const completeGitHubConnection = useCallback(async (): Promise<{ projectId?: string; visibility?: string } | null> => {
    try {
      const response = await fetch('/api/auth/github/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete GitHub connection');
      }
      
      const data = await response.json();
      return data.pendingAction || null;
    } catch (err) {
      console.error('Failed to complete GitHub connection:', err);
      throw err;
    }
  }, []);

  // Check URL params for pending GitHub action (after OAuth callback)
  useEffect(() => {
    if (hasProcessedUrlParams.current || isLoadingConnection) {
      return;
    }

    // New flow: github_connect_pending is set when returning from better-auth OAuth
    const githubConnectPending = searchParams.get('github_connect_pending');
    const pendingProjectIdFromUrl = searchParams.get('projectId');
    const pendingVisibilityFromUrl = searchParams.get('visibility') as RepoVisibility | null;
    const githubError = searchParams.get('github_error');

    // Handle errors from OAuth
    if (githubError) {
      hasProcessedUrlParams.current = true;
      setError(`GitHub connection failed: ${githubError}`);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('github_error');
      window.history.replaceState({}, '', url.toString());
      return;
    }

    // Handle successful OAuth return - complete the connection
    if (githubConnectPending === 'true' && pendingProjectIdFromUrl === projectId) {
      hasProcessedUrlParams.current = true;
      
      // Clean up URL params first
      const url = new URL(window.location.href);
      url.searchParams.delete('github_connect_pending');
      url.searchParams.delete('projectId');
      url.searchParams.delete('visibility');
      window.history.replaceState({}, '', url.toString());

      // Complete the GitHub connection and get pending action
      setIsProcessingPending(true);
      
      completeGitHubConnection()
        .then((pendingAction) => {
          // Refetch connection status
          queryClient.invalidateQueries({ queryKey: ['user', 'github-connection'] });
          refetchConnection();
          
          // Use visibility from URL or from pending action (cookie)
          const visibility = pendingVisibilityFromUrl || pendingAction?.visibility as RepoVisibility;
          
          if (visibility) {
            // Small delay to let the query refetch
            setTimeout(() => {
              createRepo(visibility).finally(() => {
                setIsProcessingPending(false);
              });
            }, 500);
          } else {
            setIsProcessingPending(false);
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to connect GitHub');
          setIsProcessingPending(false);
        });
    }
  }, [searchParams, projectId, isLoadingConnection, queryClient, createRepo, completeGitHubConnection, refetchConnection]);

  // Track if we were generating and now stopped - trigger a refetch
  const wasGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      // Generation just completed - refetch GitHub status
      refetch();
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, refetch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleButtonClick = () => {
    if (!createRepoMutation.isPending && !isGenerating && !isProcessingPending) {
      setShowDropdown(!showDropdown);
      setError(null);
    }
  };

  const handleVisibilitySelect = async (visibility: RepoVisibility) => {
    setError(null);
    setShowDropdown(false);
    
    // Check if user has GitHub connected with repo permissions
    if (!githubConnection?.connected || githubConnection.needsReauth || !githubConnection.hasRepoScope) {
      // Redirect directly to GitHub OAuth - skip the intermediate prompt
      redirectToGitHubOAuth(visibility);
      return;
    }

    // User has GitHub connected - create the repo via API
    await createRepo(visibility);
  };

  if (isLoading || isLoadingConnection) {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400',
        className
      )}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {variant === 'default' && <span>Loading...</span>}
      </div>
    );
  }

  // If connected, show the dropdown
  if (status?.isConnected) {
    return (
      <GitHubDropdown
        projectId={projectId}
        status={status}
        className={className}
        variant={variant}
        onPushClick={onPushClick}
        isGenerating={isGenerating}
      />
    );
  }

  const isRunning = createRepoMutation.isPending || isProcessingPending;

  // Not connected - show setup button with dropdown
  return (
    <div className="relative" ref={dropdownRef}>
      <motion.button
        onClick={handleButtonClick}
        disabled={isRunning}
        whileHover={isRunning ? {} : { scale: 1.02 }}
        whileTap={isRunning ? {} : { scale: 0.98 }}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
          isRunning 
            ? 'bg-purple-900/30 border border-purple-700/50 text-purple-400'
            : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white',
          'disabled:cursor-not-allowed',
          className
        )}
      >
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Github className="w-3.5 h-3.5" />
        )}
        {variant === 'default' && (
          <>
            <span>{isRunning ? 'Creating...' : 'Setup GitHub'}</span>
            {!isRunning && <ChevronDown className="w-3 h-3 opacity-60" />}
          </>
        )}
      </motion.button>

      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-red-900/90 border border-red-700 rounded-lg p-3 shadow-xl"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-200">{error}</div>
            </div>
            <button 
              onClick={() => setError(null)}
              className="mt-2 text-xs text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Visibility dropdown */}
      <AnimatePresence>
        {showDropdown && !isRunning && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
          >
            <div className="py-1">
              <button
                onClick={() => handleVisibilitySelect('public')}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                <Globe className="w-4 h-4 text-green-500" />
                <div className="text-left">
                  <div className="font-medium">Public</div>
                  <div className="text-xs text-gray-500">Anyone can see this repository</div>
                </div>
              </button>
              <button
                onClick={() => handleVisibilitySelect('private')}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                <Lock className="w-4 h-4 text-yellow-500" />
                <div className="text-left">
                  <div className="font-medium">Private</div>
                  <div className="text-xs text-gray-500">Only you can see this repository</div>
                </div>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Get the chat message to trigger GitHub code push
 * This is used AFTER the repo is created via API
 */
export function getGitHubPushMessage(repoUrl: string, cloneUrl: string): string {
  return `Push all project code to GitHub using the github-setup skill. The repository has already been created at: ${repoUrl}

Repository URL: ${repoUrl}
Clone URL: ${cloneUrl}

Initialize git if needed, create an initial commit with all project files, add the remote origin, and push to the repository.`;
}

/**
 * Get the chat message to trigger GitHub push for subsequent pushes
 */
export function getGitHubSyncMessage(commitMessage?: string): string {
  const message = commitMessage || 'Update from Hatchway';
  return `Stage all current changes with git add, commit with message "${message}", and push to the remote repository.`;
}
