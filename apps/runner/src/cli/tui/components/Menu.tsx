import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, symbols } from '../theme.js';

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
}

interface MenuProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
}

/**
 * Arrow-key navigable menu component
 *
 * > Initialize Hatchway
 *   Start Runner
 *   Exit
 */
export function Menu({ items, onSelect }: MenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      onSelect(items[selectedIndex]);
    }
  });

  return (
    <Box flexDirection="column" alignItems="flex-start">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={item.id} marginY={0}>
            <Text color={isSelected ? colors.cyan : colors.gray}>
              {isSelected ? '› ' : '  '}
            </Text>
            <Text color={isSelected ? colors.white : colors.gray} bold={isSelected}>
              {item.label}
            </Text>
            {item.description && (
              <Text color={colors.dimGray}>
                {'  '}{item.description}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
