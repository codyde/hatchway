'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, Play, Square, Copy, Check, Monitor, Smartphone, Tablet, ExternalLink } from 'lucide-react';
import { useProjects } from '@/contexts/ProjectContext';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

interface PreviewControlsProps {
  selectedProject?: string | null;
  onStartServer?: () => void;
  onStopServer?: () => void;
  isStartingServer?: boolean;
  isStoppingServer?: boolean;
  isBuildActive?: boolean;
  onRefresh?: () => void;
  devicePreset?: 'desktop' | 'tablet' | 'mobile';
  onDevicePresetChange?: (preset: 'desktop' | 'tablet' | 'mobile') => void;
  verifiedTunnelUrl?: string | null;
  actualPort?: number | null;
  className?: string;
}

export function PreviewControls({
  selectedProject,
  onStartServer,
  onStopServer,
  isStartingServer,
  isStoppingServer,
  isBuildActive,
  onRefresh,
  devicePreset = 'desktop',
  onDevicePresetChange,
  verifiedTunnelUrl,
  actualPort,
  className,
}: PreviewControlsProps) {
  const { projects } = useProjects();
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const currentProject = projects.find(p => p.slug === selectedProject);
  const isSandboxProject = (currentProject?.executionMode ?? 'sandbox') === 'sandbox';
  const previewUrl = verifiedTunnelUrl || currentProject?.tunnelUrl || (actualPort && !isSandboxProject ? `http://localhost:${actualPort}` : null);

  const handleCopyUrl = useCallback(() => {
    if (previewUrl) {
      navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [previewUrl]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => setIsRefreshing(false), 500);
  }, [onRefresh]);

  // Don't render anything if no project is selected
  if (!selectedProject || !currentProject) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Refresh button */}
      {previewUrl && (
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-md hover:bg-white/10 transition-all duration-200 disabled:opacity-50"
          title="Refresh preview"
        >
          <RefreshCw className={cn('w-4 h-4 text-gray-400', isRefreshing && 'animate-spin')} />
        </button>
      )}

      {/* URL bar */}
      {previewUrl && (
        <HoverCard openDelay={200}>
          <HoverCardTrigger asChild>
            <div className="flex items-center gap-2 px-3 py-1 bg-black/30 border border-white/10 rounded-md hover:border-white/20 transition-colors cursor-default max-w-[300px]">
              <div className={cn(
                'w-2 h-2 rounded-full shadow-lg flex-shrink-0',
                verifiedTunnelUrl || currentProject?.tunnelUrl
                  ? 'bg-blue-400 shadow-blue-400/50'
                  : 'bg-[#92DD00] shadow-[#92DD00]/50'
              )} />
              <span className="text-xs font-mono text-gray-300 truncate flex-1">
                {previewUrl}
              </span>
              <button
                onClick={handleCopyUrl}
                className="p-1 rounded hover:bg-white/10 transition-colors flex-shrink-0"
                title="Copy URL"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-green-400" />
                ) : (
                  <Copy className="w-3 h-3 text-gray-400" />
                )}
              </button>
            </div>
          </HoverCardTrigger>
          <HoverCardContent className="w-auto max-w-xl bg-gray-900 border-white/20" side="bottom">
            <p className="text-xs font-mono text-gray-300 break-all">
              {previewUrl}
            </p>
          </HoverCardContent>
        </HoverCard>
      )}

      {/* Device presets */}
      {previewUrl && (
        <div className="flex items-center gap-0.5 bg-black/30 border border-white/10 rounded-md p-0.5">
          <button
            onClick={() => onDevicePresetChange?.('desktop')}
            className={cn(
              'p-1 rounded transition-all',
              devicePreset === 'desktop'
                ? 'bg-[#7553FF]/20 text-[#7553FF]'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            )}
            title="Desktop view"
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDevicePresetChange?.('tablet')}
            className={cn(
              'p-1 rounded transition-all',
              devicePreset === 'tablet'
                ? 'bg-[#7553FF]/20 text-[#7553FF]'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            )}
            title="Tablet view"
          >
            <Tablet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDevicePresetChange?.('mobile')}
            className={cn(
              'p-1 rounded transition-all',
              devicePreset === 'mobile'
                ? 'bg-[#7553FF]/20 text-[#7553FF]'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            )}
            title="Mobile view"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Open in new tab buttons */}
      {previewUrl && (
        <div className="flex items-center gap-1">
          {(verifiedTunnelUrl || currentProject?.tunnelUrl) && (
            <button
              onClick={() => window.open(verifiedTunnelUrl || currentProject?.tunnelUrl || '', '_blank')}
              className="p-1.5 rounded-md hover:bg-blue-500/20 transition-all duration-200 group"
              title="Open preview URL in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-300" />
            </button>
          )}
          {actualPort && !isSandboxProject && (
            <button
              onClick={() => window.open(`http://localhost:${actualPort}`, '_blank')}
              className="p-1.5 rounded-md hover:bg-green-500/20 transition-all duration-200 group"
              title="Open localhost in new tab"
            >
              <Monitor className="w-3.5 h-3.5 text-green-400 group-hover:text-green-300" />
            </button>
          )}
        </div>
      )}

      {/* Server controls - divider */}
      {currentProject?.runCommand && currentProject?.status === 'completed' && !isBuildActive && previewUrl && (
        <div className="w-px h-5 bg-white/10 mx-1" />
      )}

      {/* Server controls */}
      {currentProject?.runCommand && currentProject?.status === 'completed' && !isBuildActive && (
        <>
          {currentProject.devServerStatus === 'running' ? (
            <button
              onClick={onStopServer}
              disabled={isStoppingServer}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[#FF45A8]/20 hover:bg-[#FF45A8]/30 text-[#FF45A8] border border-[#FF45A8]/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Stop server"
            >
              <Square className={cn('w-3 h-3', isStoppingServer && 'animate-pulse')} />
              {isStoppingServer ? 'Stopping...' : 'Stop'}
            </button>
          ) : (
            <button
              onClick={onStartServer}
              disabled={currentProject.devServerStatus === 'starting' || isStartingServer}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[#92DD00]/20 hover:bg-[#92DD00]/30 text-[#92DD00] border border-[#92DD00]/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Start server"
            >
              <Play className={cn('w-3 h-3', isStartingServer && 'animate-pulse')} />
              {currentProject.devServerStatus === 'starting' || isStartingServer ? 'Starting...' : 'Start'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
