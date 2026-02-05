'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Train, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRailwayConnection } from '@/queries/railway';

interface ConnectRailwayButtonProps {
  className?: string;
  variant?: 'default' | 'compact';
  redirectTo?: string;
}

/**
 * Simple button to connect or show Railway status
 */
export function ConnectRailwayButton({
  className,
  variant = 'default',
  redirectTo,
}: ConnectRailwayButtonProps) {
  const { isConfigured, isConnected, status, isLoading } = useRailwayConnection();

  const handleConnect = () => {
    const redirect = redirectTo || window.location.pathname;
    window.location.href = '/api/auth/railway?redirectTo=' + encodeURIComponent(redirect);
  };

  // Not configured
  if (!isConfigured) {
    return null;
  }

  // Loading
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

  // Connected
  if (isConnected) {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md',
        'bg-purple-900/30 border border-purple-700/50 text-purple-400',
        className
      )}>
        <Train className="w-3.5 h-3.5" />
        {variant === 'default' && (
          <>
            <span>{status?.defaultWorkspace?.name || 'Railway Connected'}</span>
            <Check className="w-3 h-3" />
          </>
        )}
      </div>
    );
  }

  // Not connected - show connect button
  return (
    <motion.button
      onClick={handleConnect}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
        'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600',
        'text-gray-300 hover:text-white',
        className
      )}
    >
      <Train className="w-3.5 h-3.5" />
      {variant === 'default' && <span>Connect Railway</span>}
    </motion.button>
  );
}
