'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Github, Loader2, Globe, Lock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGitHubStatus } from '@/queries/github';
import { GitHubDropdown } from './GitHubDropdown';

export type RepoVisibility = 'public' | 'private';

// GitHub chat message - includes visibility preference
// The skill file (.claude/skills/github-setup/SKILL.md) contains the detailed instructions
function getSetupMessage(visibility: RepoVisibility): string {
  return `Set up GitHub repository for this project using the github-setup skill. Create a ${visibility} repository.`;
}

interface GitHubButtonProps {
  projectId: string;
  projectSlug: string;
  onSetupClick?: (visibility: RepoVisibility) => void;
  /** Callback to trigger a push via agent */
  onPushClick?: () => void;
  className?: string;
  variant?: 'default' | 'compact';
  /** Whether a generation/build is currently running */
  isGenerating?: boolean;
}

/**
 * GitHub integration button that shows either:
 * - "Setup GitHub" button when not connected (triggers chat flow)
 * - GitHub dropdown with repo info when connected
 */
export function GitHubButton({
  projectId,
  projectSlug,
  onSetupClick,
  onPushClick,
  className,
  variant = 'default',
  isGenerating = false,
}: GitHubButtonProps) {
  const { data: status, isLoading, refetch } = useGitHubStatus(projectId);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    if (!isSettingUp && !isGenerating) {
      setShowDropdown(!showDropdown);
    }
  };

  const handleVisibilitySelect = (visibility: RepoVisibility) => {
    setShowDropdown(false);
    setIsSettingUp(true);
    onSetupClick?.(visibility);
  };

  // Reset isSettingUp when generation completes
  useEffect(() => {
    if (!isGenerating && isSettingUp) {
      setIsSettingUp(false);
    }
  }, [isGenerating, isSettingUp]);

  if (isLoading) {
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

  // Only show "Setting up" when user explicitly clicked setup
  // Don't show it during regular generations (that was confusing)
  const isRunning = isSettingUp;

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
            <span>{isRunning ? 'Setting up...' : 'Setup GitHub'}</span>
            {!isRunning && <ChevronDown className="w-3 h-3 opacity-60" />}
          </>
        )}
      </motion.button>

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
 * Get the chat message to trigger GitHub setup
 */
export function getGitHubSetupMessage(visibility: RepoVisibility = 'public'): string {
  return getSetupMessage(visibility);
}

/**
 * Get the chat message to trigger GitHub push
 */
export function getGitHubPushMessage(commitMessage?: string): string {
  const message = commitMessage || 'Update from Hatchway';
  return `Stage all current changes with git add, commit with message "${message}", and push to the remote repository.`;
}
