/**
 * BuildErrorView - Compact scrollable view for build errors
 * Designed to fit in the center of the init screen, not full-screen
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { colors, symbols } from '../theme.js';

interface BuildErrorViewProps {
  /** Error title/message */
  title: string;
  /** Array of error lines to display */
  errorLines: string[];
  /** Suggestions for fixing the error */
  suggestions?: string[];
  /** Callback when user exits */
  onExit?: () => void;
}

/**
 * Compact build error viewer with scrolling and copy support
 * Displays in the center area, half-width, with scrollable content
 */
export function BuildErrorView({ 
  title, 
  errorLines, 
  suggestions = [],
  onExit 
}: BuildErrorViewProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  const [scrollOffset, setScrollOffset] = useState(0);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);

  // Fixed dimensions for compact view
  const boxWidth = Math.min(70, Math.floor(terminalWidth * 0.6));
  const maxVisibleLines = 12; // Show 12 lines of errors max
  
  // Calculate max scroll
  const maxScroll = Math.max(0, errorLines.length - maxVisibleLines);

  // Get visible lines
  const visibleLines = errorLines.slice(scrollOffset, scrollOffset + maxVisibleLines);

  // Copy all error content to clipboard
  const copyToClipboard = useCallback(async () => {
    const content = [
      `Build Error: ${title}`,
      '─'.repeat(60),
      ...errorLines,
      '─'.repeat(60),
      '',
      ...suggestions,
    ].join('\n');

    try {
      const { exec } = await import('child_process');

      // Detect platform and use appropriate clipboard command
      const platform = process.platform;
      let clipboardCmd: string;

      if (platform === 'darwin') {
        clipboardCmd = 'pbcopy';
      } else if (platform === 'win32') {
        clipboardCmd = 'clip';
      } else {
        clipboardCmd = 'xclip -selection clipboard';
      }

      // Write to clipboard
      const child = exec(clipboardCmd);
      child.stdin?.write(content);
      child.stdin?.end();

      setShowCopiedMessage(true);

      // Show success message then exit after delay
      setTimeout(() => {
        if (onExit) {
          onExit();
        } else {
          exit();
        }
      }, 1500);
    } catch (error) {
      // Clipboard failed - still show message
      setShowCopiedMessage(true);
      setTimeout(() => setShowCopiedMessage(false), 2000);
    }
  }, [title, errorLines, suggestions, onExit, exit]);

  // Handle keyboard input
  useInput((input, key) => {
    if (input === 'c' || input === 'C') {
      copyToClipboard();
    } else if (key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setScrollOffset(prev => Math.min(maxScroll, prev + 1));
    } else if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - maxVisibleLines));
    } else if (key.pageDown) {
      setScrollOffset(prev => Math.min(maxScroll, prev + maxVisibleLines));
    } else if (input === 'q' || key.escape) {
      if (onExit) {
        onExit();
      } else {
        exit();
      }
    }
  });

  // Color error lines based on content
  const getLineColor = (line: string): string => {
    if (/error|Error|ERR!/i.test(line)) return colors.error;
    if (/warning|warn/i.test(line)) return colors.warning;
    if (/:\d+:\d+/.test(line)) return colors.cyan;
    if (line.startsWith('─') || line.startsWith('hatchway:')) return colors.dimGray;
    return colors.gray;
  };

  const divider = symbols.horizontalLine.repeat(boxWidth - 2);
  const hasScroll = errorLines.length > maxVisibleLines;

  return (
    <Box flexDirection="column" alignItems="center" width="100%">
      {/* Top divider */}
      <Text color={colors.dimGray}>{divider}</Text>
      
      {/* Error header */}
      <Box marginTop={1} marginBottom={1} width={boxWidth} justifyContent="center">
        <Text color={colors.error} bold>{symbols.cross} {title}</Text>
      </Box>

      {/* Scrollable error content */}
      <Box 
        flexDirection="column" 
        width={boxWidth}
        borderStyle="round"
        borderColor={colors.error}
        paddingX={1}
        paddingY={0}
      >
        {/* Scroll indicator header */}
        {hasScroll && (
          <Box justifyContent="flex-end" marginBottom={0}>
            <Text color={colors.dimGray} dimColor>
              [{scrollOffset + 1}-{Math.min(scrollOffset + maxVisibleLines, errorLines.length)}/{errorLines.length}] ↑↓
            </Text>
          </Box>
        )}
        
        {/* Error lines */}
        {visibleLines.length > 0 ? (
          visibleLines.map((line, index) => {
            const truncatedLine = line.length > boxWidth - 4 
              ? line.substring(0, boxWidth - 7) + '...' 
              : line;
            return (
              <Text key={index} color={getLineColor(line)} wrap="truncate">
                {truncatedLine}
              </Text>
            );
          })
        ) : (
          <Text color={colors.dimGray}>No error details captured</Text>
        )}
      </Box>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1} width={boxWidth}>
          {suggestions.map((suggestion, index) => (
            <Text key={index} color={suggestion.startsWith('  ') ? colors.cyan : colors.gray}>
              {suggestion}
            </Text>
          ))}
        </Box>
      )}

      {/* Bottom divider */}
      <Box marginTop={1}>
        <Text color={colors.dimGray}>{divider}</Text>
      </Box>

      {/* Keyboard shortcuts */}
      <Box marginTop={1} justifyContent="center">
        {showCopiedMessage ? (
          <Text color={colors.success} bold>
            {symbols.check} Copied to clipboard! Exiting...
          </Text>
        ) : (
          <Box>
            <Text color={colors.dimGray}>[</Text>
            <Text color={colors.success} bold>c</Text>
            <Text color={colors.dimGray}>]</Text>
            <Text color={colors.success}>copy & exit</Text>
            <Text>  </Text>
            <Text color={colors.dimGray}>[</Text>
            <Text color={colors.cyan}>q</Text>
            <Text color={colors.dimGray}>]</Text>
            <Text color={colors.gray}>quit</Text>
            {hasScroll && (
              <>
                <Text>  </Text>
                <Text color={colors.dimGray}>[</Text>
                <Text color={colors.cyan}>↑↓</Text>
                <Text color={colors.dimGray}>]</Text>
                <Text color={colors.gray}>scroll</Text>
              </>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
