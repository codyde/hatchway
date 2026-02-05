'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { 
  Train, 
  Loader2, 
  Check, 
  AlertCircle, 
  ExternalLink,
  ChevronDown,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRailwayConnection, useDisconnectRailway, useSetDefaultWorkspace } from '@/queries/railway';
import type { RailwayWorkspace } from '@/lib/railway/types';

interface RailwayConnectionCardProps {
  className?: string;
}

/**
 * Card component for managing Railway integration connection
 * Shows connection status and allows connecting/disconnecting
 */
export function RailwayConnectionCard({ className }: RailwayConnectionCardProps) {
  const { isConfigured, isConnected, status, isLoading, refetch } = useRailwayConnection();
  const disconnectMutation = useDisconnectRailway();
  const { setDefaultWorkspace, isLoading: isSettingWorkspace } = useSetDefaultWorkspace();
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = React.useState(false);

  const handleConnect = () => {
    // Navigate to Railway OAuth flow
    window.location.href = '/api/auth/railway?redirectTo=' + encodeURIComponent(window.location.pathname);
  };

  const handleDisconnect = async () => {
    if (confirm('Are you sure you want to disconnect Railway?')) {
      await disconnectMutation.mutateAsync();
    }
  };

  const handleWorkspaceSelect = async (workspace: RailwayWorkspace) => {
    await setDefaultWorkspace(workspace);
    setShowWorkspaceDropdown(false);
  };

  // Not configured - show disabled state
  if (!isConfigured) {
    return (
      <div className={cn(
        'p-4 rounded-lg border border-gray-800 bg-gray-900/50',
        className
      )}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gray-800">
            <Train className="w-5 h-5 text-gray-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-gray-400">Railway</h3>
            <p className="text-xs text-gray-500">Not configured</p>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={cn(
        'p-4 rounded-lg border border-gray-800 bg-gray-900/50',
        className
      )}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gray-800">
            <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-gray-300">Railway</h3>
            <p className="text-xs text-gray-500">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Connected state
  if (isConnected && status) {
    return (
      <div className={cn(
        'p-4 rounded-lg border border-gray-800 bg-gray-900/50',
        className
      )}>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-purple-900/30">
            <Train className="w-5 h-5 text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-white">Railway</h3>
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-green-900/30 text-green-400 rounded">
                <Check className="w-3 h-3" />
                Connected
              </span>
            </div>
            
            {/* User info */}
            <p className="text-xs text-gray-400 mt-1 truncate">
              {status.railwayEmail || status.railwayName || 'Connected'}
            </p>
            
            {/* Workspace selector */}
            {status.grantedWorkspaces && status.grantedWorkspaces.length > 0 && (
              <div className="mt-3 relative">
                <label className="text-xs text-gray-500 block mb-1">Default Workspace</label>
                <button
                  onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}
                  disabled={isSettingWorkspace}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-md transition-colors disabled:opacity-50"
                >
                  <span className="truncate">
                    {status.defaultWorkspace?.name || 'Select workspace...'}
                  </span>
                  {isSettingWorkspace ? (
                    <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>
                
                {/* Workspace dropdown */}
                {showWorkspaceDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                    {status.grantedWorkspaces.map((workspace) => (
                      <button
                        key={workspace.id}
                        onClick={() => handleWorkspaceSelect(workspace)}
                        className={cn(
                          'w-full px-3 py-2 text-sm text-left hover:bg-gray-800 transition-colors',
                          workspace.id === status.defaultWorkspace?.id
                            ? 'text-purple-400 bg-purple-900/20'
                            : 'text-gray-300'
                        )}
                      >
                        {workspace.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Actions */}
            <div className="flex items-center gap-2 mt-3">
              <a
                href="https://railway.app/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Dashboard
              </a>
              <button
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <LogOut className="w-3 h-3" />
                )}
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Expired state
  if (status?.status === 'expired') {
    return (
      <div className={cn(
        'p-4 rounded-lg border border-yellow-900/50 bg-yellow-900/10',
        className
      )}>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-yellow-900/30">
            <AlertCircle className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-yellow-400">Railway Session Expired</h3>
            <p className="text-xs text-gray-400 mt-1">
              Your Railway session has expired. Please reconnect to continue deploying.
            </p>
            <motion.button
              onClick={handleConnect}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="mt-3 px-4 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-md transition-colors"
            >
              Reconnect Railway
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  // Not connected - show connect button
  return (
    <div className={cn(
      'p-4 rounded-lg border border-gray-800 bg-gray-900/50',
      className
    )}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-gray-800">
          <Train className="w-5 h-5 text-gray-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-300">Railway</h3>
          <p className="text-xs text-gray-500 mt-1">
            Connect your Railway account to deploy your apps with one click.
          </p>
          <motion.button
            onClick={handleConnect}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="mt-3 px-4 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-md transition-colors"
          >
            Connect Railway
          </motion.button>
        </div>
      </div>
    </div>
  );
}
