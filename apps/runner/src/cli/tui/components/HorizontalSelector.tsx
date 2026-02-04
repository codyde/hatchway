import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme.js';

export interface CardOption {
  id: string;
  title: string;
  description: string;
}

interface HorizontalSelectorProps {
  options: CardOption[];
  onSelect: (option: CardOption) => void;
  onEscape?: () => void;
}

/**
 * Horizontal card selector component
 *
 * ┌─────────────────┐     ┌─────────────────┐
 * │   Local Mode    │     │   Runner Mode   │
 * │                 │     │                 │
 * │ Run Hatchway   │     │ Connect to a    │
 * │ locally         │     │ remote server   │
 * └─────────────────┘     └─────────────────┘
 *       [SELECTED]
 */
export function HorizontalSelector({ options, onSelect, onEscape }: HorizontalSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.leftArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.rightArrow) {
      setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      onSelect(options[selectedIndex]);
    } else if (key.escape && onEscape) {
      onEscape();
    }
  });

  return (
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="row" gap={2}>
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box
              key={option.id}
              flexDirection="column"
              alignItems="center"
              borderStyle="round"
              borderColor={isSelected ? colors.cyan : colors.darkGray}
              paddingX={3}
              paddingY={1}
              width={25}
            >
              <Text
                color={isSelected ? colors.white : colors.gray}
                bold={isSelected}
              >
                {option.title}
              </Text>
              <Box marginTop={1}>
                <Text
                  color={isSelected ? colors.gray : colors.dimGray}
                  wrap="wrap"
                >
                  {option.description}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      
      {/* Selection indicator */}
      <Box marginTop={1}>
        {options.map((option, index) => (
          <Box key={option.id} width={25} justifyContent="center" marginX={1}>
            {index === selectedIndex && (
              <Text color={colors.cyan}>{'▲'}</Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
