'use client';

import { useEffect, forwardRef, useState, useCallback, useId, useRef, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Monitor, Code, Terminal, MousePointer2, RefreshCw, Copy, Check, Smartphone, Tablet, Cloud, ExternalLink, Play, Square, MoreHorizontal } from 'lucide-react';
import PreviewPanel from './PreviewPanel';
import EditorTab from './EditorTab';
import TerminalOutput from './TerminalOutput';
import { cn } from '@/lib/utils';
import { getProjectPreviewUrl } from '@/lib/project-preview-url';
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type PreviewTab = 'preview' | 'editor' | 'terminal';
type DevicePreset = 'desktop' | 'tablet' | 'mobile';

const previewTabs: PreviewTab[] = ['preview', 'editor', 'terminal'];
const tabDetails: Record<PreviewTab, { label: string; Icon: typeof Monitor }> = {
  preview: { label: 'Preview', Icon: Monitor },
  editor: { label: 'Editor', Icon: Code },
  terminal: { label: 'Terminal', Icon: Terminal },
};
const devicePresets: Array<{
  value: DevicePreset;
  label: string;
  Icon: typeof Monitor;
}> = [
  { value: 'desktop', label: 'Desktop', Icon: Monitor },
  { value: 'tablet', label: 'Tablet', Icon: Tablet },
  { value: 'mobile', label: 'Mobile', Icon: Smartphone },
];

const iconButtonClass = 'inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50';

interface TabbedPreviewProps {
  selectedProject?: string | null;
  projectId?: string | null;
  onStartServer?: () => void;
  onStopServer?: () => void;
  isStartingServer?: boolean;
  isStoppingServer?: boolean;
  isBuildActive?: boolean;
  onPortDetected?: (port: number) => void;
  devicePreset?: DevicePreset;
  onDevicePresetChange?: (preset: DevicePreset) => void;
  activeTab?: PreviewTab;
  onTabChange?: (tab: PreviewTab) => void;
  isSelectionModeEnabled?: boolean;
  onSelectionModeChange?: (enabled: boolean) => void;
}

const TabbedPreview = forwardRef<HTMLDivElement, TabbedPreviewProps>(({
  selectedProject,
  projectId,
  onStartServer,
  onStopServer,
  isStartingServer,
  isStoppingServer,
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
  const [internalActiveTab, setInternalActiveTab] = useState<PreviewTab>('preview');
  const [internalDevicePreset, setInternalDevicePreset] = useState<DevicePreset>('desktop');
  const [internalSelectionMode, setInternalSelectionMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const componentId = useId();
  const deviceGroupName = `${componentId}-device`;
  const tabRefs = useRef<Record<PreviewTab, HTMLButtonElement | null>>({
    preview: null,
    editor: null,
    terminal: null,
  });

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
  // Sandbox projects are only reachable via the railgate tunnel — never fall
  // back to localhost for them (there is no local dev server).
  const isSandboxProject = (currentProject?.executionMode ?? 'local') === 'sandbox';
  const previewUrl = currentProject ? getProjectPreviewUrl(currentProject) : null;
  const isServerRunning = currentProject?.devServerStatus === 'running';

  const getTabId = (tab: PreviewTab) => `${componentId}-${tab}-tab`;
  const getPanelId = (tab: PreviewTab) => `${componentId}-${tab}-panel`;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: PreviewTab) => {
    const currentIndex = previewTabs.indexOf(currentTab);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % previewTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + previewTabs.length) % previewTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = previewTabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = previewTabs[nextIndex];
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

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
        ref={ref}
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="@container h-full flex flex-col bg-card/50 backdrop-blur-md border border-border rounded-xl shadow-xl overflow-hidden"
      >
        <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
          <div
            role="tablist"
            aria-label="Project workspace"
            aria-orientation="horizontal"
            className="flex shrink-0 items-center rounded-md bg-muted/50 p-0.5"
          >
            {previewTabs.map((tab) => {
              const { label, Icon } = tabDetails[tab];
              const isSelected = activeTab === tab;

              return (
                <Tooltip key={tab}>
                  <TooltipTrigger asChild>
                    <button
                      ref={(node) => {
                        tabRefs.current[tab] = node;
                      }}
                      id={getTabId(tab)}
                      type="button"
                      role="tab"
                      aria-label={label}
                      aria-selected={isSelected}
                      aria-controls={getPanelId(tab)}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => setActiveTab(tab)}
                      onKeyDown={(event) => handleTabKeyDown(event, tab)}
                      className={cn(
                        iconButtonClass,
                        'rounded',
                        isSelected
                          ? 'bg-theme-primary-muted text-theme-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {isServerRunning && activeTab === 'preview' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Select elements in preview"
                  aria-pressed={isSelectionMode}
                  onClick={() => setIsSelectionMode(!isSelectionMode)}
                  className={cn(
                    iconButtonClass,
                    'hidden @sm:inline-flex',
                    isSelectionMode
                      ? 'bg-theme-primary-muted text-theme-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <MousePointer2 aria-hidden="true" className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isSelectionMode ? 'Stop selecting elements' : 'Select an element'}
              </TooltipContent>
            </Tooltip>
          )}

          <div className="min-w-0 flex-1" />

          {isServerRunning && activeTab === 'preview' && previewUrl && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Refresh preview"
                    aria-busy={isRefreshing}
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className={cn(iconButtonClass, 'hidden text-muted-foreground hover:bg-accent hover:text-foreground @xl:inline-flex')}
                  >
                    <RefreshCw aria-hidden="true" className={cn('size-4', isRefreshing && 'animate-spin')} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh preview</TooltipContent>
              </Tooltip>

              <div className="hidden min-w-0 items-center gap-2 @4xl:flex">
                <HoverCard openDelay={200}>
                  <HoverCardTrigger asChild>
                    <div className="flex h-11 min-w-0 max-w-[300px] items-center gap-2 rounded-md border border-border bg-muted/50 pl-3">
                      <div
                        aria-hidden="true"
                        className={cn(
                          'size-2 shrink-0 rounded-full shadow-lg',
                          currentProject?.tunnelUrl
                            ? 'bg-blue-400 shadow-blue-400/50'
                            : 'bg-[#92DD00] shadow-[#92DD00]/50'
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                        {previewUrl}
                      </span>
                      <button
                        type="button"
                        aria-label="Copy preview URL"
                        onClick={handleCopyUrl}
                        className={cn(iconButtonClass, 'hover:bg-accent')}
                      >
                        {copied ? (
                          <Check aria-hidden="true" className="size-4 text-green-500" />
                        ) : (
                          <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-auto max-w-xl bg-popover border-border" side="bottom">
                    <p className="break-all font-mono text-xs text-popover-foreground">{previewUrl}</p>
                  </HoverCardContent>
                </HoverCard>

                <fieldset className="flex shrink-0 items-center rounded-md bg-muted/50 p-0.5">
                  <legend className="sr-only">Preview device size</legend>
                  {devicePresets.map(({ value, label, Icon }) => (
                    <Tooltip key={value}>
                      <TooltipTrigger asChild>
                        <label
                          className={cn(
                            'relative inline-flex size-11 cursor-pointer items-center justify-center rounded transition-all has-focus-visible:outline-none has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-1',
                            devicePreset === value
                              ? 'bg-theme-primary-muted text-theme-primary'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          )}
                        >
                          <input
                            className="sr-only"
                            type="radio"
                            name={deviceGroupName}
                            value={value}
                            checked={devicePreset === value}
                            onChange={() => setDevicePreset(value)}
                          />
                          <Icon aria-hidden="true" className="size-4" />
                          <span className="sr-only">{label}</span>
                        </label>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{label}</TooltipContent>
                    </Tooltip>
                  ))}
                </fieldset>
              </div>
            </>
          )}

          {isServerRunning && previewUrl && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More preview controls"
                      className={cn(iconButtonClass, 'text-muted-foreground hover:bg-accent hover:text-foreground @4xl:hidden')}
                    >
                      <MoreHorizontal aria-hidden="true" className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">More preview controls</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Preview controls</DropdownMenuLabel>
                {activeTab === 'preview' && (
                  <>
                    <DropdownMenuCheckboxItem
                      checked={isSelectionMode}
                      onCheckedChange={setIsSelectionMode}
                    >
                      <MousePointer2 aria-hidden="true" />
                      Select elements
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuItem onSelect={handleRefresh} disabled={isRefreshing}>
                      <RefreshCw aria-hidden="true" className={cn(isRefreshing && 'animate-spin')} />
                      Refresh preview
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleCopyUrl}>
                      <Copy aria-hidden="true" />
                      Copy preview URL
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Device size</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      aria-label="Preview device size"
                      value={devicePreset}
                      onValueChange={(value) => setDevicePreset(value as DevicePreset)}
                    >
                      {devicePresets.map(({ value, label, Icon }) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                          <Icon aria-hidden="true" />
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                )}
                {(currentProject?.tunnelUrl || (actualPort && !isSandboxProject)) && <DropdownMenuSeparator />}
                {currentProject?.tunnelUrl && (
                  <DropdownMenuItem onSelect={() => window.open(currentProject.tunnelUrl!, '_blank', 'noopener,noreferrer')}>
                    <Cloud aria-hidden="true" />
                    Open tunnel URL
                  </DropdownMenuItem>
                )}
                {actualPort && !isSandboxProject && (
                  <DropdownMenuItem onSelect={() => window.open(`http://localhost:${actualPort}`, '_blank', 'noopener,noreferrer')}>
                    <ExternalLink aria-hidden="true" />
                    Open localhost
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isServerRunning && previewUrl && (
            <div className="hidden shrink-0 items-center gap-1 @4xl:flex">
              {currentProject?.tunnelUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Open tunnel URL in a new tab"
                      onClick={() => window.open(currentProject.tunnelUrl!, '_blank', 'noopener,noreferrer')}
                      className={cn(iconButtonClass, 'text-blue-400 hover:bg-blue-500/20 hover:text-blue-300')}
                    >
                      <Cloud aria-hidden="true" className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open tunnel URL</TooltipContent>
                </Tooltip>
              )}
              {actualPort && !isSandboxProject && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Open localhost in a new tab"
                      onClick={() => window.open(`http://localhost:${actualPort}`, '_blank', 'noopener,noreferrer')}
                      className={cn(iconButtonClass, 'text-green-400 hover:bg-green-500/20 hover:text-green-300')}
                    >
                      <ExternalLink aria-hidden="true" className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open localhost</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          {currentProject?.runCommand && currentProject?.status === 'completed' && !isBuildActive && (
            isServerRunning ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Stop preview server"
                    onClick={onStopServer}
                    disabled={isStoppingServer}
                    className={cn(iconButtonClass, 'text-[#FF45A8] hover:bg-[#FF45A8]/20 hover:text-[#FF70BC]')}
                  >
                    <Square aria-hidden="true" className={cn('size-4', isStoppingServer && 'animate-pulse')} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Stop server</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Start preview server"
                    onClick={onStartServer}
                    disabled={currentProject.devServerStatus === 'starting' || isStartingServer}
                    className={cn(iconButtonClass, 'text-[#92DD00] hover:bg-[#92DD00]/20 hover:text-[#A8F000]')}
                  >
                    <Play aria-hidden="true" className={cn('size-4', isStartingServer && 'animate-pulse')} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Start server</TooltipContent>
              </Tooltip>
            )
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {copied ? 'Preview URL copied' : ''}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <div
            id={getPanelId('preview')}
            role="tabpanel"
            aria-labelledby={getTabId('preview')}
            tabIndex={activeTab === 'preview' ? 0 : -1}
            hidden={activeTab !== 'preview'}
            className="h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {activeTab === 'preview' && (
              <PreviewPanel
                selectedProject={selectedProject}
                onStartServer={onStartServer}
                onStopServer={onStopServer}
                isStartingServer={isStartingServer}
                isStoppingServer={isStoppingServer}
                isBuildActive={isBuildActive}
                devicePreset={devicePreset}
                hideControls={true}
                isSelectionModeEnabled={isSelectionMode}
                onSelectionModeChange={setIsSelectionMode}
              />
            )}
          </div>
          <div
            id={getPanelId('editor')}
            role="tabpanel"
            aria-labelledby={getTabId('editor')}
            tabIndex={activeTab === 'editor' ? 0 : -1}
            hidden={activeTab !== 'editor'}
            className="h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {activeTab === 'editor' && <EditorTab projectId={projectId} />}
          </div>
          <div
            id={getPanelId('terminal')}
            role="tabpanel"
            aria-labelledby={getTabId('terminal')}
            tabIndex={activeTab === 'terminal' ? 0 : -1}
            hidden={activeTab !== 'terminal'}
            className="h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {activeTab === 'terminal' && (
              <TerminalOutput
                projectId={projectId}
                onPortDetected={onPortDetected}
              />
            )}
          </div>
        </div>
      </motion.div>
    </TooltipProvider>
  );
});

TabbedPreview.displayName = 'TabbedPreview';

export default TabbedPreview;
