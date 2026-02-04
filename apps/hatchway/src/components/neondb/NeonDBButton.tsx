'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Database, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNeonDBStatus } from '@/queries/neondb';
import { NeonDBDropdown } from './NeonDBDropdown';

interface NeonDBButtonProps {
  projectId: string;
  onSetupClick?: () => void;
  className?: string;
  variant?: 'default' | 'compact';
  isGenerating?: boolean;
}

/**
 * NeonDB integration button that shows either:
 * - "Setup Database" button when not connected (triggers chat flow)
 * - Database dropdown with info when connected
 */
export function NeonDBButton({
  projectId,
  onSetupClick,
  className,
  variant = 'default',
  isGenerating = false,
}: NeonDBButtonProps) {
  const { data: status, isLoading, refetch } = useNeonDBStatus(projectId);
  const [isSettingUp, setIsSettingUp] = useState(false);

  // Refetch when generation completes
  const wasGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      refetch();
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, refetch]);

  const handleSetupClick = () => {
    setIsSettingUp(true);
    onSetupClick?.();
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
      <NeonDBDropdown
        projectId={projectId}
        status={status}
        className={className}
        variant={variant}
      />
    );
  }

  // Only show "Setting up" when user explicitly clicked setup
  // Don't show it during regular generations (that was confusing)
  const isRunning = isSettingUp;

  // Not connected - show setup button
  return (
    <motion.button
      onClick={handleSetupClick}
      disabled={isRunning}
      whileHover={isRunning ? {} : { scale: 1.02 }}
      whileTap={isRunning ? {} : { scale: 0.98 }}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-all',
        isRunning 
          ? 'bg-emerald-900/30 border border-emerald-700/50 text-emerald-400'
          : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white',
        'disabled:cursor-not-allowed',
        className
      )}
    >
      {isRunning ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Database className="w-3.5 h-3.5" />
      )}
      {variant === 'default' && (
        <span>{isRunning ? 'Setting up...' : 'Add Database'}</span>
      )}
    </motion.button>
  );
}

/**
 * Get the chat message to trigger NeonDB setup
 */
export function getNeonDBSetupMessage(): string {
  return 'Configure a NeonDB PostgreSQL database for this project using the neondb-setup skill.';
}
