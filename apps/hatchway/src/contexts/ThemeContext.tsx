"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export type ThemeName = "dark" | "light" | "tokyonight" | "onedark" | "gruvbox" | "dracula" | "nord" | "sentry";

export interface ThemeInfo {
  name: ThemeName;
  label: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
  };
}

export const THEMES: Record<ThemeName, ThemeInfo> = {
  dark: {
    name: "dark",
    label: "Dark",
    description: "Traditional dark mode",
    colors: {
      primary: "#60a5fa",
      secondary: "#a78bfa",
    },
  },
  light: {
    name: "light",
    label: "Light",
    description: "Clean light mode",
    colors: {
      primary: "#2563eb",
      secondary: "#7c3aed",
    },
  },
  tokyonight: {
    name: "tokyonight",
    label: "Tokyo Night",
    description: "Deep blue with purple accents",
    colors: {
      primary: "#7aa2f7",
      secondary: "#bb9af7",
    },
  },
  onedark: {
    name: "onedark",
    label: "One Dark",
    description: "Classic Atom editor theme",
    colors: {
      primary: "#61afef",
      secondary: "#c678dd",
    },
  },
  gruvbox: {
    name: "gruvbox",
    label: "Gruvbox",
    description: "Retro warm brown & orange",
    colors: {
      primary: "#fe8019",
      secondary: "#fabd2f",
    },
  },
  dracula: {
    name: "dracula",
    label: "Dracula",
    description: "Iconic purple & pink theme",
    colors: {
      primary: "#bd93f9",
      secondary: "#ff79c6",
    },
  },
  nord: {
    name: "nord",
    label: "Nord",
    description: "Arctic blue-gray palette",
    colors: {
      primary: "#88c0d0",
      secondary: "#81a1c1",
    },
  },
  sentry: {
    name: "sentry",
    label: "Sentry",
    description: "Purple & pink gradient",
    colors: {
      primary: "#a855f7",
      secondary: "#ec4899",
    },
  },
};

const THEME_STORAGE_KEY = "hatchway-theme";

interface ThemeContextValue {
  theme: ThemeName;
  themeInfo: ThemeInfo;
  setTheme: (theme: ThemeName) => void;
  availableThemes: ThemeInfo[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: ThemeName;
}

export function ThemeProvider({ children, defaultTheme = "dark" }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeName | null;
      if (stored && THEMES[stored]) {
        setThemeState(stored);
      }
    }
  }, []);

  // Apply theme class to document
  useEffect(() => {
    if (!mounted) return;
    
    const root = document.documentElement;
    
    // Remove all theme classes
    Object.keys(THEMES).forEach((t) => {
      root.classList.remove(`theme-${t}`);
    });
    
    // Add current theme class
    root.classList.add(`theme-${theme}`);
    
    // Handle dark/light mode class
    if (theme === "light") {
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
    }
  }, [theme, mounted]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    if (THEMES[newTheme]) {
      setThemeState(newTheme);
      if (typeof window !== "undefined") {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      }
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    themeInfo: THEMES[theme],
    setTheme,
    availableThemes: Object.values(THEMES),
  }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
