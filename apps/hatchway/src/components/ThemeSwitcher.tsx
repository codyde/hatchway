"use client";

import { useTheme, type ThemeName } from "@/contexts/ThemeContext";
import { Palette, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

interface ThemeSwitcherProps {
  isCollapsed?: boolean;
}

export function ThemeSwitcher({ isCollapsed = false }: ThemeSwitcherProps) {
  const { theme, setTheme, availableThemes } = useTheme();
  const currentTheme = availableThemes.find(t => t.name === theme);

  if (isCollapsed) {
    return (
      <DropdownMenu>
        <HoverCard openDelay={0} closeDelay={0}>
          <HoverCardTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center justify-center p-2.5 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors">
                <div
                  className="w-5 h-5 rounded-full"
                  style={{
                    background: `linear-gradient(135deg, ${currentTheme?.colors.primary}, ${currentTheme?.colors.secondary})`,
                  }}
                />
              </button>
            </DropdownMenuTrigger>
          </HoverCardTrigger>
          <HoverCardContent side="right" align="center" className="w-auto p-3 bg-popover border-border pointer-events-none">
            <div className="flex items-center gap-2">
              <p className="text-sm text-popover-foreground">Theme: {currentTheme?.label}</p>
            </div>
          </HoverCardContent>
        </HoverCard>
        <DropdownMenuContent className="w-56 bg-popover border-border" align="start" side="right">
          {availableThemes.map((themeOption) => {
            const isSelected = themeOption.name === theme;
            
            return (
              <DropdownMenuItem
                key={themeOption.name}
                onClick={() => setTheme(themeOption.name as ThemeName)}
                className={`flex items-center gap-3 cursor-pointer ${
                  isSelected ? "bg-accent" : ""
                }`}
              >
                <div
                  className="w-6 h-6 rounded-full shrink-0 border border-border"
                  style={{
                    background: `linear-gradient(135deg, ${themeOption.colors.primary}, ${themeOption.colors.secondary})`,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-popover-foreground">{themeOption.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{themeOption.description}</p>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-popover-foreground shrink-0" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Theme</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{
                background: `linear-gradient(135deg, ${currentTheme?.colors.primary}, ${currentTheme?.colors.secondary})`,
              }}
            />
            <span className="text-xs text-foreground capitalize">{theme}</span>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 bg-popover border-border" align="start" side="top">
        {availableThemes.map((themeOption) => {
          const isSelected = themeOption.name === theme;
          
          return (
            <DropdownMenuItem
              key={themeOption.name}
              onClick={() => setTheme(themeOption.name as ThemeName)}
              className={`flex items-center gap-3 cursor-pointer ${
                isSelected ? "bg-accent" : ""
              }`}
            >
              <div
                className="w-6 h-6 rounded-full shrink-0 border border-border"
                style={{
                  background: `linear-gradient(135deg, ${themeOption.colors.primary}, ${themeOption.colors.secondary})`,
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-popover-foreground">{themeOption.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{themeOption.description}</p>
              </div>
              {isSelected && (
                <Check className="w-4 h-4 text-popover-foreground shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
