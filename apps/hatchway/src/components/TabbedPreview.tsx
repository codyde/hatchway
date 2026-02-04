'use client';

import { useEffect, forwardRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Monitor, Code, Terminal, MousePointer2, RefreshCw, Copy, Check, Smartphone, Tablet, Cloud, ExternalLink, Play, Square } from 'lucide-react';
import PreviewPanel from './PreviewPanel';
import EditorTab from './EditorTab';
import TerminalOutput from './TerminalOutput';
import { cn } from '@/lib/utils';
import { useProjects } from '@/contexts/ProjectContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

interface TabbedPreviewProps {
  selectedProject?: string | null;
  projectId?: string | null;
  onStartServer?: () => void;
  onStopServer?: () => void;
  onStartTunnel?: () => void;
  onStopTunnel?: () => void;
  isStartingServer?: boolean;
  isStoppingServer?: boolean;
  isStartingTunnel?: boolean;
  isStoppingTunnel?: boolean;
  isBuildActive?: boolean;
  onPortDetected?: (port: number) => void;
  devicePreset?: 'desktop' | 'tablet' | 'mobile';
  onDevicePresetChange?: (preset: 'desktop' | 'tablet' | 'mobile') => void;
  activeTab?: 'preview' | 'editor' | 'terminal';
  onTabChange?: (tab: 'preview' | 'editor' | 'terminal') => void;
  isSelectionModeEnabled?: boolean;
  onSelectionModeChange?: (enabled: boolean) => void;
}

const TabbedPreview = forwardRef<HTMLDivElement, TabbedPreviewProps>(({
  selectedProject,
  projectId,
  onStartServer,
  onStopServer,
  onStartTunnel,
  onStopTunnel,
  isStartingServer,
  isStoppingServer,
  isStartingTunnel,
  isStoppingTunnel,
  isBuildActive,
  onPortDetected,
  devicePreset: externalDevicePreset,
  onDevicePresetChange,
  activeTab: externalActiveTab,
  onTabChange,
  isSelectionModeEnabled: externalSelectionMode,
  onSelectionModeChange,
}, ref) => {
  // Internal state fallbacks
  const [internalActiveTab, setInternalActiveTab] = useState<'preview' | 'editor' | 'terminal'>('preview');
  const [internalDevicePreset, setInternalDevicePreset] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [internalSelectionMode, setInternalSelectionMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use external or internal state
  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;
  const devicePreset = externalDevicePreset ?? internalDevicePreset;
  const setDevicePreset = onDevicePresetChange ?? setInternalDevicePreset;
  const isSelectionMode = externalSelectionMode ?? internalSelectionMode;
  const setIsSelectionMode = onSelectionModeChange ?? setInternalSelectionMode;

  const { projects } = useProjects();
  const currentProject = projects.find(p => p.slug === selectedProject);
  const actualPort = currentProject?.devServerPort;
  const previewUrl = currentProject?.tunnelUrl || (actualPort ? `http://localhost:${actualPort}` : null);
  const isServerRunning = currentProject?.devServerStatus === 'running';

  // Listen for global events to switch tabs
  useEffect(() => {
    const handleSwitchToEditor = () => setActiveTab('editor');
    const handleSwitchToPreview = () => setActiveTab('preview');
    const handleSwitchToTerminal = () => setActiveTab('terminal');

    window.addEventListener('switch-to-editor', handleSwitchToEditor);
    window.addEventListener('switch-to-preview', handleSwitchToPreview);
    window.addEventListener('switch-to-terminal', handleSwitchToTerminal);

    return () => {
      window.removeEventListener('switch-to-editor', handleSwitchToEditor);
      window.removeEventListener('switch-to-preview', handleSwitchToPreview);
      window.removeEventListener('switch-to-terminal', handleSwitchToTerminal);
    };
  }, [setActiveTab]);

  const handleCopyUrl = useCallback(() => {
    if (previewUrl) {
      navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [previewUrl]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent('refresh-preview'));
    setTimeout(() => setIsRefreshing(false), 500);
  }, []);

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="h-full flex flex-col bg-card/50 backdrop-blur-md border border-border rounded-xl shadow-xl overflow-hidden"
      >
        {/* Header Bar */}
        <div className="flex items-center px-3 py-2 gap-2">
          {/* Tab Switcher */}
          <div className="flex items-center bg-muted/50 rounded-md p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab('preview')}
                  className={cn(
                    'p-1.5 rounded transition-all',
                    activeTab === 'preview'
                      ? 'bg-theme-primary-muted text-theme-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  <Monitor className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Preview</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab('editor')}
                  className={cn(
                    'p-1.5 rounded transition-all',
                    activeTab === 'editor'
                      ? 'bg-theme-primary-muted text-theme-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  <Code className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Editor</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab('terminal')}
                  className={cn(
                    'p-1.5 rounded transition-all',
                    activeTab === 'terminal'
                      ? 'bg-theme-primary-muted text-theme-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  <Terminal className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Terminal</TooltipContent>
            </Tooltip>
          </div>

          {/* Divider + Selection Tool - Only when server running and preview active */}
          {isServerRunning && activeTab === 'preview' && (
            <>
              <div className="w-px h-5 bg-border mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIsSelectionMode(!isSelectionMode)}
                    className={cn(
                      'p-1.5 rounded-md transition-all',
                      isSelectionMode
                        ? 'bg-theme-primary-muted text-theme-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    <MousePointer2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Select Element</TooltipContent>
              </Tooltip>
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Center: Refresh + URL Bar + Device Presets */}
          {isServerRunning && activeTab === 'preview' && previewUrl && (
            <div className="flex items-center gap-2">
              {/* Refresh */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh</TooltipContent>
              </Tooltip>

              {/* URL Bar */}
              <HoverCard openDelay={200}>
                <HoverCardTrigger asChild>
                  <div className="flex items-center gap-2 px-3 py-1 bg-muted/50 border border-border rounded-md hover:border-border transition-colors cursor-default max-w-[300px]">
                    <div className={cn(
                      'w-2 h-2 rounded-full shadow-lg flex-shrink-0',
                      currentProject?.tunnelUrl
                        ? 'bg-blue-400 shadow-blue-400/50'
                        : 'bg-[#92DD00] shadow-[#92DD00]/50'
                    )} />
                    <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                      {previewUrl}
                    </span>
                    <button
                      onClick={handleCopyUrl}
                      className="p-0.5 rounded hover:bg-accent transition-colors flex-shrink-0"
                    >
                      {copied ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto max-w-xl bg-popover border-border" side="bottom">
                  <p className="text-xs font-mono text-popover-foreground break-all">{previewUrl}</p>
                </HoverCardContent>
              </HoverCard>

              {/* Device Presets */}
              <div className="flex items-center bg-muted/50 rounded-md p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setDevicePreset('desktop')}
                      className={cn(
                        'p-1.5 rounded transition-all',
                        devicePreset === 'desktop'
                          ? 'bg-theme-primary-muted text-theme-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      )}
                    >
                      <Monitor className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Desktop</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setDevicePreset('tablet')}
                      className={cn(
                        'p-1.5 rounded transition-all',
                        devicePreset === 'tablet'
                          ? 'bg-theme-primary-muted text-theme-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      )}
                    >
                      <Tablet className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Tablet</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setDevicePreset('mobile')}
                      className={cn(
                        'p-1.5 rounded transition-all',
                        devicePreset === 'mobile'
                          ? 'bg-theme-primary-muted text-theme-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      )}
                    >
                      <Smartphone className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Mobile</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right: External links */}
          {isServerRunning && previewUrl && (
            <>
              <div className="w-px h-5 bg-border mx-1" />
              <div className="flex items-center gap-1">
                {/* Cloud/Tunnel link */}
                {currentProject?.tunnelUrl && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => window.open(currentProject.tunnelUrl!, '_blank')}
                        className="p-1.5 rounded-md text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 transition-all"
                      >
                        <Cloud className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Open Tunnel URL</TooltipContent>
                  </Tooltip>
                )}
                {/* Localhost link */}
                {actualPort && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => window.open(`http://localhost:${actualPort}`, '_blank')}
                        className="p-1.5 rounded-md text-green-400 hover:text-green-300 hover:bg-green-500/20 transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Open Localhost</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </>
          )}

          {/* Server/Tunnel Controls */}
          {currentProject?.runCommand && currentProject?.status === 'completed' && !isBuildActive && (
            <>
              <div className="w-px h-5 bg-border mx-1" />
              <div className="flex items-center gap-1">
                {isServerRunning ? (
                  <>
                    {/* Tunnel toggle */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {currentProject.tunnelUrl ? (
                          <button
                            onClick={onStopTunnel}
                            disabled={isStoppingTunnel}
                            className="p-1.5 rounded-md text-orange-400 hover:text-orange-300 hover:bg-orange-500/20 transition-all disabled:opacity-50"
                          >
                            <Cloud className={cn('w-4 h-4', isStoppingTunnel && 'animate-pulse')} />
                          </button>
                        ) : (
                          <button
                            onClick={onStartTunnel}
                            disabled={isStartingTunnel}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-blue-500 hover:bg-blue-500/20 transition-all disabled:opacity-50"
                          >
                            <Cloud className={cn('w-4 h-4', isStartingTunnel && 'animate-pulse')} />
                          </button>
                        )}
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {currentProject.tunnelUrl ? 'Stop Tunnel' : 'Start Tunnel'}
                      </TooltipContent>
                    </Tooltip>
                    {/* Stop Server */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={onStopServer}
                          disabled={isStoppingServer}
                          className="p-1.5 rounded-md text-[#FF45A8] hover:text-[#FF70BC] hover:bg-[#FF45A8]/20 transition-all disabled:opacity-50"
                        >
                          <Square className={cn('w-4 h-4', isStoppingServer && 'animate-pulse')} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Stop Server</TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onStartServer}
                        disabled={currentProject.devServerStatus === 'starting' || isStartingServer}
                        className="p-1.5 rounded-md text-[#92DD00] hover:text-[#A8F000] hover:bg-[#92DD00]/20 transition-all disabled:opacity-50"
                      >
                        <Play className={cn('w-4 h-4', isStartingServer && 'animate-pulse')} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Start Server</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </>
          )}
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === 'preview' && (
            <PreviewPanel
              selectedProject={selectedProject}
              onStartServer={onStartServer}
              onStopServer={onStopServer}
              onStartTunnel={onStartTunnel}
              onStopTunnel={onStopTunnel}
              isStartingServer={isStartingServer}
              isStoppingServer={isStoppingServer}
              isStartingTunnel={isStartingTunnel}
              isStoppingTunnel={isStoppingTunnel}
              isBuildActive={isBuildActive}
              devicePreset={devicePreset}
              hideControls={true}
              isSelectionModeEnabled={isSelectionMode}
              onSelectionModeChange={setIsSelectionMode}
            />
          )}
          {activeTab === 'editor' && (
            <EditorTab projectId={projectId} />
          )}
          {activeTab === 'terminal' && (
            <div className="h-full">
              <TerminalOutput
                projectId={projectId}
                onPortDetected={onPortDetected}
              />
            </div>
          )}
        </div>
      </motion.div>
    </TooltipProvider>
  );
});

TabbedPreview.displayName = 'TabbedPreview';

export default TabbedPreview;
