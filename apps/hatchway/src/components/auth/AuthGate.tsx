"use client";

import { useState, useCallback, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { LoginModal } from "./LoginModal";

interface AuthGateProps {
  children: ReactNode;
  /**
   * Render prop that receives onClick handler
   * Use this when you need to intercept a click before showing the modal
   */
  renderTrigger?: (props: { onClick: () => void }) => ReactNode;
  /**
   * Callback when authentication is successful
   */
  onAuthenticated?: () => void;
  /**
   * If true, always show children (used when you just want the modal trigger)
   */
  showChildren?: boolean;
}

/**
 * AuthGate - Wraps content that requires authentication
 * 
 * In local mode: Always shows children directly
 * In hosted mode (unauthenticated): Shows login modal when interacting
 * In hosted mode (authenticated): Shows children directly
 * 
 * Usage:
 * 
 * 1. Wrap content that should trigger login:
 * <AuthGate>
 *   <button onClick={handleSubmit}>Submit</button>
 * </AuthGate>
 * 
 * 2. Use render prop for custom trigger:
 * <AuthGate renderTrigger={({ onClick }) => (
 *   <button onClick={onClick}>Submit</button>
 * )} onAuthenticated={handleSubmit} />
 */
export function AuthGate({
  children,
  renderTrigger,
  onAuthenticated,
  showChildren = true,
}: AuthGateProps) {
  const { isAuthenticated, isLocalMode, isLoading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const handleClick = useCallback(() => {
    if (isLocalMode || isAuthenticated) {
      // Already authenticated - execute action directly
      onAuthenticated?.();
    } else {
      // Not authenticated - show login modal
      setPendingAction(() => onAuthenticated || null);
      setShowLoginModal(true);
    }
  }, [isLocalMode, isAuthenticated, onAuthenticated]);

  const handleAuthSuccess = useCallback(() => {
    // Execute pending action after successful auth
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  // Loading state - show nothing or loading indicator
  if (isLoading) {
    return showChildren ? <>{children}</> : null;
  }

  // Already authenticated or local mode - render children directly
  if (isLocalMode || isAuthenticated) {
    if (renderTrigger) {
      return <>{renderTrigger({ onClick: onAuthenticated || (() => {}) })}</>;
    }
    return <>{children}</>;
  }

  // Not authenticated - wrap with login gate
  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onClick: handleClick })
      ) : showChildren ? (
        <div onClick={handleClick} className="cursor-pointer">
          {children}
        </div>
      ) : null}
      
      <LoginModal
        open={showLoginModal}
        onOpenChange={setShowLoginModal}
        onSuccess={handleAuthSuccess}
      />
    </>
  );
}

/**
 * Hook to get a function that requires authentication
 * Returns a wrapped function that shows login modal if not authenticated
 */
export function useAuthGate() {
  const { isAuthenticated, isLocalMode } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (isLocalMode || isAuthenticated) {
        action();
      } else {
        setPendingAction(() => action);
        setShowLoginModal(true);
      }
    },
    [isLocalMode, isAuthenticated]
  );

  const handleAuthSuccess = useCallback(() => {
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  const LoginModalComponent = (
    <LoginModal
      open={showLoginModal}
      onOpenChange={setShowLoginModal}
      onSuccess={handleAuthSuccess}
    />
  );

  return {
    requireAuth,
    LoginModal: LoginModalComponent,
    isAuthenticated: isLocalMode || isAuthenticated,
  };
}
