import { Box, Text } from 'ink';
import { colors, symbols } from '../theme.js';

export interface ConfigItem {
  label: string;
  value: string;
}

interface ConfigSummaryProps {
  items: ConfigItem[];
  title?: string;
}

/**
 * Configuration summary display
 * ───────────────────────────────────
 *  Workspace   ~/hatchway-workspace
 *  Server      http://localhost:3000
 *  Runner      local
 * ───────────────────────────────────
 */
export function ConfigSummary({ items, title }: ConfigSummaryProps) {
  const dividerWidth = 40;
  const divider = symbols.horizontalLine.repeat(dividerWidth);
  
  // Find the longest label for alignment
  const maxLabelLength = Math.max(...items.map(item => item.label.length));

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={colors.dimGray}>{divider}</Text>
      
      {title && (
        <Box marginTop={1} marginBottom={1}>
          <Text color={colors.white} bold>{title}</Text>
        </Box>
      )}
      
      <Box flexDirection="column" alignItems="flex-start" marginTop={title ? 0 : 1}>
        {items.map((item, index) => (
          <Box key={index}>
            <Text color={colors.gray}>
              {item.label.padEnd(maxLabelLength + 3)}
            </Text>
            <Text color={colors.cyan}>{item.value}</Text>
          </Box>
        ))}
      </Box>
      
      <Box marginTop={1}>
        <Text color={colors.dimGray}>{divider}</Text>
      </Box>
    </Box>
  );
}

interface NextStepsProps {
  command: string;
  url: string;
}

/**
 * Next steps display for completion screen
 */
export function NextSteps({ command, url }: NextStepsProps) {
  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      <Box>
        <Text color={colors.gray}>Run:  </Text>
        <Text color={colors.cyan} bold>{command}</Text>
      </Box>
      <Box>
        <Text color={colors.gray}>Open: </Text>
        <Text color={colors.cyan}>{url}</Text>
      </Box>
    </Box>
  );
}

interface ErrorSummaryProps {
  message?: string;
  suggestions: string[];
}

/**
 * Error display with message and recovery suggestions
 */
export function ErrorSummary({ message, suggestions }: ErrorSummaryProps) {
  const dividerWidth = 44;
  const divider = symbols.horizontalLine.repeat(dividerWidth);

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={colors.dimGray}>{divider}</Text>
      
      {/* Error message header */}
      {message && (
        <Box marginTop={1} marginBottom={1}>
          <Text color={colors.error} bold>{symbols.cross} {message}</Text>
        </Box>
      )}
      
      {/* Suggestions/details */}
      <Box flexDirection="column" alignItems="flex-start" marginTop={message ? 0 : 1}>
        {suggestions.map((suggestion, index) => (
          <Box key={index}>
            <Text color={suggestion.startsWith('  ') ? colors.cyan : colors.gray}>
              {suggestion}
            </Text>
          </Box>
        ))}
      </Box>
      
      <Box marginTop={1}>
        <Text color={colors.dimGray}>{divider}</Text>
      </Box>
    </Box>
  );
}
