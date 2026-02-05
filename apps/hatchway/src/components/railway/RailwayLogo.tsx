'use client';

import { useTheme } from '@/contexts/ThemeContext';
import Image from 'next/image';

interface RailwayLogoProps {
  className?: string;
  width?: number;
  height?: number;
}

/**
 * Railway logo component that switches between dark and light variants
 * based on the current theme
 */
export function RailwayLogo({ className, width = 14, height = 14 }: RailwayLogoProps) {
  const { theme } = useTheme();
  
  // Use light logo on dark backgrounds (dark theme), dark logo on light backgrounds
  const logoSrc = theme === 'light' 
    ? '/railway-logo-dark.svg' 
    : '/railway-logo-light.svg';

  return (
    <Image
      src={logoSrc}
      alt="Railway"
      width={width}
      height={height}
      className={className}
    />
  );
}
