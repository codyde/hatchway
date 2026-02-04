'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, RefreshCw, Play, Square, Copy, Check, Monitor, Smartphone, Tablet, Cloud, Rocket } from 'lucide-react';
import { useProjects } from '@/contexts/ProjectContext';
import SelectionMode from './SelectionMode';
import ElementComment from './ElementComment';
import { toggleSelectionMode } from '@hatchway/agent-core/lib/selection/injector';
import { useElementEdits } from '@/hooks/useElementEdits';
import { useHmrProxy } from '@/hooks/useHmrProxy';
import BuildingAppSkeleton from './BuildingAppSkeleton';
import { ServerRestartProgress } from './ServerRestartProgress';
import { ServerRestarting, TunnelConnecting } from './StatusAnimations';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

type DevicePreset = 'desktop' | 'tablet' | 'mobile';

// Check if WebSocket proxy is enabled (tunnels through WS instead of Cloudflare)
const USE_WS_PROXY = process.env.NEXT_PUBLIC_USE_WS_PROXY === 'true';

interface PreviewPanelProps {
  selectedProject?: string | null;
  onStartServer?: () => void;
  onStopServer?: () => void;
  onStartTunnel?: () => void;
  onStopTunnel?: () => void;
  isStartingServer?: boolean;
  isStoppingServer?: boolean;
  isStartingTunnel?: boolean;
  isStoppingTunnel?: boolean;
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
  onStartTunnel, 
  onStopTunnel, 
  isStartingServer, 
  isStoppingServer, 
  isStartingTunnel, 
  isStoppingTunnel, 
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
  const [isTunnelLoading, setIsTunnelLoading] = useState(false);
  const [dnsVerificationAttempt, setDnsVerificationAttempt] = useState<number>(0);
  const [dnsTroubleshooting, setDnsTroubleshooting] = useState(false);
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
  // Only enabled when using WS proxy mode (remote frontend without Cloudflare tunnel)
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
  
  // Track previous stopping states for refetch trigger
  const prevStoppingTunnelRef = useRef(isStoppingTunnel);
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

    // Poll every 2 seconds while server starting, tunnel starting, or server running without tunnel URL
    const shouldPoll = isStartingServer || isStartingTunnel ||
                      (currentProject?.devServerStatus === 'starting') ||
                      (isStartingTunnel && !currentProject?.tunnelUrl);

    if (!shouldPoll) return;

    const interval = setInterval(() => {
      refetch();
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [isSSEConnected, isStartingServer, isStartingTunnel, currentProject?.devServerStatus, currentProject?.tunnelUrl, refetch]);

  // BUG FIX: Force refetch after stopping operations complete
  // This ensures UI updates even if SSE doesn't receive the event
  useEffect(() => {
    // If we just finished stopping tunnel/server, force a refetch
    if ((prevStoppingTunnelRef.current && !isStoppingTunnel) || 
        (prevStoppingServerRef.current && !isStoppingServer)) {
      console.log('[PreviewPanel] Stop operation completed, forcing refetch...');
      refetch();
    }
    
    // Update refs for next render
    prevStoppingTunnelRef.current = isStoppingTunnel;
    prevStoppingServerRef.current = isStoppingServer;
  }, [isStoppingTunnel, isStoppingServer, refetch]);

  // Tunnel URL handling - skip DNS verification, use URL directly
  // DNS verification was causing 30+ second delays due to Chrome cache issues
  useEffect(() => {
    const currentTunnelUrl = currentProject?.tunnelUrl;

    // Show brief loading while tunnel is being created
    if (isStartingTunnel) {
      setIsTunnelLoading(true);
      return;
    }

    // When tunnel URL arrives, use it immediately
    if (currentTunnelUrl && currentTunnelUrl !== lastTunnelUrlRef.current) {
      if (DEBUG_PREVIEW) console.log('🔗 Tunnel URL received, using directly:', currentTunnelUrl);
      lastTunnelUrlRef.current = currentTunnelUrl;
      setVerifiedTunnelUrl(currentTunnelUrl);
      setIsTunnelLoading(false);
      setDnsTroubleshooting(false);
      
      // Force iframe to reload with tunnel URL
      setKey(prev => prev + 1);
      return;
    }

    // Clear verified URL if tunnel was removed
    if (!currentTunnelUrl && lastTunnelUrlRef.current) {
      lastTunnelUrlRef.current = null;
      setVerifiedTunnelUrl(null);
      setIsTunnelLoading(false);
      setDnsTroubleshooting(false);
    }

    // Hide loading if not starting
    if (!isStartingTunnel) {
      setIsTunnelLoading(false);
    }
  }, [currentProject?.tunnelUrl, isStartingTunnel]);

  // Detect if frontend is being accessed remotely (not localhost)
  const frontendIsRemote = typeof window !== 'undefined' &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1');

  // Detect if server is running on a remote runner (not local machine)
  // Remote runners typically have runnerId != 'local'
  const isRemoteRunner = currentProject?.runnerId && currentProject.runnerId !== 'local';
  const isLocalRunner = !isRemoteRunner;
  const needsTunnel = frontendIsRemote && actualPort && currentProject?.devServerStatus === 'running' && !currentProject?.tunnelUrl;

  // Auto-create tunnel when remote frontend detects server started (only once per server start)
  const hasAutoStartedTunnel = useRef(false);

  useEffect(() => {
    // Reset flag when server stops
    if (currentProject?.devServerStatus !== 'running') {
      hasAutoStartedTunnel.current = false;
    }

    // Debug auto-tunnel logic (disabled in production)
    if (DEBUG_PREVIEW) {
      console.log('[PreviewPanel] Auto-tunnel check:', {
        needsTunnel,
        onStartTunnel: !!onStartTunnel,
        isStartingTunnel,
        hasAutoStarted: hasAutoStartedTunnel.current,
        willCreate: needsTunnel && onStartTunnel && !isStartingTunnel && !hasAutoStartedTunnel.current
      });
    }

    // Auto-start tunnel when:
    // - Remote frontend (Railway)
    // - Server just started
    // - No tunnel exists
    // - Haven't already auto-started for this server session
    // - WebSocket proxy is NOT enabled (if WS proxy is on, we don't need Cloudflare tunnel)
    if (needsTunnel && onStartTunnel && !isStartingTunnel && !hasAutoStartedTunnel.current && !USE_WS_PROXY) {
      console.log('🔗 Remote frontend detected - auto-creating tunnel...');
      hasAutoStartedTunnel.current = true;
      onStartTunnel();
    }
  }, [needsTunnel, onStartTunnel, isStartingTunnel, currentProject?.devServerStatus]);

  // Construct preview URL - ALWAYS use proxy route for script injection
  // Proxy will intelligently route to tunnel (remote) or localhost (local)
  // This ensures selection mode works in all scenarios

  // For remote frontend: Only show preview if tunnel exists OR is being created OR WS proxy enabled
  // For local frontend: Always show (can access localhost)
  const canShowPreview = actualPort && currentProject?.devServerStatus === 'running' && currentProject?.id &&
    (!frontendIsRemote || currentProject?.tunnelUrl || isTunnelLoading || USE_WS_PROXY);
    // Show if: Local frontend (always) OR tunnel exists OR tunnel being created OR WS proxy enabled

  // Debug logging
  if (DEBUG_PREVIEW && currentProject?.devServerStatus === 'running') {
    console.log('[PreviewPanel] Can show preview?', {
      canShowPreview,
      actualPort,
      devServerStatus: currentProject?.devServerStatus,
      frontendIsRemote,
      tunnelUrl: currentProject?.tunnelUrl,
      isTunnelLoading,
      needsTunnel,
    });
  }

  // Determine preview URL based on frontend location
  // - Local frontend: Use proxy (works with localhost runner)
  // - Remote frontend + tunnel: Use tunnel directly (proxy can't reach tunnel)
  const basePreviewUrl = canShowPreview
    ? (frontendIsRemote && verifiedTunnelUrl
        ? verifiedTunnelUrl
        : `/api/projects/${currentProject.id}/proxy?path=/`)
    : '';

  // During follow-up builds, keep showing the last working preview URL
  // This prevents the loading animation from showing when server status temporarily changes
  if (basePreviewUrl) {
    lastPreviewUrlRef.current = basePreviewUrl;
  }
  
  // Use last known preview URL during builds to keep iframe visible
  const baseUrl = basePreviewUrl || (isBuildActive ? lastPreviewUrlRef.current : '');
  
  // Add cache-bust parameter to force reload (bypass browser cache)
  const previewUrl = baseUrl 
    ? (baseUrl.includes('?') 
        ? `${baseUrl}&_cb=${cacheBust}` 
        : `${baseUrl}${cacheBust ? `?_cb=${cacheBust}` : ''}`)
    : '';

  // Note on URL strategy:
  // - Local frontend: Always use proxy (fetches from localhost runner)
  // - Remote frontend without tunnel: Use proxy (will wait for tunnel)
  // - Remote frontend with tunnel: Use tunnel directly (different networks)


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
    // Auto-refresh iframe when build completes
    if (prevBuildActiveRef.current && !isBuildActive && previewUrl) {
      if (DEBUG_PREVIEW) console.log('[PreviewPanel] Build completed - auto-refreshing iframe');
      // Small delay to ensure all file writes are flushed
      setTimeout(() => {
        handleRefresh();
      }, 500);
    }
    prevBuildActiveRef.current = isBuildActive;
  }, [isBuildActive, previewUrl, handleRefresh]);

  const handleCopyUrl = async () => {
    // Copy the actual URL - prefer tunnel if available, otherwise localhost
    const url = verifiedTunnelUrl || currentProject?.tunnelUrl || `http://localhost:${actualPort}`;

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
                      {verifiedTunnelUrl || currentProject?.tunnelUrl || `http://localhost:${actualPort}`}
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
                    {verifiedTunnelUrl || currentProject?.tunnelUrl || `http://localhost:${actualPort}`}
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
                {/* Open Tunnel URL */}
                {verifiedTunnelUrl && (
                  <button
                    onClick={() => window.open(verifiedTunnelUrl, '_blank')}
                    className="p-1.5 rounded-md hover:bg-blue-500/20 transition-all duration-200 group"
                    title="Open tunnel URL in new tab"
                  >
                    <Cloud className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
                  </button>
                )}

                {/* Open Localhost */}
                {actualPort && (
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

        {/* Right controls - Server/Tunnel buttons - Only show when build is complete */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Only show server controls when project is completed (not building) and has a run command */}
          {currentProject?.runCommand && currentProject?.status === 'completed' && !isBuildActive && (
            <>
              {currentProject.devServerStatus === 'running' ? (
                <>
                  {/* Tunnel Controls */}
                  {currentProject.tunnelUrl ? (
                    <button
                      onClick={onStopTunnel}
                      disabled={isStoppingTunnel}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/40 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Stop Cloudflare tunnel"
                    >
                      <Square className={`w-3.5 h-3.5 ${isStoppingTunnel ? 'animate-pulse' : ''}`} />
                      {isStoppingTunnel ? 'Stopping...' : 'Stop Tunnel'}
                    </button>
                  ) : (
                    <button
                      onClick={onStartTunnel}
                      disabled={isStartingTunnel}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Start Cloudflare tunnel for public access"
                    >
                      <Cloud className={`w-3.5 h-3.5 ${isStartingTunnel ? 'animate-pulse' : ''}`} />
                      {isStartingTunnel ? 'Starting...' : 'Start Tunnel'}
                    </button>
                  )}
                  {/* Stop Server Button */}
                  <button
                    onClick={onStopServer}
                    disabled={isStoppingServer}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#FF45A8]/20 hover:bg-[#FF45A8]/30 text-[#FF45A8] border border-[#FF45A8]/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Square className={`w-3.5 h-3.5 ${isStoppingServer ? 'animate-pulse' : ''}`} />
                    {isStoppingServer ? 'Stopping...' : 'Stop'}
                  </button>
                </>
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
        {previewUrl || isTunnelLoading || dnsTroubleshooting ? (
          <>
            {/* DNS Troubleshooting overlay */}
            {dnsTroubleshooting && (
              <div className="absolute inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center z-20 p-6">
                <div className="max-w-lg w-full bg-card rounded-xl p-8 space-y-6 border border-border">
                  <div className="text-center space-y-2">
                    <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                      <Cloud className="w-8 h-8 text-orange-400" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground">DNS Resolution Issue</h3>
                    <p className="text-sm text-muted-foreground">
                      Your browser's DNS cache is preventing the tunnel from loading. Follow these steps to resolve:
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Step 1: Run DNS flush commands */}
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-semibold">1</div>
                        <p className="text-sm font-medium text-foreground">Run these commands in Terminal</p>
                      </div>

                      <div className="relative group">
                        <code className="block bg-muted rounded px-3 py-2 text-xs font-mono text-foreground whitespace-pre overflow-x-auto">
                          sudo dscacheutil -flushcache{'\n'}sudo killall -HUP mDNSResponder
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText('sudo dscacheutil -flushcache\nsudo killall -HUP mDNSResponder');
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="absolute right-2 top-2 p-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Copy commands"
                        >
                          {copied ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-blue-400" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Paste this in Terminal and press Enter
                      </p>
                    </div>

                    {/* Step 2: Reload page */}
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-semibold">2</div>
                        <p className="text-sm font-medium text-foreground">Reload the page</p>
                      </div>

                      <button
                        onClick={() => {
                          // Reload iframe only (not full page)
                          setDnsTroubleshooting(false);
                          setKey(prev => prev + 1); // Force iframe reload
                          setDnsVerificationAttempt(0);
                          // Re-run verification
                          if (currentProject?.tunnelUrl) {
                            lastTunnelUrlRef.current = null;
                            setVerifiedTunnelUrl(null);
                            setIsTunnelLoading(true);
                          }
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 rounded-lg transition-colors font-medium"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Reload Preview
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    After running the DNS commands, click "Reload Preview" to retry the tunnel connection.
                  </p>
                </div>
              </div>
            )}

            {/* Tunnel loading overlay with attempt counter */}
            {isTunnelLoading && !dnsTroubleshooting && (
              <div className="absolute inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center z-20 p-6">
                <div className="max-w-md w-full">
                  <TunnelConnecting 
                    status="connecting"
                    port={actualPort || undefined}
                  />
                  {dnsVerificationAttempt > 0 && (
                    <p className="text-xs text-muted-foreground text-center mt-3">
                      DNS verification attempt {dnsVerificationAttempt}/10...
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Loading indicator overlay */}
            {isRefreshing && !isTunnelLoading && (
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
              <BuildingAppSkeleton />
            ) : currentProject?.devServerStatus === 'restarting' ? (
              <div className="flex flex-col items-center gap-4 max-w-lg px-6">
                <ServerRestartProgress 
                  projectName={currentProject.name}
                  port={currentProject.devServerPort || undefined}
                  hasTunnel={!!currentProject.tunnelUrl}
                />
              </div>
            ) : currentProject?.devServerStatus === 'starting' || isStartingServer ? (
              <div className="flex flex-col items-center gap-4 max-w-lg px-6">
                <ServerRestarting 
                  phase="starting"
                  projectName={currentProject?.name}
                  port={currentProject?.devServerPort || undefined}
                  hasTunnel={frontendIsRemote}
                />
              </div>
            ) : frontendIsRemote && actualPort && currentProject?.devServerStatus === 'running' && !currentProject?.tunnelUrl ? (
              <div className="text-center space-y-4 max-w-md px-6">
                <div className="flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Cloud className="w-8 h-8 text-blue-400" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-foreground">Tunnel Disconnected</h3>
                  <p className="text-muted-foreground text-sm">
                    Server is running on <span className="font-mono text-foreground">localhost:{actualPort}</span> but tunnel was stopped.
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Restart tunnel to access remotely:
                  </p>
                </div>
                <button
                  onClick={onStartTunnel}
                  disabled={isStartingTunnel}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 rounded-lg transition-colors mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Cloud className={`w-5 h-5 ${isStartingTunnel ? 'animate-pulse' : ''}`} />
                  {isStartingTunnel ? 'Starting Tunnel...' : 'Restart Tunnel'}
                </button>
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
