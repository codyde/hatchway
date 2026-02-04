import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Calculate relative luminance of a color (WCAG formula)
 * @param hex - Hex color string (e.g., "#ffffff" or "#fff")
 * @returns Relative luminance value between 0 and 1
 */
export function getLuminance(hex: string): number {
  // Remove # if present
  const color = hex.replace('#', '');
  
  // Handle shorthand hex (e.g., "#fff" -> "#ffffff")
  const fullHex = color.length === 3
    ? color.split('').map(c => c + c).join('')
    : color;
  
  const r = parseInt(fullHex.slice(0, 2), 16) / 255;
  const g = parseInt(fullHex.slice(2, 4), 16) / 255;
  const b = parseInt(fullHex.slice(4, 6), 16) / 255;
  
  // Apply sRGB to linear conversion
  const toLinear = (c: number) => 
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Determine whether to use light or dark text on a given background color
 * Uses WCAG contrast ratio guidelines (4.5:1 for normal text)
 * @param backgroundColor - Hex color string for the background
 * @param lightColor - Color to use on dark backgrounds (default: "#ffffff")
 * @param darkColor - Color to use on light backgrounds (default: "#000000")
 * @returns The text color that provides better contrast
 */
export function getContrastTextColor(
  backgroundColor: string,
  lightColor: string = '#ffffff',
  darkColor: string = '#000000'
): string {
  const bgLuminance = getLuminance(backgroundColor);
  
  // Use 0.179 as threshold (corresponds to ~4.5:1 contrast with white)
  // Colors with luminance > 0.179 are "light" and need dark text
  return bgLuminance > 0.179 ? darkColor : lightColor;
}
