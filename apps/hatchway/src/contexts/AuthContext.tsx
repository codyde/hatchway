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
import { useSession } from "@/lib/auth-client";

// Local mode user - matches server-side LOCAL_USER
const LOCAL_USER = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Local User",
  email: "local@localhost",
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isLocalMode: boolean;
  hasCompletedOnboarding: boolean;
  setHasCompletedOnboarding: (value: boolean) => void;
  refetchOnboardingStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  isLocalMode?: boolean;
}

export function AuthProvider({ children, isLocalMode = false }: AuthProviderProps) {
  const { data: session, isPending } = useSession();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(true);

  // In local mode, ensure the session cookie is set via API (properly signed/httpOnly)
  useEffect(() => {
    if (isLocalMode && typeof window !== 'undefined') {
      // Call the local-session endpoint to set the httpOnly session cookie
      fetch('/api/auth/local-session')
        .then(res => {
          if (res.ok) {
            console.log('[AuthContext] Local mode session cookie initialized');
          }
        })
        .catch(err => {
          console.error('[AuthContext] Failed to init local session:', err);
        });
    }
  }, [isLocalMode]);

  // Fetch onboarding status when authenticated
  const fetchOnboardingStatus = useCallback(async () => {
    // Ensure we're on the client side before accessing localStorage
    if (typeof window === "undefined") {
      return;
    }

    if (isLocalMode) {
      // In local mode, check localStorage for onboarding status
      const stored = localStorage.getItem("hatchway-local-onboarding-complete");
      setHasCompletedOnboarding(stored === "true");
      setOnboardingLoading(false);
      return;
    }

    if (!session?.user) {
      setOnboardingLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/user/onboarding");
      if (res.ok) {
        const data = await res.json();
        setHasCompletedOnboarding(data.hasCompletedOnboarding ?? false);
      }
    } catch (error) {
      console.error("Failed to fetch onboarding status:", error);
    } finally {
      setOnboardingLoading(false);
    }
  }, [isLocalMode, session?.user]);

  useEffect(() => {
    fetchOnboardingStatus();
  }, [fetchOnboardingStatus]);

  // Handler to update onboarding status (also persists for local mode)
  const handleSetOnboardingComplete = useCallback((value: boolean) => {
    setHasCompletedOnboarding(value);
    if (isLocalMode) {
      localStorage.setItem("hatchway-local-onboarding-complete", value.toString());
    }
  }, [isLocalMode]);

  const value = useMemo<AuthContextValue>(() => {
    // In local mode, always authenticated as local user
    if (isLocalMode) {
      return {
        user: LOCAL_USER,
        isAuthenticated: true,
        isLoading: onboardingLoading,
        isLocalMode: true,
        hasCompletedOnboarding,
        setHasCompletedOnboarding: handleSetOnboardingComplete,
        refetchOnboardingStatus: fetchOnboardingStatus,
      };
    }

    // Normal mode - use better-auth session
    return {
      user: session?.user ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image ?? null,
        createdAt: new Date(session.user.createdAt),
        updatedAt: new Date(session.user.updatedAt),
      } : null,
      isAuthenticated: !!session?.user,
      isLoading: isPending || onboardingLoading,
      isLocalMode: false,
      hasCompletedOnboarding,
      setHasCompletedOnboarding: handleSetOnboardingComplete,
      refetchOnboardingStatus: fetchOnboardingStatus,
    };
  }, [session, isPending, isLocalMode, hasCompletedOnboarding, onboardingLoading, handleSetOnboardingComplete, fetchOnboardingStatus]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Hook to check if user can perform protected actions
 * Returns true if authenticated or in local mode
 */
export function useCanPerformActions(): boolean {
  const { isAuthenticated, isLocalMode } = useAuth();
  return isAuthenticated || isLocalMode;
}
