import { Box, Text } from 'ink';
import { colors } from '../theme.js';

/**
 * ASCII art banner component - centered with cyan/purple gradient
 * Each line is padded to exactly the same width for perfect alignment
 */
export function Banner() {
  // Full banner lines - HATCH in cyan, WAY in purple
  // All lines padded to same total width for consistent centering
  const lines = [
    { hatch: '██╗  ██╗ █████╗ ████████╗ ██████╗██╗  ██╗', way: '██╗    ██╗ █████╗ ██╗   ██╗' },
    { hatch: '██║  ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║', way: '██║    ██║██╔══██╗╚██╗ ██╔╝' },
    { hatch: '███████║███████║   ██║   ██║     ███████║', way: '██║ █╗ ██║███████║ ╚████╔╝ ' },
    { hatch: '██╔══██║██╔══██║   ██║   ██║     ██╔══██║', way: '██║███╗██║██╔══██║  ╚██╔╝  ' },
    { hatch: '██║  ██║██║  ██║   ██║   ╚██████╗██║  ██║', way: '╚███╔███╔╝██║  ██║   ██║   ' },
    { hatch: '╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝', way: ' ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝   ' },
  ];

  return (
    <Box flexDirection="column" alignItems="center">
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color={colors.cyan}>{line.hatch}</Text>
          <Text color={colors.brightPurple}>{line.way}</Text>
        </Box>
      ))}
    </Box>
  );
}
