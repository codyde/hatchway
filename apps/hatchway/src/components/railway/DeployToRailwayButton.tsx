'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ExternalLink, CheckCircle2, XCircle, RefreshCw, Settings, Github, X, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRailwayConnection, useProjectRailwayStatus, useDeployToRailway, useDisconnectRailwayDeployment } from '@/queries/railway';
import { useGitHubStatus } from '@/queries/github';
import { RailwayLogo } from './RailwayLogo';
import { RailwaySettingsModal } from './RailwaySettingsModal';

interface DeployToRailwayButtonProps {
  projectId: string;
  className?: string;
  onDeployStart?: () => void;
  onDeployComplete?: (url: string) => void;
  onDeployError?: (error: string) => void;
}

/**
 * Button to deploy a project to Railway
 * Shows different states based on deployment status
 * Prompts for GitHub URL if not connected via integration
 */
export function DeployToRailwayButton({
  projectId,
  className,
  onDeployStart,
  onDeployComplete,
  onDeployError,
}: DeployToRailwayButtonProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [showGitHubPrompt, setShowGitHubPrompt] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  const [githubBranch, setGithubBranch] = useState('main');
  
  // Hover menu state
  const [isHovering, setIsHovering] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const { isConfigured, isConnected, isLoading: connectionLoading } = useRailwayConnection();
  const { data: deploymentStatus, isLoading: statusLoading } = useProjectRailwayStatus(projectId);
  const { data: githubStatus, isLoading: githubLoading } = useGitHubStatus(projectId);
  const deployMutation = useDeployToRailway(projectId);
  const disconnectMutation = useDisconnectRailwayDeployment(projectId);
  
  // Handle hover with delay
  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, 500); // 0.5s delay
  };
  
  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    // Small delay before hiding to allow moving to menu
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(false);
    }, 150);
  };
  
  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleConnect = () => {
    window.location.href = '/api/auth/railway?redirectTo=' + encodeURIComponent(window.location.pathname);
  };

  const handleDeployClick = () => {
    // If GitHub is connected via integration, deploy directly
    if (githubStatus?.isConnected && githubStatus?.repo) {
      handleDeploy();
    } else {
      // Otherwise, show the GitHub URL prompt
      setShowGitHubPrompt(true);
    }
  };

  const handleDeploy = async (overrideGithubRepo?: string, overrideGithubBranch?: string) => {
    try {
      onDeployStart?.();
      const result = await deployMutation.mutateAsync({
        githubRepo: overrideGithubRepo,
        githubBranch: overrideGithubBranch,
      });
      onDeployComplete?.(result.deployment.url);
      setShowGitHubPrompt(false);
      setGithubUrl('');
    } catch (error) {
      onDeployError?.(error instanceof Error ? error.message : 'Deployment failed');
    }
  };

  const handleGitHubSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrl.trim()) return;
    
    // Parse GitHub URL to get owner/repo format
    const repoFullName = parseGitHubUrl(githubUrl.trim());
    if (!repoFullName) {
      onDeployError?.('Invalid GitHub URL. Please enter a valid GitHub repository URL.');
      return;
    }
    
    handleDeploy(repoFullName, githubBranch || 'main');
  };

  const handleDisconnect = async (deleteRailwayProject: boolean = false) => {
    setShowOptions(false);
    await disconnectMutation.mutateAsync(deleteRailwayProject);
  };

  const isLoading = connectionLoading || statusLoading || githubLoading;
  const isDeploying = deployMutation.isPending || deploymentStatus?.status === 'deploying';
  const isDeployed = deploymentStatus?.isDeployed && deploymentStatus.status === 'deployed';
  const isFailed = deploymentStatus?.status === 'failed';

  // Not configured - hide button
  if (!isConfigured) {
    return null;
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 rounded-md bg-gray-800/50',
        className
      )}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  // Not connected to Railway - show connect button
  if (!isConnected) {
    return (
      <motion.button
        onClick={handleConnect}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
          'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white',
          className
        )}
      >
        <RailwayLogo width={14} height={14} />
        <span>Connect Railway</span>
      </motion.button>
    );
  }

  // Deploying state
  if (isDeploying) {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md',
        'bg-purple-900/30 border border-purple-700/50 text-purple-300',
        className
      )}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Deploying...</span>
      </div>
    );
  }

  // Deployed state - show link with hover menu
  if (isDeployed && deploymentStatus?.url) {
    return (
      <>
        <div 
          className={cn('relative', className)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          ref={menuRef}
        >
          {/* Main button - clicking opens the URL */}
          <motion.a
            href={deploymentStatus.url}
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
              'bg-green-600/20 hover:bg-green-600/30 border border-green-600/50 text-green-400'
            )}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Live on Railway</span>
            <ExternalLink className="w-3 h-3" />
          </motion.a>

          {/* Hover menu */}
          <AnimatePresence>
            {isHovering && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50"
              >
                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setShowSettingsModal(true);
                      setIsHovering(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 rounded-md transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleDeployClick();
                      setIsHovering(false);
                    }}
                    disabled={deployMutation.isPending}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 rounded-md transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn('w-4 h-4', deployMutation.isPending && 'animate-spin')} />
                    Redeploy
                  </button>
                  <div className="border-t border-gray-700 my-1" />
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setShowOptions(true);
                      setIsHovering(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-900/30 rounded-md transition-colors"
                  >
                    <Unplug className="w-4 h-4" />
                    Disconnect
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Disconnect confirmation dropdown */}
          <AnimatePresence>
            {showOptions && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute left-0 top-full mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50"
              >
                <div className="p-2 space-y-1">
                  <p className="px-3 py-2 text-xs text-gray-400">Choose an option:</p>
                  <button
                    onClick={() => handleDisconnect(false)}
                    disabled={disconnectMutation.isPending}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 rounded-md transition-colors"
                  >
                    Disconnect (keep Railway project)
                  </button>
                  <button
                    onClick={() => handleDisconnect(true)}
                    disabled={disconnectMutation.isPending}
                    className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/30 rounded-md transition-colors"
                  >
                    Delete Railway project
                  </button>
                  <button
                    onClick={() => setShowOptions(false)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-700/50 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Settings Modal */}
        <RailwaySettingsModal
          projectId={projectId}
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
        />
      </>
    );
  }

  // Failed state
  if (isFailed) {
    return (
      <div className="flex items-center gap-1.5">
        <div className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md',
          'bg-red-900/30 border border-red-700/50 text-red-400',
          className
        )}>
          <XCircle className="w-3.5 h-3.5" />
          <span>Deploy Failed</span>
        </div>
        <motion.button
          onClick={() => handleDeployClick()}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={deployMutation.isPending}
          className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-700/50 transition-colors"
          title="Retry deployment"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', deployMutation.isPending && 'animate-spin')} />
        </motion.button>
      </div>
    );
  }

  // Default - ready to deploy
  return (
    <>
      <motion.button
        onClick={handleDeployClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        disabled={deployMutation.isPending}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
          'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white',
          deployMutation.isPending && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        {deployMutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RailwayLogo width={14} height={14} />
        )}
        <span>Deploy to Railway</span>
      </motion.button>

      {/* GitHub URL Prompt Modal */}
      <AnimatePresence>
        {showGitHubPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowGitHubPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-600/20 rounded-lg">
                    <Github className="w-5 h-5 text-purple-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">GitHub Repository</h3>
                </div>
                <button
                  onClick={() => setShowGitHubPrompt(false)}
                  className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-gray-400 mb-4">
                Railway deploys from a GitHub repository. Enter the URL of your public repo to deploy.
              </p>

              <form onSubmit={handleGitHubSubmit} className="space-y-4">
                <div>
                  <label htmlFor="github-url" className="block text-sm font-medium text-gray-300 mb-1">
                    Repository URL
                  </label>
                  <input
                    id="github-url"
                    type="text"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="github-branch" className="block text-sm font-medium text-gray-300 mb-1">
                    Branch
                  </label>
                  <input
                    id="github-branch"
                    type="text"
                    value={githubBranch}
                    onChange={(e) => setGithubBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowGitHubPrompt(false)}
                    className="flex-1 px-4 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!githubUrl.trim() || deployMutation.isPending}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg transition-all',
                      'bg-purple-600 hover:bg-purple-500 text-white',
                      (!githubUrl.trim() || deployMutation.isPending) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {deployMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RailwayLogo width={16} height={16} />
                    )}
                    Deploy
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Parse a GitHub URL and return the owner/repo format
 * Supports various URL formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - owner/repo
 */
function parseGitHubUrl(url: string): string | null {
  // Already in owner/repo format
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(url)) {
    return url;
  }

  // HTTPS URL
  const httpsMatch = url.match(/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/|$)/);
  if (httpsMatch) {
    return httpsMatch[1];
  }

  // SSH URL
  const sshMatch = url.match(/git@github\.com:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  return null;
}
