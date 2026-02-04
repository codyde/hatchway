/**
 * Get the logo path for a brand value
 * This is a simple lookup that works on both client and server
 */
export function getBrandLogo(brandValue: string): string | null {
  const logoMap: Record<string, string> = {
    'sentry': '/logos/sentry.svg',
    'stripe': '/logos/stripe.svg',
    'vercel': '/logos/vercel.svg',
    'linear': '/logos/linear.svg',
    'notion': '/logos/notion.svg',
    'github': '/logos/github.svg',
    'airbnb': '/logos/airbnb.svg',
    'spotify': '/logos/spotify.svg'
  };
  return logoMap[brandValue] || null;
}
