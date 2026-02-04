'use client';

import { getBrandLogo } from '@/lib/brand-logos';
import { getContrastTextColor } from '@/lib/utils';
import Image from 'next/image';

interface BrandThemePreviewProps {
  brand: {
    value: string;
    label: string;
    values?: {
      primaryColor: string;
      secondaryColor: string;
      accentColor: string;
      neutralLight: string;
      neutralDark: string;
    };
  };
}

export function BrandThemePreview({ brand }: BrandThemePreviewProps) {
  if (!brand.values) {
    return null;
  }

  const { primaryColor, secondaryColor, accentColor, neutralLight, neutralDark } = brand.values;
  const logoPath = getBrandLogo(brand.value);

  return (
    <div className="w-96 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        {logoPath && (
          <div className="w-8 h-8 flex items-center justify-center">
            <Image
              src={logoPath}
              alt={`${brand.label} logo`}
              width={32}
              height={32}
              className="object-contain"
            />
          </div>
        )}
        <div className="text-sm font-semibold text-popover-foreground">
          {brand.label} Theme Preview
        </div>
      </div>

      {/* Sample Button */}
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Primary Button</div>
        <button
          className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
          style={{ 
            backgroundColor: primaryColor,
            color: getContrastTextColor(primaryColor, neutralLight, neutralDark)
          }}
        >
          Get Started
        </button>
      </div>

      {/* Sample Card */}
      <div
        className="rounded-lg p-4 space-y-2"
        style={{ backgroundColor: neutralLight }}
      >
        <div className="flex items-center justify-between">
          <div
            className="text-sm font-semibold"
            style={{ color: neutralDark }}
          >
            Card Title
          </div>
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        </div>
        <div
          className="text-xs opacity-70"
          style={{ color: neutralDark }}
        >
          This is a sample card showing the theme colors in action.
        </div>
        <div className="flex gap-2">
          <div
            className="flex-1 h-1 rounded-full"
            style={{ backgroundColor: secondaryColor }}
          />
          <div
            className="flex-1 h-1 rounded-full opacity-30"
            style={{ backgroundColor: secondaryColor }}
          />
        </div>
      </div>

      {/* Color Palette */}
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Color Palette</div>
        <div className="grid grid-cols-5 gap-2">
          <div className="space-y-1">
            <div
              className="w-full h-8 rounded border border-border"
              style={{ backgroundColor: primaryColor }}
            />
            <div className="text-[10px] text-muted-foreground text-center truncate">Primary</div>
          </div>
          <div className="space-y-1">
            <div
              className="w-full h-8 rounded border border-border"
              style={{ backgroundColor: secondaryColor }}
            />
            <div className="text-[10px] text-muted-foreground text-center truncate">Secondary</div>
          </div>
          <div className="space-y-1">
            <div
              className="w-full h-8 rounded border border-border"
              style={{ backgroundColor: accentColor }}
            />
            <div className="text-[10px] text-muted-foreground text-center truncate">Accent</div>
          </div>
          <div className="space-y-1">
            <div
              className="w-full h-8 rounded border border-border"
              style={{ backgroundColor: neutralLight }}
            />
            <div className="text-[10px] text-muted-foreground text-center truncate">Light</div>
          </div>
          <div className="space-y-1">
            <div
              className="w-full h-8 rounded border border-border"
              style={{ backgroundColor: neutralDark }}
            />
            <div className="text-[10px] text-muted-foreground text-center truncate">Dark</div>
          </div>
        </div>
      </div>

      {/* Sample Badge */}
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Components</div>
        <div className="flex gap-2 flex-wrap">
          <span
            className="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
            style={{ 
              backgroundColor: primaryColor,
              color: getContrastTextColor(primaryColor, neutralLight, neutralDark)
            }}
          >
            Badge
          </span>
          <span
            className="inline-flex items-center px-2 py-1 rounded text-xs font-medium border"
            style={{
              borderColor: secondaryColor,
              color: secondaryColor
            }}
          >
            Outline
          </span>
          <span
            className="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
            style={{
              backgroundColor: `${accentColor}20`,
              color: accentColor
            }}
          >
            Accent
          </span>
        </div>
      </div>
    </div>
  );
}
