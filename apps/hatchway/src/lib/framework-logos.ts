/**
 * Framework logo configuration with light/dark variants
 * Dark variants are used on light backgrounds, light variants on dark backgrounds
 */
interface LogoConfig {
  light: string;  // Logo for dark backgrounds (light-colored logo)
  dark: string;   // Logo for light backgrounds (dark-colored logo)
}

const logoMap: Record<string, LogoConfig> = {
  'next': {
    light: '/logos/nextjs.svg',        // White logo for dark backgrounds
    dark: '/logos/nextjs-dark.png',    // Dark logo for light backgrounds
  },
  'vite': {
    light: '/logos/react.svg',
    dark: '/logos/react.svg',          // React logo works on both
  },
  'astro': {
    light: '/astro.png',               // White logo for dark backgrounds
    dark: '/logos/astro-dark.png',     // Dark logo for light backgrounds
  },
  'tanstack': {
    light: '/logos/tanstack.png',
    dark: '/logos/tanstack.png',       // TanStack logo works on both
  },
};

/**
 * Get the logo path for a framework value
 * @param frameworkValue - The framework identifier (e.g., 'next', 'astro')
 * @param theme - Optional theme to get the appropriate logo variant ('light' or 'dark')
 *                'light' theme = dark background = use light logo
 *                'dark' theme = light background = use dark logo
 *                If not provided, returns the light variant (for dark backgrounds)
 */
export function getFrameworkLogo(frameworkValue: string, theme?: 'light' | 'dark'): string | null {
  const config = logoMap[frameworkValue];
  if (!config) return null;
  
  // If theme is 'light' (meaning light theme / light background), use dark logo
  // If theme is 'dark' or undefined (dark background), use light logo
  return theme === 'light' ? config.dark : config.light;
}

/**
 * Get both logo variants for a framework
 * Useful when you need to handle theme switching client-side
 */
export function getFrameworkLogos(frameworkValue: string): LogoConfig | null {
  return logoMap[frameworkValue] || null;
}
