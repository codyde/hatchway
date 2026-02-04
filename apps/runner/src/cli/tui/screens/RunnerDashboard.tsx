/**
 * RunnerDashboard - Main TUI container for the runner
 * 
 * Layout:
 * - 20% left: BuildPanel (current build + todos) - hidden when no build
 * - 80% right: LogPanel (scrollable logs)
 * - Bottom: StatusBar (connection, shortcuts)
 * 
 * Views:
 * - dashboard: Main split view
 * - fullLog: Full-screen log view with search
 * - copyMenu: Copy options modal overlay
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useStdout, useApp } from 'ink';
import { colors } from '../theme.js';
import { BuildPanel } from '../components/BuildPanel.js';
import { LogPanel } from '../components/LogPanel.js';
import { StatusBar } from '../components/StatusBar.js';
import { FullLogView } from '../components/FullLogView.js';
import { CopyMenu } from '../components/CopyMenu.js';
import { useBuildState, useLogEntries } from '../hooks/useBuildState.js';
import { Banner } from '../components/Banner.js';
import type { BuildInfo, TodoItem, LogEntry } from '../../../lib/logging/types.js';
import { getLogBuffer } from '../../../lib/logging/log-buffer.js';
import { openBrowser } from '../../utils/cli-auth.js';

type ViewMode = 'dashboard' | 'fullLog' | 'copyMenu';

export interface RunnerDashboardProps {
  // Initial config (passed from runner)
  config: {
    runnerId: string;
    serverUrl: string;
    workspace: string;
    apiUrl?: string;
  };
  // Event handlers
  onQuit?: () => void;
}

export function RunnerDashboard({ config, onQuit }: RunnerDashboardProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // State management
  const [buildState, buildActions] = useBuildState();
  const logEntries = useLogEntries(100);
  const [view, setView] = useState<ViewMode>('dashboard');
  
  // Track if we've opened browser on first connection
  const hasOpenedBrowserRef = useRef(false);

  // Get the dashboard URL (use apiUrl if provided, otherwise default to hatchway.sh)
  const dashboardUrl = config.apiUrl || 'https://hatchway.sh';

  // Open browser handler
  const handleOpenBrowser = useCallback(() => {
    openBrowser(dashboardUrl).catch(() => {
      // Silently fail - user can manually open the URL
    });
  }, [dashboardUrl]);

  // Auto-open browser on first successful connection
  useEffect(() => {
    if (buildState.isConnected && !hasOpenedBrowserRef.current) {
      hasOpenedBrowserRef.current = true;
      // Small delay to ensure the TUI is fully rendered before opening browser
      setTimeout(() => {
        handleOpenBrowser();
      }, 500);
    }
  }, [buildState.isConnected, handleOpenBrowser]);

  // Handle keyboard input
  useInput((input, key) => {
    // Global quit handler
    if (input === 'q' && view !== 'copyMenu') {
      if (onQuit) {
        onQuit();
      }
      exit();
      return;
    }

    // Copy menu is modal - handle separately
    if (view === 'copyMenu') {
      return; // CopyMenu handles its own input
    }

    // Dashboard shortcuts
    if (view === 'dashboard') {
      if (input === 'v') {
        buildActions.toggleVerbose();
      } else if (input === 'c') {
        setView('copyMenu');
      } else if (input === 't') {
        setView('fullLog');
      } else if (input === 'n') {
        buildActions.nextBuild();
      } else if (input === 'p') {
        buildActions.prevBuild();
      } else if (input === 'b') {
        handleOpenBrowser();
      }
    }

    // Full log view shortcuts
    if (view === 'fullLog') {
      if (input === 't') {
        setView('dashboard');
      } else if (input === 'c') {
        setView('copyMenu');
      }
    }
  });

  // Handle copy action
  const handleCopy = useCallback(async (option: 'visible' | 'last50' | 'last100' | 'all' | 'range') => {
    try {
      const buffer = getLogBuffer();
      let entriesToCopy: LogEntry[] = [];

      switch (option) {
        case 'visible':
          entriesToCopy = logEntries.slice(-20); // Approximate visible count
          break;
        case 'last50':
          entriesToCopy = buffer.getRecent(50);
          break;
        case 'last100':
          entriesToCopy = buffer.getRecent(100);
          break;
        case 'all':
          entriesToCopy = buffer.readFromFile();
          break;
        case 'range':
          // TODO: Implement range selection
          entriesToCopy = buffer.getRecent(100);
          break;
      }

      const text = buffer.toText(entriesToCopy);
      
      // Copy to clipboard using pbcopy on macOS
      const { spawn } = await import('child_process');
      const pbcopy = spawn('pbcopy');
      pbcopy.stdin.write(text);
      pbcopy.stdin.end();
      
      // TODO: Show success message
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }

    setView('dashboard');
  }, [logEntries]);

  // Calculate panel dimensions
  const bannerHeight = 7; // ASCII art banner
  const headerHeight = 3; // Config/status line
  const statusBarHeight = 3;
  const contentHeight = Math.max(1, terminalHeight - bannerHeight - headerHeight - statusBarHeight);
  
  // 20/80 split
  const buildPanelWidth = Math.floor(terminalWidth * 0.2);
  const logPanelWidth = terminalWidth - buildPanelWidth;

  // Show build panel only when there's an active build
  const showBuildPanel = buildState.currentBuild !== null;

  // Check for available update (set by auto-update check in index.ts)
  const updateAvailable = process.env.HATCHWAY_UPDATE_AVAILABLE;

  return (
    <Box flexDirection="column" height={terminalHeight} width={terminalWidth}>
      {/* Banner */}
      <Banner />

      {/* Update notification banner */}
      {updateAvailable && (
        <Box justifyContent="center" paddingY={0}>
          <Text color={colors.cyan}>⬆ Update available: </Text>
          <Text color={colors.success}>{updateAvailable}</Text>
          <Text color={colors.dimGray}> — Run </Text>
          <Text color={colors.cyan}>hatchway upgrade</Text>
          <Text color={colors.dimGray}> to update</Text>
        </Box>
      )}

      {/* Header bar with connection status */}
      <Box
        borderStyle="single"
        borderColor={colors.darkGray}
        paddingX={1}
        justifyContent="space-between"
      >
        <Text color={colors.dimGray}>
          Runner: <Text color={colors.cyan}>{config.runnerId}</Text> • Server: <Text color={colors.cyan}>{config.serverUrl.replace(/^wss?:\/\//, '')}</Text>
        </Text>
        <Box>
          <Text color={buildState.isConnected ? colors.success : colors.error}>
            {buildState.isConnected ? '●' : '○'}
          </Text>
          <Text color={colors.gray}>
            {' '}{buildState.isConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </Box>
      </Box>

      {/* Main content */}
      {view === 'dashboard' && (
        <Box flexGrow={1} height={contentHeight}>
          {showBuildPanel && (
            <BuildPanel
              build={buildState.currentBuild}
              width={buildPanelWidth}
              height={contentHeight}
            />
          )}
          <LogPanel
            entries={logEntries}
            isVerbose={buildState.isVerbose}
            width={showBuildPanel ? logPanelWidth : terminalWidth}
            height={contentHeight}
            isFocused={true}
          />
        </Box>
      )}

      {view === 'fullLog' && (
        <FullLogView
          entries={logEntries}
          onBack={() => setView('dashboard')}
          onCopy={() => setView('copyMenu')}
        />
      )}

      {/* Copy menu overlay */}
      {view === 'copyMenu' && (
        <Box
          position="absolute"
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          width={terminalWidth}
          height={terminalHeight}
        >
          <CopyMenu
            onSelect={handleCopy}
            onCancel={() => setView('dashboard')}
            visibleCount={Math.min(20, logEntries.length)}
            totalCount={getLogBuffer().readFromFile().length}
          />
        </Box>
      )}

      {/* Status bar (only in dashboard view) */}
      {view === 'dashboard' && (
        <StatusBar
          isConnected={buildState.isConnected}
          isVerbose={buildState.isVerbose}
          buildCount={buildState.builds.length}
          currentBuildIndex={buildState.currentBuildIndex}
          view={view}
        />
      )}
    </Box>
  );
}

// Export for external use
export { useBuildState, useLogEntries };
