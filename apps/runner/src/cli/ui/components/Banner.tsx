/**
 * Banner Component - Hatchway ASCII art banner for TUI
 * Matches the init TUI banner style - centered with cyan/purple gradient
 */

import React from 'react';
import { Box, Text } from 'ink';

// Theme colors matching init TUI
const colors = {
  cyan: '#06b6d4',
  brightPurple: '#c084fc',
};

/**
 * ASCII art banner component - centered with cyan/purple gradient
 */
export function Banner() {
  const lines = [
    { open: ' ██████╗ ██████╗ ███████╗███╗   ██╗', builder: '██████╗ ██╗   ██╗██╗██╗     ██████╗ ███████╗██████╗ ' },
    { open: '██╔═══██╗██╔══██╗██╔════╝████╗  ██║', builder: '██╔══██╗██║   ██║██║██║     ██╔══██╗██╔════╝██╔══██╗' },
    { open: '██║   ██║██████╔╝█████╗  ██╔██╗ ██║', builder: '██████╔╝██║   ██║██║██║     ██║  ██║█████╗  ██████╔╝' },
    { open: '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║', builder: '██╔══██╗██║   ██║██║██║     ██║  ██║██╔══╝  ██╔══██╗' },
    { open: '╚██████╔╝██║     ███████╗██║ ╚████║', builder: '██████╔╝╚██████╔╝██║███████╗██████╔╝███████╗██║  ██║' },
    { open: ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝', builder: '╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝' },
  ];

  return (
    <Box flexDirection="column" alignItems="center" marginTop={2}>
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color={colors.cyan}>{line.open}</Text>
          <Text color={colors.brightPurple}>{line.builder}</Text>
        </Box>
      ))}
    </Box>
  );
}
