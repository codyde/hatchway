import { Box, Text, useInput, useStdout } from 'ink';
import { Banner, Menu, type MenuItem } from '../components/index.js';
import { colors } from '../theme.js';

export type LocalAction = 'init' | 'start';

export interface LocalModeScreenProps {
  isInitialized: boolean;
  onSelect: (action: LocalAction) => void;
  onEscape: () => void;
}

/**
 * Local mode options screen
 * Shows Initialize/Reinitialize and Start options based on config state
 */
export function LocalModeScreen({ isInitialized, onSelect, onEscape }: LocalModeScreenProps) {
  const { stdout } = useStdout();
  
  // Calculate vertical centering
  const terminalHeight = stdout?.rows || 24;
  const contentHeight = 16;
  const topPadding = Math.max(0, Math.floor((terminalHeight - contentHeight) / 3));

  // Handle escape key
  useInput((input, key) => {
    if (key.escape) {
      onEscape();
    }
  });

  // Build menu items based on initialization state
  const menuItems: MenuItem[] = [];
  
  if (!isInitialized) {
    menuItems.push({
      id: 'init',
      label: 'Initialize Hatchway',
      description: 'Set up workspace and configuration',
    });
  } else {
    menuItems.push({
      id: 'init',
      label: 'Reinitialize Hatchway',
      description: 'Reset and reconfigure',
    });
    menuItems.push({
      id: 'start',
      label: 'Start Hatchway',
      description: 'Launch the full stack',
    });
  }

  const handleSelect = (item: MenuItem) => {
    onSelect(item.id as LocalAction);
  };

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={topPadding}>
      {/* Banner */}
      <Banner />
      
      {/* Spacer */}
      <Box marginTop={1} />
      
      {/* Title */}
      <Text color={colors.cyan} bold>Local Mode</Text>
      
      {/* Spacer */}
      <Box marginTop={1} />
      
      {/* Status indicator */}
      {isInitialized ? (
        <Text color={colors.success}>● Configured</Text>
      ) : (
        <Text color={colors.warning}>○ Not configured</Text>
      )}
      
      {/* Spacer */}
      <Box marginTop={2} />
      
      {/* Menu */}
      <Menu items={menuItems} onSelect={handleSelect} />
      
      {/* Spacer */}
      <Box marginTop={2} />
      
      {/* Help text */}
      <Text color={colors.dimGray}>
        Use up/down arrows to navigate, Enter to select, Esc to go back
      </Text>
    </Box>
  );
}
