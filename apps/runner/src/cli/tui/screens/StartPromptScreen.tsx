import { Box, Text, useInput, useStdout } from 'ink';
import { Banner } from '../components/index.js';
import { colors, symbols } from '../theme.js';

export interface StartPromptScreenProps {
  onSelect: (shouldStart: boolean) => void;
}

/**
 * Post-init prompt asking if user wants to start Hatchway now
 */
export function StartPromptScreen({ onSelect }: StartPromptScreenProps) {
  const { stdout } = useStdout();
  
  // Calculate vertical centering
  const terminalHeight = stdout?.rows || 24;
  const contentHeight = 14;
  const topPadding = Math.max(0, Math.floor((terminalHeight - contentHeight) / 3));

  useInput((input, key) => {
    const char = input.toLowerCase();
    
    // Enter = start
    if (key.return) {
      onSelect(true);
      return;
    }
    
    // Y = start
    if (char === 'y') {
      onSelect(true);
      return;
    }
    
    // N = don't start
    if (char === 'n') {
      onSelect(false);
      return;
    }
    
    // Escape = don't start
    if (key.escape) {
      onSelect(false);
      return;
    }
  });

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={topPadding}>
      {/* Banner */}
      <Banner />
      
      {/* Spacer */}
      <Box marginTop={2} />
      
      {/* Success message */}
      <Box flexDirection="column" alignItems="center">
        <Text color={colors.success} bold>
          {symbols.check} Hatchway is ready!
        </Text>
      </Box>
      
      {/* Spacer */}
      <Box marginTop={2} />
      
      {/* Prompt */}
      <Box flexDirection="column" alignItems="center">
        <Text color={colors.white}>
          Start Hatchway now?
        </Text>
        
        <Box marginTop={1}>
          <Text color={colors.dimGray}>
            Press <Text color={colors.cyan} bold>Y</Text> or <Text color={colors.cyan} bold>Enter</Text> to start, <Text color={colors.cyan} bold>N</Text> or <Text color={colors.cyan} bold>Esc</Text> to exit
          </Text>
        </Box>
      </Box>
      
      {/* Spacer */}
      <Box marginTop={2} />
      
      {/* Info about manual start */}
      <Box flexDirection="column" alignItems="center">
        <Text color={colors.dimGray}>
          To start later, run: <Text color={colors.cyan}>hatchway run</Text>
        </Text>
      </Box>
    </Box>
  );
}
