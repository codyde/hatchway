'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Play, Square, Copy, Check, Monitor, Smartphone, Tablet, ExternalLink, Rocket } from 'lucide-react';
import { useProjects } from '@/contexts/ProjectContext';
import SelectionMode from './SelectionMode';
import ElementComment from './ElementComment';
import { toggleSelectionMode } from '@hatchway/agent-core/lib/selection/injector';
import { useElementEdits } from '@/hooks/useElementEdits';
import { useHmrProxy } from '@/hooks/useHmrProxy';
import StarfoxLoadingGame from './StarfoxLoadingGame';
import { ServerRestartProgress } from './ServerRestartProgress';
import { ServerRestarting } from './StatusAnimations';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

type DevicePreset = 'desktop' | 'tablet' | 'mobile';

// WebSocket proxy routes remote frontend traffic through the runner connection
const USE_WS_PROXY = process.env.NEXT_PUBLIC_USE_WS_PROXY === 'true';

interface PreviewPanelProps {
  selectedProject?: string | null;
  onStartServer?: () => void;
  onStopServer?: () => void;
  isStartingServer?: boolean;
  isStoppingServer?: boolean;
  isBuildActive?: boolean;
  devicePreset?: DevicePreset;
  hideControls?: boolean;
  isSelectionModeEnabled?: boolean;
  onSelectionModeChange?: (enabled: boolean) => void;
}

const DEBUG_PREVIEW = false; // Set to true to enable verbose preview panel logging

export default function PreviewPanel({ 
  selectedProject, 
  onStartServer, 
  onStopServer, 
  isStartingServer, 
  isStoppingServer, 
  isBuildActive,
  devicePreset: externalDevicePreset,
  isSelectionModeEnabled: externalSelectionMode,
  onSelectionModeChange,
  hideControls = false,
}: PreviewPanelProps) {
  const { projects, refetch } = useProjects();
  const [key, setKey] = useState(0);
  const [cacheBust, setCacheBust] = useState(0); // For forcing iframe reload
  const [internalSelectionMode, setInternalSelectionMode] = useState(false);
  // Use external selection mode if provided, otherwise use internal state
  const isSelectionModeEnabled = externalSelectionMode ?? internalSelectionMode;
  const setIsSelectionModeEnabled = onSelectionModeChange ?? setInternalSelectionMode;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [internalDevicePreset, setInternalDevicePreset] = useState<DevicePreset>('desktop');
  // Use external device preset if provided, otherwise use internal state
  const devicePreset = externalDevicePreset ?? internalDevicePreset;
  const setDevicePreset = setInternalDevicePreset;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { edits, addEdit, removeEdit } = useElementEdits();
  const lastTunnelUrlRef = useRef<string | null>(null);
  const [verifiedTunnelUrl, setVerifiedTunnelUrl] = useState<string | null>(null);
  const lastPreviewUrlRef = useRef<string>(''); // Track last working preview URL to keep iframe visible during follow-up builds

  // Find the current project
  const project = projects.find(p => p.slug === selectedProject);
  const [liveProject, setLiveProject] = useState(project);

  // Use live project data if available (from SSE), otherwise fall back to context
  const currentProject = liveProject || project;

  // Port comes from database (pre-allocated in start route)
  const actualPort = currentProject?.devServerPort;
  
  // HMR Proxy - tunnels Vite HMR WebSocket through our WS connection
  useHmrProxy({
    projectId: currentProject?.id || '',
    runnerId: currentProject?.runnerId || undefined,
    devServerPort: actualPort || 5173,
    enabled: USE_WS_PROXY && !!currentProject?.id && currentProject?.devServerStatus === 'running',
    iframeRef: iframeRef as React.RefObject<HTMLIFrameElement>,
  });

  // Track SSE connection health
  const [isSSEConnected, setIsSSEConnected] = useState(false);
  const sseFailureCountRef = useRef(0);
  
  // Track previous stopping state for refetch trigger
  const prevStoppingServerRef = useRef(isStoppingServer);

  // Clear last preview URL when project changes
  useEffect(() => {
    lastPreviewUrlRef.current = '';
  }, [selectedProject]);

  // Real-time status updates via SSE
  useEffect(() => {
    if (!project?.id) {
      setLiveProject(undefined);
      setIsSSEConnected(false);
      return;
    }

    const eventSource = new EventSource(`/api/projects/${project.id}/status-stream`);

    eventSource.onopen = () => {
      setIsSSEConnected(true);
      sseFailureCountRef.current = 0;
    };

    eventSource.onmessage = (event) => {
      // Ignore keepalive pings
      if (event.data === ':keepalive') return;

      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status-update' && data.project) {
          setLiveProject(data.project);
        }
      } catch (err) {
        console.error('Failed to parse SSE status event:', err);
      }
    };

    eventSource.onerror = () => {
      setIsSSEConnected(false);
      sseFailureCountRef.current++;
      eventSource.close();
    };

    return () => {
      setIsSSEConnected(false);
      eventSource.close();
    };
  }, [project?.id]);

  // Fallback polling ONLY when SSE fails: Poll during active operations
  useEffect(() => {
    // Only poll if SSE has failed multiple times (not just temporarily disconnected)
    if (isSSEConnected || sseFailureCountRef.current < 2) return;

    const shouldPoll = isStartingServer || currentProject?.devServerStatus === 'starting';

    if (!shouldPoll) return;

    const interval = setInterval(() => {
      refetch();
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [isSSEConnected, isStartingServer, currentProject?.devServerStatus, refetch]);

  // Force refetch after stop completes (if SSE missed the event)
  useEffect(() => {
    if (prevStoppingServerRef.current && !isStoppingServer) {
      console.log('[PreviewPanel] Stop operation completed, forcing refetch...');
      refetch();
    }
    prevStoppingServerRef.current = isStoppingServer;
  }, [isStoppingServer, refetch]);

  // Preview URL handling for railgate / sandbox public URLs stored on tunnelUrl
  useEffect(() => {
    const currentTunnelUrl = currentProject?.tunnelUrl;

    if (currentTunnelUrl && currentTunnelUrl !== lastTunnelUrlRef.current) {
      if (DEBUG_PREVIEW) console.log('🔗 Preview URL received:', currentTunnelUrl);
      lastTunnelUrlRef.current = currentTunnelUrl;
      setVerifiedTunnelUrl(currentTunnelUrl);
      setKey(prev => prev + 1);
      return;
    }

    if (!currentTunnelUrl && lastTunnelUrlRef.current) {
      lastTunnelUrlRef.current = null;
      setVerifiedTunnelUrl(null);
    }
  }, [currentProject?.tunnelUrl]);

  // Detect if frontend is being accessed remotely (not localhost)
  const frontendIsRemote = typeof window !== 'undefined' &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1');

  // Sandbox projects run entirely in a Railway sandbox and are ONLY reachable
  // via the railgate tunnel — there is no local dev server.
  const isSandboxProject = (currentProject?.executionMode ?? 'local') === 'sandbox';

  // Show preview when server is running and we can reach it:
  // local frontend, railgate preview URL, or WS proxy
  const canShowPreview = !!currentProject?.id && currentProject?.devServerStatus === 'running' && (
    isSandboxProject
      ? !!currentProject?.tunnelUrl
      : !!actualPort && (!frontendIsRemote || !!currentProject?.tunnelUrl || USE_WS_PROXY)
  );

  if (DEBUG_PREVIEW && currentProject?.devServerStatus === 'running') {
    console.log('[PreviewPanel] Can show preview?', {
      canShowPreview,
      actualPort,
      devServerStatus: currentProject?.devServerStatus,
      frontendIsRemote,
      tunnelUrl: currentProject?.tunnelUrl,
      isSandboxProject,
    });
  }

  // Local frontend / WS proxy: use proxy route for script injection
  // Remote + railgate URL: use the public URL directly
  const basePreviewUrl = canShowPreview
    ? (frontendIsRemote && verifiedTunnelUrl
        ? verifiedTunnelUrl
        : `/api/projects/${currentProject.id}/proxy?path=/`)
    : '';

  // During follow-up builds, keep showing the last working preview URL
  if (basePreviewUrl) {
    lastPreviewUrlRef.current = basePreviewUrl;
  }
  
  const baseUrl = basePreviewUrl || (isBuildActive ? lastPreviewUrlRef.current : '');
  
  const previewUrl = baseUrl 
    ? (baseUrl.includes('?') 
        ? `${baseUrl}&_cb=${cacheBust}` 
        : `${baseUrl}${cacheBust ? `?_cb=${cacheBust}` : ''}`)
    : '';

  const resolvedTunnelUrl = verifiedTunnelUrl || currentProject?.tunnelUrl || '';
  const localhostUrl = actualPort ? `http://localhost:${actualPort}` : '';
  const externalUrl = resolvedTunnelUrl || (isSandboxProject ? '' : localhostUrl);
  const displayUrlLabel = externalUrl || (isSandboxProject ? 'Starting sandbox preview…' : localhostUrl);


  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setKey(prev => prev + 1);
    setCacheBust(Date.now()); // Force new URL to bypass cache
    // Reset after iframe loads
    setTimeout(() => setIsRefreshing(false), 1000);
  }, []);

  // Listen for refresh requests (e.g., after element changes complete or from TabbedPreview header)
  useEffect(() => {
    const handleRefreshEvent = () => {
      handleRefresh();
    };

    // Listen for both event names for compatibility
    window.addEventListener('refresh-iframe', handleRefreshEvent);
    window.addEventListener('refresh-preview', handleRefreshEvent);
    return () => {
      window.removeEventListener('refresh-iframe', handleRefreshEvent);
      window.removeEventListener('refresh-preview', handleRefreshEvent);
    };
  }, [handleRefresh]);

  // Track build state for auto-refresh on completion
  // NOTE: HMR doesn't work through the proxy (dynamic import() bypasses fetch interceptor)
  // So we auto-refresh the iframe when the build completes
  const prevBuildActiveRef = useRef(isBuildActive);
  
  useEffect(() => {
    // Auto-refresh iframe when build completes (local mode only). For sandbox,
    // the build finishing does NOT mean the new code is live — the workspace
    // still has to sync into the box and the dev server restart there. Sandbox
    // reloads are driven by the dev-server status transition below instead, so
    // we don't refresh prematurely onto the previous build.
    if (prevBuildActiveRef.current && !isBuildActive && previewUrl && !isSandboxProject) {
      if (DEBUG_PREVIEW) console.log('[PreviewPanel] Build completed - auto-refreshing iframe');
      // Small delay to ensure all file writes are flushed
      setTimeout(() => {
        handleRefresh();
      }, 500);
    }
    prevBuildActiveRef.current = isBuildActive;
  }, [isBuildActive, previewUrl, handleRefresh, isSandboxProject]);

  // Sandbox: the preview is a synced COPY served behind a STABLE railgate URL,
  // so the iframe never reloads itself after a re-sync. When the dev server
  // goes starting -> running (a sync just finished with the new code), force a
  // reload so the update appears without a manual refresh. If the dev server is
  // still warming up, the injection-proxy "Starting preview…" splash
  // auto-refreshes until it's ready.
  const prevDevStatusRef = useRef(currentProject?.devServerStatus);
  useEffect(() => {
    const status = currentProject?.devServerStatus;
    const prev = prevDevStatusRef.current;
    prevDevStatusRef.current = status;
    if (isSandboxProject && prev === 'starting' && status === 'running' && previewUrl) {
      if (DEBUG_PREVIEW) console.log('[PreviewPanel] Sandbox re-sync complete - reloading iframe');
      setTimeout(() => handleRefresh(), 300);
    }
  }, [currentProject?.devServerStatus, isSandboxProject, previewUrl, handleRefresh]);

  const handleCopyUrl = async () => {
    // Copy the externally-reachable URL (tunnel, or localhost for non-sandbox).
    const url = externalUrl;
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  // Device preset dimensions
  const getDeviceDimensions = () => {
    switch (devicePreset) {
      case 'mobile':
        return { width: '375px', height: '100%' }; // iPhone size
      case 'tablet':
        return { width: '768px', height: '100%' }; // iPad size
      case 'desktop':
      default:
        return { width: '100%', height: '100%' };
    }
  };

  const dimensions = getDeviceDimensions();

  // Auto-sync inspector state when iframe loads or script announces ready
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'hatchway:ready') {
        if (DEBUG_PREVIEW) console.log('📦 Iframe script ready, syncing inspector state:', isSelectionModeEnabled);
        // Iframe loaded and script ready, sync current state
        if (iframeRef.current) {
          toggleSelectionMode(iframeRef.current, isSelectionModeEnabled);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isSelectionModeEnabled]);

  // Toggle selection mode when button clicked
  useEffect(() => {
    if (!iframeRef.current) return;
    toggleSelectionMode(iframeRef.current, isSelectionModeEnabled);
  }, [isSelectionModeEnabled]);

  // Handle element selection - create comment indicator at click position
  // Defined before the message listener effect so it can be used as a dependency
  const handleElementSelected = useCallback((element: any, prompt: string) => {
    if (!element.clickPosition) {
      console.error('❌ No click position!');
      return;
    }

    // Get iframe's position in the parent window
    const iframeRect = iframeRef.current?.getBoundingClientRect();
    if (!iframeRect) {
      console.error('❌ Cannot get iframe position!');
      return;
    }

    // Translate iframe-relative coords to parent window coords
    // clickPosition is relative to iframe viewport, we need to add iframe's position
    const position = {
      x: element.clickPosition.x + iframeRect.left,
      y: element.clickPosition.y + iframeRect.top,
    };

    if (DEBUG_PREVIEW) console.log('📍 Creating comment:', {
      rawClick: element.clickPosition,
      iframeOffset: { left: iframeRect.left, top: iframeRect.top },
      adjusted: position,
    });

    const editId = addEdit(element, prompt, position);
    if (DEBUG_PREVIEW) console.log('✅ Created edit:', editId);
  }, [addEdit]);

  // Handle comment submission - send to chat as regular generation
  const handleCommentSubmit = useCallback((editId: string, prompt: string) => {
    if (DEBUG_PREVIEW) console.log('🚀 Submitting element change:', editId, prompt);

    const edit = edits.find(e => e.id === editId);
    if (!edit) return;

    // Remove the edit (comment window will close)
    removeEdit(editId);

    // Format prompt with element context using code formatting for selector
    const formattedPrompt = `Change the element with selector \`${edit.element.selector}\` (\`${edit.element.tagName}\`): ${prompt}`;

    // Send to regular chat flow - will create todo automatically
    window.dispatchEvent(new CustomEvent('selection-change-requested', {
      detail: { element: edit.element, prompt: formattedPrompt },
    }));

    if (DEBUG_PREVIEW) console.log('✅ Sent to chat system');
  }, [edits, removeEdit]);

  // Listen for element selection messages from iframe
  // This runs independently of the SelectionMode button component
  // so it works even when hideControls={true}
  const hasProcessedRef = useRef<Set<string>>(new Set());
  
  // Use refs to avoid re-subscribing to message events on every render
  const handleElementSelectedRef = useRef(handleElementSelected);
  const setIsSelectionModeEnabledRef = useRef(setIsSelectionModeEnabled);
  
  // Keep refs up to date
  useEffect(() => {
    handleElementSelectedRef.current = handleElementSelected;
    setIsSelectionModeEnabledRef.current = setIsSelectionModeEnabled;
  });
  
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'hatchway:element-selected') {
        const element = e.data.data;
        const elementKey = `${element.selector}-${element.clickPosition?.x}-${element.clickPosition?.y}`;

        // Prevent duplicate processing of same click
        if (hasProcessedRef.current.has(elementKey)) {
          console.warn('⚠️ Duplicate selection detected, ignoring');
          return;
        }

        hasProcessedRef.current.add(elementKey);

        // Clear after 1 second (allow re-selecting same element after delay)
        setTimeout(() => {
          hasProcessedRef.current.delete(elementKey);
        }, 1000);

        if (DEBUG_PREVIEW) console.log('🎯 Processing element selection:', element);
        // Call handleElementSelected via ref to avoid dependency issues
        handleElementSelectedRef.current(element, '');
        setIsSelectionModeEnabledRef.current(false); // Disable selection mode
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []); // Empty deps - subscribe once, use refs for latest callbacks

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="h-full flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Browser-like chrome bar - hidden when controls are in header */}
      {!hideControls && (
        <div className="bg-muted/50 border-b border-border px-3 py-2 flex items-center gap-2">
        {previewUrl ? (
          <>
            {/* Left controls */}
            <div className="flex items-center gap-1">
              {/* Selection Mode Toggle */}
              <SelectionMode
                isEnabled={isSelectionModeEnabled}
                onToggle={setIsSelectionModeEnabled}
              />

              {/* Refresh button */}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="p-1.5 rounded-md hover:bg-accent transition-all duration-200 disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* URL bar - Center (Fixed width to prevent layout shift) */}
            <div className="flex items-center gap-2 mx-3">
              <HoverCard openDelay={200}>
                <HoverCardTrigger asChild>
                  <div className="w-[512px] flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-md hover:border-muted-foreground/30 transition-colors cursor-default">
                    <div className={`w-2 h-2 rounded-full shadow-lg flex-shrink-0 ${
                      verifiedTunnelUrl || currentProject?.tunnelUrl
                        ? 'bg-blue-400 shadow-blue-400/50'
                        : 'bg-[#92DD00] shadow-[#92DD00]/50'
                    }`}></div>
                    <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                      {displayUrlLabel}
                    </span>
                    <button
                      onClick={handleCopyUrl}
                      className="p-1 rounded hover:bg-accent transition-colors flex-shrink-0"
                      title="Copy URL"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto max-w-xl bg-popover border-border" side="bottom">
                  <p className="text-xs font-mono text-popover-foreground break-all">
                    {displayUrlLabel}
                  </p>
                </HoverCardContent>
              </HoverCard>

              {/* Device presets */}
              <div className="flex items-center gap-1 bg-background border border-border rounded-md p-1">
                <button
                  onClick={() => setDevicePreset('desktop')}
                  className={`p-1.5 rounded transition-all ${
                    devicePreset === 'desktop'
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                  title="Desktop view"
                >
                  <Monitor className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDevicePreset('tablet')}
                  className={`p-1.5 rounded transition-all ${
                    devicePreset === 'tablet'
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                  title="Tablet view (768px)"
                >
                  <Tablet className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDevicePreset('mobile')}
                  className={`p-1.5 rounded transition-all ${
                    devicePreset === 'mobile'
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                  title="Mobile view (375px)"
                >
                  <Smartphone className="w-4 h-4" />
                </button>
              </div>

              {/* Open buttons */}
              <div className="flex items-center gap-1">
                {resolvedTunnelUrl && (
                  <button
                    onClick={() => window.open(resolvedTunnelUrl, '_blank')}
                    className="p-1.5 rounded-md hover:bg-blue-500/20 transition-all duration-200 group"
                    title="Open preview URL in new tab"
                  >
                    <ExternalLink className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
                  </button>
                )}

                {/* Open Localhost — not applicable to sandbox projects (no local server) */}
                {actualPort && !isSandboxProject && (
                  <button
                    onClick={() => window.open(`http://localhost:${actualPort}`, '_blank')}
                    className="p-1.5 rounded-md hover:bg-green-500/20 transition-all duration-200 group"
                    title="Open localhost in new tab"
                  >
                    <Monitor className="w-4 h-4 text-green-400 group-hover:text-green-300" />
                  </button>
                )}
              </div>
            </div>

          </>
        ) : (
          <div className="flex-1 text-center">
            <span className="text-sm text-muted-foreground">No preview available</span>
          </div>
        )}

        {/* Right controls - Server buttons - Only show when build is complete */}
        <div className="flex items-center gap-2 ml-auto">
          {currentProject?.runCommand && currentProject?.status === 'completed' && !isBuildActive && (
            <>
              {currentProject.devServerStatus === 'running' ? (
                <button
                  onClick={onStopServer}
                  disabled={isStoppingServer}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#FF45A8]/20 hover:bg-[#FF45A8]/30 text-[#FF45A8] border border-[#FF45A8]/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Square className={`w-3.5 h-3.5 ${isStoppingServer ? 'animate-pulse' : ''}`} />
                  {isStoppingServer ? 'Stopping...' : 'Stop'}
                </button>
              ) : (
                <button
                  onClick={onStartServer}
                  disabled={currentProject.devServerStatus === 'starting' || isStartingServer}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#92DD00]/20 hover:bg-[#92DD00]/30 text-[#92DD00] border border-[#92DD00]/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className={`w-3.5 h-3.5 ${isStartingServer ? 'animate-pulse' : ''}`} />
                  {currentProject.devServerStatus === 'starting' || isStartingServer ? 'Starting...' : 'Start'}
                </button>
              )}
            </>
          )}
        </div>
        </div>
      )}
      <div className="flex-1 bg-card relative flex items-start justify-center overflow-auto">
        {previewUrl ? (
          <>
            {/* Loading indicator overlay */}
            {isRefreshing && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Refreshing preview...</p>
                </div>
              </div>
            )}

            <div
              className="bg-white transition-all duration-300 ease-out"
              style={{
                width: dimensions.width,
                height: dimensions.height,
                maxWidth: '100%',
                boxShadow: devicePreset !== 'desktop' ? '0 0 40px rgba(0,0,0,0.3)' : 'none',
                margin: devicePreset !== 'desktop' ? '20px auto' : '0',
              }}
            >
              <iframe
                ref={iframeRef}
                key={key}
                src={previewUrl}
                sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
                allow="geolocation; camera; microphone; fullscreen; clipboard-write; clipboard-read; cross-origin-isolated"
                className="w-full h-full border-0"
                style={{
                  colorScheme: 'normal',
                  isolation: 'isolate',
                }}
                title="Preview"
                onLoad={(e) => {
                  setIsRefreshing(false);
                  if (DEBUG_PREVIEW) console.log('✅ Iframe loaded:', previewUrl);

                  // Check for error pages
                  const iframe = e.currentTarget;
                  setTimeout(() => {
                    try {
                      const doc = iframe.contentDocument || iframe.contentWindow?.document;
                      if (doc) {
                        const bodyText = doc.body?.innerText?.substring(0, 100);
                        if (bodyText?.includes('Application error') || bodyText?.includes('502') || bodyText?.includes('503')) {
                          console.error('🚨 Preview loaded error page:', bodyText);
                        } else {
                          if (DEBUG_PREVIEW) console.log('📄 Preview content loaded successfully');
                        }
                      }
                    } catch (err) {
                      if (DEBUG_PREVIEW) console.log('⚠️  Cross-origin iframe (cannot inspect content)');
                    }
                  }, 500);
                }}
                onError={(e) => {
                  console.error('🚨 Iframe error event:', e);
                }}
              />

            </div>

            {/* Floating comment indicators */}
            <AnimatePresence>
              {edits.map((edit) => {
                // Get container bounds from iframe for boundary clamping
                const iframeRect = iframeRef.current?.getBoundingClientRect();
                const containerBounds = iframeRect ? {
                  top: iframeRect.top,
                  left: iframeRect.left,
                  right: iframeRect.right,
                  bottom: iframeRect.bottom,
                } : undefined;
                
                return (
                  <ElementComment
                    key={edit.id}
                    element={edit.element}
                    position={edit.position}
                    containerBounds={containerBounds}
                    status={edit.status}
                    onSubmit={(prompt) => handleCommentSubmit(edit.id, prompt)}
                    onClose={() => removeEdit(edit.id)}
                  />
                );
              })}
            </AnimatePresence>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {isBuildActive ? (
              <StarfoxLoadingGame />
            ) : currentProject?.devServerStatus === 'restarting' ? (
              <div className="flex flex-col items-center gap-4 max-w-lg px-6">
                <ServerRestartProgress 
                  projectName={currentProject.name}
                  port={currentProject.devServerPort || undefined}
                />
              </div>
            ) : currentProject?.devServerStatus === 'starting' || isStartingServer ? (
              <div className="flex flex-col items-center gap-4 max-w-lg px-6">
                <ServerRestarting 
                  phase="starting"
                  projectName={currentProject?.name}
                  port={currentProject?.devServerPort || undefined}
                />
              </div>
            ) : isSandboxProject && currentProject?.devServerStatus === 'running' && !currentProject?.tunnelUrl ? (
              <div className="text-center space-y-4 max-w-md px-6">
                <div className="flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Rocket className="w-8 h-8 text-blue-400" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-foreground">Starting sandbox preview</h3>
                  <p className="text-muted-foreground text-sm">
                    Waiting for the railgate preview URL…
                  </p>
                </div>
              </div>
            ) : currentProject?.status === 'completed' && currentProject?.runCommand ? (
              <div className="text-center space-y-4 max-w-md">
                <div className="flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Rocket className="w-8 h-8 text-green-400" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-foreground">Project Ready!</h3>
                  <p className="text-muted-foreground">Click the <span className="text-[#92DD00] font-semibold">Start</span> button above to launch your dev server</p>
                </div>
                <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
                  <Play className="w-4 h-4" />
                  <span>Port will be automatically allocated</span>
                </div>
              </div>
            ) : (
              <p>Start the dev server to see preview</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
