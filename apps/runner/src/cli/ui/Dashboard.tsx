/**
 * Main TUI Dashboard Component for Local Mode
 * Redesigned to match Runner Mode UI style with split panel layout
 * Supports dynamic theming that changes TUI colors
 * Shows BUILD panel when there's an active build (with todos)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { exec } from 'child_process';
import { platform } from 'os';
import { ServiceManager, ServiceState } from './service-manager.js';
import { Banner } from './components/Banner.js';
import { useBuildState } from '../tui/hooks/useBuildState.js';
import { BuildPanel } from '../tui/components/BuildPanel.js';
import { configManager, type ThemeName } from '../utils/config-manager.js';

// Base colors that don't change with theme
const baseColors = {
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  cyan: '#06b6d4',
  white: '#ffffff',
  gray: '#6b7280',
  dimGray: '#4b5563',
  darkGray: '#374151',
};

const symbols = {
  filledDot: '●',
  hollowDot: '○',
  check: '✓',
  cross: '✗',
  spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

// Theme definitions (matching web app themes)

interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;      // Used for highlights, borders
  muted: string;       // Dimmed version of primary
}

interface ThemeInfo {
  name: ThemeName;
  label: string;
  description: string;
  colors: ThemeColors;
}

const THEMES: Record<ThemeName, ThemeInfo> = {
  sentry: {
    name: 'sentry',
    label: 'Sentry',
    description: 'Purple-pink gradient',
    colors: { 
      primary: '#a855f7', 
      secondary: '#ec4899',
      accent: '#c084fc',
      muted: '#7c3aed',
    },
  },
  ocean: {
    name: 'ocean',
    label: 'Ocean',
    description: 'Cool blue & teal',
    colors: { 
      primary: '#3b82f6', 
      secondary: '#22d3ee',
      accent: '#60a5fa',
      muted: '#2563eb',
    },
  },
  ember: {
    name: 'ember',
    label: 'Ember',
    description: 'Warm orange & red',
    colors: { 
      primary: '#f97316', 
      secondary: '#ef4444',
      accent: '#fb923c',
      muted: '#ea580c',
    },
  },
  forest: {
    name: 'forest',
    label: 'Forest',
    description: 'Green & earth tones',
    colors: { 
      primary: '#10b981', 
      secondary: '#84cc16',
      accent: '#34d399',
      muted: '#059669',
    },
  },
  noir: {
    name: 'noir',
    label: 'Noir',
    description: 'Monochrome dark',
    colors: { 
      primary: '#ffffff', 
      secondary: '#a1a1aa',
      accent: '#e4e4e7',
      muted: '#71717a',
    },
  },
};

const THEME_ORDER: ThemeName[] = ['sentry', 'ocean', 'ember', 'forest', 'noir'];

interface DashboardProps {
  serviceManager: ServiceManager;
  apiUrl: string;
  webPort: number;
  logFilePath: string | null;
}

type ViewMode = 'dashboard' | 'help' | 'fullLog' | 'themeSelector';
type FilterMode = 'all' | 'errors' | 'tools' | 'verbose';

interface LogEntry {
  id: string;
  timestamp: Date;
  service: string;
  message: string;
  stream: 'stdout' | 'stderr';
  level: 'info' | 'success' | 'warn' | 'error';
  tag?: string;
  emoji?: string;
  toolName?: string;
  content?: string;
  isInternal?: boolean;
  displayMessage?: string; // User-friendly transformed message
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getLogLevel(message: string, stream: 'stdout' | 'stderr'): 'info' | 'success' | 'warn' | 'error' {
  if (stream === 'stderr') return 'warn';
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) return 'error';
  if (lower.includes('warn') || lower.includes('warning')) return 'warn';
  if (lower.includes('success') || lower.includes('ready') || lower.includes('started') || lower.includes('connected') || lower.includes('✅') || lower.includes('✓')) return 'success';
  return 'info';
}

/**
 * Determines if a log message is internal/debug and should be hidden by default.
 * These are implementation details that aren't useful for end users.
 */
function isInternalLog(message: string): boolean {
  const internalPatterns = [
    // Internal broadcasting/event system
    /Broadcasting/i,
    /Event emitted/i,
    /📡.*Broadcasting/,
    // Session/ID tracking details
    /sessionId=/,
    /todoIndex=/,
    /buildId=/,
    /commandId=/,
    // Internal processor notes
    /NOTE:.*DB writes/,
    /NOTE:.*HTTP/,
    /Registering build.*for WebSocket/,
    // Verbose implementation details
    /from database\)/,
    /immutable/,
    /\(waiting for runner/,
    // Duplicate/skip messages
    /Skipping duplicate/,
    // Internal state
    /SSE stream closed/,
    /persistent processor continues/,
    // Cost/optimization notes (internal)
    /Cost savings:/,
  ];
  
  return internalPatterns.some(pattern => pattern.test(message));
}

/**
 * Transforms a raw log message into a user-friendly format.
 * Extracts meaningful information and presents it clearly.
 */
function transformLogMessage(message: string): { display: string; isUserFacing: boolean; toolAction?: string } {
  // NEW FORMAT: Server now logs "🔧 Edit: /path/to/file.ts" or "🔧 Run: npm install"
  // Match: 🔧 Action: details
  const newToolFormat = message.match(/🔧\s*(Read|Edit|Write|Run|Find|Search|Fetch|Update tasks):\s*(.+)/i);
  if (newToolFormat) {
    const action = newToolFormat[1];
    const detail = newToolFormat[2].trim();
    return { display: `${action}: ${detail}`, isUserFacing: true, toolAction: action };
  }
  
  // Also match bare tool names for backwards compat: "🔧 Read" (no colon/details)
  const bareToolMatch = message.match(/^🔧\s*(Read|Edit|Write|Bash|Glob|Grep|WebFetch|TodoWrite)$/i);
  if (bareToolMatch) {
    return { display: bareToolMatch[1], isUserFacing: true, toolAction: bareToolMatch[1] };
  }
  
  // OLD FORMAT: Tool calls with parentheses like "🔧 Read (todoIndex=..."
  // Try to extract any useful info
  const oldToolFormat = message.match(/🔧\s*(Read|Edit|Write|Bash|Glob|Grep)\s*\(/i);
  if (oldToolFormat) {
    const toolName = oldToolFormat[1];
    // Try to extract file path from the message
    const pathMatch = message.match(/(?:path|file)[:=]\s*["']?([^"'\s,)]+)/i);
    const cmdMatch = message.match(/(?:command|cmd)[:=]\s*["']?([^"'\n]+)/i);
    
    if (toolName.toLowerCase() === 'bash' && cmdMatch) {
      const cmd = cmdMatch[1].trim().substring(0, 50);
      return { display: `Run: ${cmd}${cmdMatch[1].length > 50 ? '...' : ''}`, isUserFacing: true, toolAction: 'Run' };
    } else if (pathMatch) {
      return { display: `${toolName}: ${pathMatch[1]}`, isUserFacing: true, toolAction: toolName };
    }
    // No details found, just show the tool name
    return { display: toolName, isUserFacing: true, toolAction: toolName };
  }
  
  // Template/framework selection - always show
  const templateMatch = message.match(/Template (?:selected|from tag):\s*(.+)/i);
  if (templateMatch) {
    return { display: `Using template: ${templateMatch[1]}`, isUserFacing: true };
  }
  
  const frameworkMatch = message.match(/Framework.*?:\s*(\w+)/i);
  if (frameworkMatch && !message.includes('emit')) {
    return { display: `Framework: ${frameworkMatch[1]}`, isUserFacing: true };
  }
  
  // Build start
  if (message.includes('start event received') || message.includes('build-started')) {
    return { display: 'Build started', isUserFacing: true };
  }
  
  // Build complete
  if (message.includes('marked complete') || message.includes('Build complete')) {
    return { display: 'Build complete', isUserFacing: true };
  }
  
  // Agent selection - clean it up
  const agentMatch = message.match(/(?:Using agent|Agent).*?:\s*(\S+)/i);
  if (agentMatch && !message.includes('NOTE:')) {
    return { display: `Agent: ${agentMatch[1].replace(/[()]/g, '')}`, isUserFacing: true };
  }
  
  // Generic success messages
  if (message.includes('✅') && !isInternalLog(message)) {
    // Clean up the message
    const cleaned = message.replace(/\[[\w-]+\]\s*/g, '').replace(/✅\s*/, '').trim();
    if (cleaned.length > 10) {
      return { display: cleaned, isUserFacing: true };
    }
  }
  
  // Default: not user-facing if it's internal
  return { display: message, isUserFacing: !isInternalLog(message) };
}

function parseLogMessage(message: string): { tag?: string; emoji?: string; toolName?: string; content: string; isInternal: boolean } {
  let tag: string | undefined;
  let emoji: string | undefined;
  let toolName: string | undefined;
  let content = message;

  const tagMatch = content.match(/^\[([^\]]+)\]\s*/);
  if (tagMatch) {
    tag = tagMatch[1];
    content = content.substring(tagMatch[0].length);
  }

  const emojiMatch = content.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|✅|✓|📜|📤|🔧|📡|⚠️|❌)\s*/u);
  if (emojiMatch) {
    emoji = emojiMatch[1];
    content = content.substring(emojiMatch[0].length);
  }

  const toolMatch = content.match(/^tool-input-available:\s*(\w+)/i);
  if (toolMatch) {
    toolName = toolMatch[1];
    emoji = '🔧';
  }
  
  // Also detect tool calls in format: "🔧 ToolName (..."
  const toolCallMatch = content.match(/^(Read|Edit|Write|Bash|Glob|Grep|TodoWrite)\s*\(/i);
  if (toolCallMatch) {
    toolName = toolCallMatch[1];
    emoji = '🔧';
  }

  return { tag, emoji, toolName, content: content.trim(), isInternal: isInternalLog(message) };
}

function openBrowser(url: string): void {
  const os = platform();
  let command: string;
  
  if (os === 'darwin') {
    command = `open "${url}"`;
  } else if (os === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }
  
  exec(command, () => {});
}

export function Dashboard({ serviceManager, apiUrl, webPort, logFilePath }: DashboardProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [view, setView] = useState<ViewMode>('dashboard');
  const [services, setServices] = useState<ServiceState[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isVerbose, setIsVerbose] = useState(false);
  const [logIdCounter, setLogIdCounter] = useState(0);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [fullLogSearchMode, setFullLogSearchMode] = useState(false);
  const [fullLogSearchQuery, setFullLogSearchQuery] = useState('');
  const [fullLogScrollOffset, setFullLogScrollOffset] = useState(0);
  
  // Theme state - load from config, default to 'sentry'
  const savedTheme = configManager.get('ui')?.theme as ThemeName | undefined;
  const [selectedTheme, setSelectedTheme] = useState<ThemeName>(savedTheme || 'sentry');
  const [previewTheme, setPreviewTheme] = useState<ThemeName | null>(null);
  const [themeBeforePreview, setThemeBeforePreview] = useState<ThemeName | null>(null);
  
  // Build state - tracks active builds and todos from the RunnerLogger
  const [buildState] = useBuildState();

  // Get current theme colors - use preview theme if active, otherwise selected theme
  const activeThemeName = previewTheme || selectedTheme;
  const theme = THEMES[activeThemeName];
  const themeColors = useMemo(() => ({
    primary: theme.colors.primary,
    secondary: theme.colors.secondary,
    accent: theme.colors.accent,
    muted: theme.colors.muted,
    // Map to semantic colors
    highlight: theme.colors.primary,
    border: theme.colors.muted,
    text: baseColors.white,
    textDim: baseColors.gray,
    textMuted: baseColors.dimGray,
  }), [theme]);

  const terminalHeight = stdout?.rows || 40;
  const terminalWidth = stdout?.columns || 80;
  
  const bannerHeight = 7;
  const headerHeight = 3;
  const statusBarHeight = 3;
  const contentHeight = Math.max(1, terminalHeight - bannerHeight - headerHeight - statusBarHeight);
  
  // Show build panel only when there's an active build
  const showBuildPanel = buildState.currentBuild !== null;
  
  // 20/80 split when build panel is shown, otherwise full width
  const buildPanelWidth = Math.floor(terminalWidth * 0.2);
  const logPanelWidth = showBuildPanel ? terminalWidth - buildPanelWidth : terminalWidth;

  const allServicesRunning = useMemo(() => {
    return services.length > 0 && services.every(s => s.status === 'running');
  }, [services]);

  useEffect(() => {
    const handleStatusChange = () => {
      setServices(serviceManager.getAllStates());
    };
    setServices(serviceManager.getAllStates());
    serviceManager.on('service:status-change', handleStatusChange);
    return () => {
      serviceManager.off('service:status-change', handleStatusChange);
    };
  }, [serviceManager]);

  useEffect(() => {
    const handleServiceOutput = (name: string, output: string, stream: 'stdout' | 'stderr') => {
      const lines = output.split('\n').filter(line => line.trim());
      
      setLogIdCounter(prev => {
        const newLogs: LogEntry[] = lines.map((line, idx) => {
          const trimmed = line.trim();
          const parsed = parseLogMessage(trimmed);
          const transformed = transformLogMessage(trimmed);
          return {
            id: `${Date.now()}-${prev + idx}`,
            timestamp: new Date(),
            service: name,
            message: trimmed,
            stream,
            level: getLogLevel(trimmed, stream),
            tag: parsed.tag,
            emoji: parsed.emoji,
            toolName: parsed.toolName,
            content: parsed.content,
            isInternal: parsed.isInternal,
            displayMessage: transformed.isUserFacing ? transformed.display : undefined,
          };
        });
        
        if (newLogs.length > 0) {
          setLogs(prevLogs => {
            const combined = [...prevLogs, ...newLogs];
            return combined.slice(-10000);
          });
        }
        
        return prev + lines.length;
      });
    };

    serviceManager.on('service:output', handleServiceOutput);
    return () => {
      serviceManager.off('service:output', handleServiceOutput);
    };
  }, [serviceManager]);

  const filteredLogs = useMemo(() => {
    let filtered = logs;
    
    // By default, hide internal/debug logs unless verbose mode is on
    if (!isVerbose) {
      filtered = filtered.filter(log => 
        !log.isInternal &&
        !log.message.toLowerCase().includes('debug') &&
        !log.message.toLowerCase().includes('trace')
      );
    }
    
    if (serviceFilter) {
      filtered = filtered.filter(log => log.service === serviceFilter);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(query) ||
        log.service.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [logs, serviceFilter, searchQuery, isVerbose]);

  const fullLogFilteredLogs = useMemo(() => {
    let filtered = logs;
    
    if (filterMode === 'errors') {
      filtered = filtered.filter(log => log.level === 'error' || log.level === 'warn');
    } else if (filterMode === 'tools') {
      filtered = filtered.filter(log => log.toolName || log.message.includes('tool-input'));
    } else if (filterMode === 'verbose') {
      // Show everything in verbose mode
    } else {
      // Default 'all' mode - hide internal logs
      filtered = filtered.filter(log => 
        !log.isInternal &&
        !log.message.toLowerCase().includes('debug') &&
        !log.message.toLowerCase().includes('trace')
      );
    }
    
    if (fullLogSearchQuery.trim()) {
      const query = fullLogSearchQuery.toLowerCase();
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(query) ||
        log.service.toLowerCase().includes(query) ||
        (log.tag && log.tag.toLowerCase().includes(query)) ||
        (log.toolName && log.toolName.toLowerCase().includes(query))
      );
    }
    
    return filtered;
  }, [logs, filterMode, fullLogSearchQuery]);

  const visibleLines = Math.max(1, contentHeight - 3);
  const fullLogVisibleLines = Math.max(1, terminalHeight - 6);
  
  useEffect(() => {
    if (autoScroll && filteredLogs.length > 0) {
      const maxScroll = Math.max(0, filteredLogs.length - visibleLines);
      setScrollOffset(maxScroll);
    }
  }, [filteredLogs.length, autoScroll, visibleLines]);

  useEffect(() => {
    if (view === 'fullLog') {
      const maxScroll = Math.max(0, fullLogFilteredLogs.length - fullLogVisibleLines);
      setFullLogScrollOffset(maxScroll);
    }
  }, [fullLogFilteredLogs.length, view, fullLogVisibleLines]);

  const displayedLogs = useMemo(() => {
    return filteredLogs.slice(scrollOffset, scrollOffset + visibleLines);
  }, [filteredLogs, scrollOffset, visibleLines]);

  const fullLogDisplayedLogs = useMemo(() => {
    return fullLogFilteredLogs.slice(fullLogScrollOffset, fullLogScrollOffset + fullLogVisibleLines);
  }, [fullLogFilteredLogs, fullLogScrollOffset, fullLogVisibleLines]);

  // Save theme to config and update state
  const saveTheme = (newTheme: ThemeName) => {
    setSelectedTheme(newTheme);
    setPreviewTheme(null);
    setThemeBeforePreview(null);
    // Persist to config
    configManager.set('ui', { theme: newTheme });
  };
  
  // Open theme selector
  const openThemeSelector = () => {
    setThemeBeforePreview(selectedTheme);
    setPreviewTheme(selectedTheme);
    setView('themeSelector');
  };
  
  // Cancel theme selection (revert to previous)
  const cancelThemeSelection = () => {
    setPreviewTheme(null);
    setThemeBeforePreview(null);
    setView('dashboard');
  };
  
  // Confirm theme selection
  const confirmThemeSelection = () => {
    if (previewTheme) {
      saveTheme(previewTheme);
    }
    setView('dashboard');
  };

  useInput((input, key) => {
    if (isShuttingDown) return;

    // Theme selector view
    if (view === 'themeSelector') {
      if (key.escape) {
        cancelThemeSelection();
        return;
      }
      if (key.return) {
        confirmThemeSelection();
        return;
      }
      if (key.upArrow && previewTheme) {
        const currentIndex = THEME_ORDER.indexOf(previewTheme);
        const prevIndex = (currentIndex - 1 + THEME_ORDER.length) % THEME_ORDER.length;
        setPreviewTheme(THEME_ORDER[prevIndex]);
        return;
      }
      if (key.downArrow && previewTheme) {
        const currentIndex = THEME_ORDER.indexOf(previewTheme);
        const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
        setPreviewTheme(THEME_ORDER[nextIndex]);
        return;
      }
      return;
    }

    // Help/Menu view
    if (view === 'help') {
      if (key.escape) {
        setView('dashboard');
        return;
      }
      if (input === 'b') {
        openBrowser(`http://localhost:${webPort}`);
        return;
      }
      if (input === 'q') {
        setIsShuttingDown(true);
        serviceManager.stopAll().then(() => exit());
        return;
      }
      return;
    }

    // Full log view mode
    if (view === 'fullLog') {
      if (fullLogSearchMode) {
        if (key.escape || key.return) {
          setFullLogSearchMode(false);
        }
        return;
      }

      if (key.escape) {
        setView('dashboard');
        return;
      }
      if (input === 'l' || input === 't') {
        setView('dashboard');
        return;
      }
      if (input === '/') {
        setFullLogSearchMode(true);
        return;
      }
      if (input === 'f') {
        const modes: FilterMode[] = ['all', 'errors', 'tools', 'verbose'];
        const currentIndex = modes.indexOf(filterMode);
        setFilterMode(modes[(currentIndex + 1) % modes.length]);
        setFullLogScrollOffset(0);
        return;
      }
      if (key.upArrow) {
        setFullLogScrollOffset(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        const maxScroll = Math.max(0, fullLogFilteredLogs.length - fullLogVisibleLines);
        setFullLogScrollOffset(prev => Math.min(maxScroll, prev + 1));
        return;
      }
      if (key.pageUp) {
        setFullLogScrollOffset(prev => Math.max(0, prev - fullLogVisibleLines));
        return;
      }
      if (key.pageDown) {
        const maxScroll = Math.max(0, fullLogFilteredLogs.length - fullLogVisibleLines);
        setFullLogScrollOffset(prev => Math.min(maxScroll, prev + fullLogVisibleLines));
        return;
      }
      if (input === 'q') {
        setIsShuttingDown(true);
        serviceManager.stopAll().then(() => exit());
        return;
      }
      if (input === 'b') {
        openBrowser(`http://localhost:${webPort}`);
        return;
      }
      return;
    }

    // Dashboard mode
    if (key.escape) {
      if (searchMode) {
        setSearchMode(false);
        setSearchQuery('');
      } else if (view !== 'dashboard') {
        setView('dashboard');
      }
      return;
    }

    if (searchMode) return;

    if (input === '/' && view === 'dashboard') {
      setSearchMode(true);
      setSearchQuery('');
      return;
    }

    // Ctrl+T to open theme selector
    if (key.ctrl && input === 't') {
      openThemeSelector();
      return;
    }

    if (input === 'q' || (key.ctrl && input === 'c')) {
      setIsShuttingDown(true);
      serviceManager.stopAll().then(() => exit());
    } else if (input === 'b') {
      openBrowser(`http://localhost:${webPort}`);
    } else if (input === 'v') {
      setIsVerbose(!isVerbose);
    } else if (input === 'r' && view === 'dashboard') {
      serviceManager.restartAll();
    } else if (input === 'c' && view === 'dashboard') {
      setLogs([]);
      setScrollOffset(0);
      setAutoScroll(true);
    } else if (input === 'l' || input === 't') {
      setView('fullLog');
      setFullLogScrollOffset(Math.max(0, fullLogFilteredLogs.length - fullLogVisibleLines));
    } else if (input === 'f') {
      setServiceFilter(current => {
        if (!current) return 'web';
        if (current === 'web') return 'runner';
        return null;
      });
    } else if (key.upArrow) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      const maxScroll = Math.max(0, filteredLogs.length - visibleLines);
      setScrollOffset(prev => Math.min(maxScroll, prev + 1));
      if (scrollOffset >= maxScroll - 1) {
        setAutoScroll(true);
      }
    } else if (key.pageUp) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.max(0, prev - visibleLines));
    } else if (key.pageDown) {
      const maxScroll = Math.max(0, filteredLogs.length - visibleLines);
      setScrollOffset(prev => Math.min(maxScroll, prev + visibleLines));
    } else if (input === '?') {
      setView('help');
    }
  });

  const highlightSearch = (text: string, query: string): React.ReactNode => {
    if (!query) return text;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return text;
    
    return (
      <>
        {text.slice(0, index)}
        <Text backgroundColor={baseColors.warning} color="black">
          {text.slice(index, index + query.length)}
        </Text>
        {text.slice(index + query.length)}
      </>
    );
  };

  // Full log view
  if (view === 'fullLog') {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box
          borderStyle="single"
          borderColor={themeColors.muted}
          paddingX={1}
          justifyContent="space-between"
        >
          <Text color={themeColors.primary} bold>LOGS</Text>
          <Box>
            <Text color={themeColors.textMuted}>Search: </Text>
            {fullLogSearchMode ? (
              <Box borderStyle="round" borderColor={themeColors.primary} paddingX={1}>
                <TextInput
                  value={fullLogSearchQuery}
                  onChange={setFullLogSearchQuery}
                  placeholder="type to search..."
                />
              </Box>
            ) : (
              <Text color={fullLogSearchQuery ? themeColors.text : themeColors.textMuted}>
                [{fullLogSearchQuery || 'none'}]
              </Text>
            )}
            <Text color={themeColors.textMuted}> [/]</Text>
          </Box>
        </Box>

        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor={themeColors.muted}
          borderTop={false}
          borderBottom={false}
          paddingX={1}
        >
          {fullLogDisplayedLogs.map((log) => (
            <FullLogEntryRow 
              key={log.id} 
              log={log} 
              maxWidth={terminalWidth - 4}
              searchQuery={fullLogSearchQuery}
              highlightSearch={highlightSearch}
              themeColors={themeColors}
            />
          ))}
        </Box>

        <Box
          borderStyle="single"
          borderColor={themeColors.muted}
          paddingX={1}
          justifyContent="space-between"
        >
          <Box>
            <Shortcut letter="l" label="dashboard" color={themeColors.primary} />
            <Shortcut letter="/" label="search" color={themeColors.primary} />
            <Shortcut letter="f" label={`filter: ${filterMode}`} color={themeColors.primary} />
            <Shortcut letter="b" label="browser" color={themeColors.primary} />
            <Shortcut letter="q" label="quit" color={themeColors.primary} />
          </Box>
          <Text color={themeColors.textMuted}>
            {fullLogScrollOffset + 1}-{Math.min(fullLogScrollOffset + fullLogVisibleLines, fullLogFilteredLogs.length)}/{fullLogFilteredLogs.length}
          </Text>
        </Box>
      </Box>
    );
  }

  // Theme Selector overlay
  if (view === 'themeSelector') {
    return (
      <Box flexDirection="column" height={terminalHeight} width={terminalWidth}>
        <Banner />
        
        {/* Centered theme selector box */}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Box
            flexDirection="column"
            borderStyle="double"
            borderColor={themeColors.primary}
            paddingX={3}
            paddingY={1}
            width={40}
          >
            <Box justifyContent="center" marginBottom={1}>
              <Text color={themeColors.primary} bold>Select Theme</Text>
            </Box>
            
            {THEME_ORDER.map((themeName) => {
              const t = THEMES[themeName];
              const isSelected = themeName === previewTheme;
              return (
                <Box key={themeName} paddingY={0}>
                  <Text color={isSelected ? t.colors.primary : themeColors.textMuted}>
                    {isSelected ? '▸ ' : '  '}
                  </Text>
                  <Text color={isSelected ? t.colors.primary : themeColors.textDim} bold={isSelected}>
                    {t.label}
                  </Text>
                  <Text color={themeColors.textMuted}> - {t.description}</Text>
                </Box>
              );
            })}
            
            <Box marginTop={1} justifyContent="center">
              <Text color={themeColors.textMuted}>
                <Text color={themeColors.primary}>↑↓</Text> navigate  
                <Text color={themeColors.primary}> Enter</Text> select  
                <Text color={themeColors.primary}> Esc</Text> cancel
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  // Help/Menu view
  if (view === 'help') {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Banner />
        <Box flexDirection="column" padding={2}>
          <Text color={themeColors.primary} bold>Help & Keyboard Shortcuts</Text>
          <Text> </Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>Ctrl+T</Text>    Change theme</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>b</Text>         Open in browser</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>l</Text>         Full log view</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>/</Text>         Search logs</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>f</Text>         Filter by service</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>v</Text>         Toggle verbose mode</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>r</Text>         Restart services</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>c</Text>         Clear logs</Text>
          <Text color={themeColors.textDim}>  <Text color={themeColors.primary}>q</Text>         Quit</Text>
          <Text> </Text>
          <Text color={themeColors.textMuted}>Current theme: <Text color={themeColors.primary}>{theme.label}</Text></Text>
          <Text> </Text>
          <Text color={themeColors.textMuted}>Press <Text color={themeColors.primary}>Esc</Text> to return to dashboard</Text>
        </Box>
      </Box>
    );
  }

  // Check for available update (set by auto-update check in index.ts)
  const updateAvailable = process.env.HATCHWAY_UPDATE_AVAILABLE;

  // Main dashboard view
  return (
    <Box flexDirection="column" height={terminalHeight} width={terminalWidth}>
      <Banner />

      {/* Update notification banner */}
      {updateAvailable && (
        <Box justifyContent="center" paddingY={0}>
          <Text color={baseColors.cyan}>⬆ Update available: </Text>
          <Text color={baseColors.success}>{updateAvailable}</Text>
          <Text color={themeColors.textMuted}> — Run </Text>
          <Text color={baseColors.cyan}>hatchway upgrade</Text>
          <Text color={themeColors.textMuted}> to update</Text>
        </Box>
      )}

      <Box
        borderStyle="single"
        borderColor={themeColors.muted}
        paddingX={1}
        justifyContent="space-between"
      >
        <Text color={themeColors.textMuted}>
          Web: <Text color={themeColors.primary}>localhost:{webPort}</Text>
          {' • '}
          Mode: <Text color={themeColors.primary}>Local</Text>
          {' • '}
          Theme: <Text color={themeColors.primary}>{theme.label}</Text>
        </Text>
        <Box>
          <Text color={allServicesRunning ? baseColors.success : baseColors.warning}>
            {allServicesRunning ? symbols.filledDot : symbols.hollowDot}
          </Text>
          <Text color={themeColors.textDim}>
            {' '}{allServicesRunning ? 'All Services Running' : 'Starting...'}
          </Text>
        </Box>
      </Box>

      <Box flexGrow={1} height={contentHeight}>
        {showBuildPanel && (
          <BuildPanel
            build={buildState.currentBuild}
            width={buildPanelWidth}
            height={contentHeight}
          />
        )}
        <Box
          flexDirection="column"
          width={logPanelWidth}
          height={contentHeight}
          borderStyle="single"
          borderColor={themeColors.muted}
          paddingX={1}
        >
          <Box justifyContent="space-between" marginBottom={0}>
            <Text color={themeColors.primary} bold>LOGS</Text>
            <Box>
              {serviceFilter && (
                <Text color={themeColors.textMuted}>filter: <Text color={baseColors.warning}>{serviceFilter}</Text>  </Text>
              )}
              <Text color={themeColors.textMuted}>
                [verbose: {isVerbose ? 'on' : 'off'}]
              </Text>
            </Box>
          </Box>

          <Box flexDirection="column" flexGrow={1}>
            {displayedLogs.length === 0 ? (
              <Box justifyContent="center" alignItems="center" flexGrow={1}>
                <Text color={themeColors.textMuted}>Waiting for logs...</Text>
              </Box>
            ) : (
              displayedLogs.map((log) => (
                <LogEntryRow key={log.id} log={log} maxWidth={logPanelWidth - 4} themeColors={themeColors} />
              ))
            )}
          </Box>

          {filteredLogs.length > visibleLines && (
            <Box justifyContent="flex-end">
              <Text color={themeColors.textMuted}>
                {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, filteredLogs.length)}/{filteredLogs.length}
                {autoScroll ? ' (auto)' : ''}
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box
        borderStyle="single"
        borderColor={themeColors.muted}
        paddingX={1}
        justifyContent="space-between"
      >
        <Box>
          <Text color={allServicesRunning ? baseColors.success : baseColors.warning}>
            {allServicesRunning ? symbols.filledDot : symbols.hollowDot}
          </Text>
          <Text color={themeColors.textDim}>
            {' '}{isShuttingDown ? 'Shutting down...' : allServicesRunning ? 'Ready' : 'Starting'}
          </Text>
        </Box>
        
        {searchMode ? (
          <Box>
            <Text color={themeColors.primary}>/</Text>
            <TextInput
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={() => setSearchMode(false)}
              placeholder="Search... (Enter to apply, Esc to cancel)"
            />
          </Box>
        ) : (
          <Box>
            <Shortcut letter="b" label="browser" color={themeColors.primary} />
            <Shortcut letter="l" label="logs" color={themeColors.primary} />
            <Shortcut letter="/" label="search" color={themeColors.primary} />
            <Shortcut letter="?" label="menu" color={themeColors.primary} />
            <Shortcut letter="q" label="quit" color={themeColors.primary} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface ThemeColorsType {
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  highlight: string;
  border: string;
  text: string;
  textDim: string;
  textMuted: string;
}

function LogEntryRow({ log, maxWidth, themeColors }: { 
  log: LogEntry, 
  maxWidth: number,
  themeColors: ThemeColorsType
}) {
  const levelColors = {
    info: themeColors.primary,
    success: baseColors.success,
    warn: baseColors.warning,
    error: baseColors.error,
  };

  const levelIcons = {
    info: symbols.filledDot,
    success: symbols.check,
    warn: '⚠',
    error: symbols.cross,
  };

  const serviceColor = log.service === 'web' ? themeColors.primary : themeColors.secondary;
  const icon = log.emoji || levelIcons[log.level];
  const color = levelColors[log.level];
  
  // Use displayMessage if available (user-friendly transformed message)
  let displayContent = log.displayMessage || log.content || log.message;
  const availableWidth = maxWidth - 16;
  const truncatedMessage = displayContent.length > availableWidth
    ? displayContent.substring(0, availableWidth - 3) + '...'
    : displayContent;

  // Tool calls get special formatting
  if (log.toolName) {
    // If we have a displayMessage, use it (it's already user-friendly)
    if (log.displayMessage) {
      return (
        <Box>
          <Text color={themeColors.textMuted}>{formatTime(log.timestamp)}</Text>
          <Text color={serviceColor}> [{log.service.substring(0, 3)}]</Text>
          <Text color={themeColors.primary}> 🔧 </Text>
          <Text color={themeColors.text}>{log.displayMessage}</Text>
        </Box>
      );
    }
    // Fallback to showing tool name
    return (
      <Box>
        <Text color={themeColors.textMuted}>{formatTime(log.timestamp)}</Text>
        <Text color={serviceColor}> [{log.service.substring(0, 3)}]</Text>
        <Text color={themeColors.primary}> 🔧 </Text>
        <Text color={themeColors.text}>{log.toolName}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color={themeColors.textMuted}>{formatTime(log.timestamp)}</Text>
      <Text color={serviceColor}> [{log.service.substring(0, 3)}]</Text>
      <Text color={color}> {icon} </Text>
      <Text color={log.level === 'error' || log.level === 'warn' ? color : themeColors.text}>
        {truncatedMessage}
      </Text>
    </Box>
  );
}

function FullLogEntryRow({ 
  log, 
  maxWidth, 
  searchQuery,
  highlightSearch,
  themeColors
}: { 
  log: LogEntry, 
  maxWidth: number,
  searchQuery: string,
  highlightSearch: (text: string, query: string) => React.ReactNode,
  themeColors: ThemeColorsType
}) {
  const levelColors = {
    info: themeColors.primary,
    success: baseColors.success,
    warn: baseColors.warning,
    error: baseColors.error,
  };

  const levelIcons = {
    info: symbols.filledDot,
    success: symbols.check,
    warn: '⚠',
    error: symbols.cross,
  };

  const serviceColor = log.service === 'web' ? themeColors.primary : themeColors.secondary;
  const icon = log.emoji || levelIcons[log.level];
  const color = levelColors[log.level];

  if (log.toolName) {
    return (
      <Box>
        <Text color={themeColors.textMuted}>{formatTime(log.timestamp)}</Text>
        <Text color={serviceColor}> [{log.service}]</Text>
        <Text color={themeColors.primary}> 🔧 </Text>
        <Text color={themeColors.text}>{highlightSearch(log.toolName, searchQuery)}</Text>
        {log.content && (
          <Text color={themeColors.textDim}> {highlightSearch(log.content.replace(`tool-input-available: ${log.toolName}`, '').trim(), searchQuery)}</Text>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <Text color={themeColors.textMuted}>{formatTime(log.timestamp)}</Text>
      <Text color={serviceColor}> [{log.service}]</Text>
      <Text color={color}> {icon} </Text>
      {log.tag && <Text color={themeColors.textMuted}>[{log.tag}] </Text>}
      <Text color={log.level === 'error' || log.level === 'warn' ? color : themeColors.text}>
        {highlightSearch(log.content || log.message, searchQuery)}
      </Text>
    </Box>
  );
}

function Shortcut({ letter, label, color }: { letter: string; label: string; color: string }) {
  return (
    <Box marginRight={2}>
      <Text color={baseColors.dimGray}>[</Text>
      <Text color={color}>{letter}</Text>
      <Text color={baseColors.dimGray}>]</Text>
      <Text color={baseColors.gray}>{label}</Text>
    </Box>
  );
}
