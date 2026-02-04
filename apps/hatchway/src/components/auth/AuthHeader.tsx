"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/lib/auth-client";
import { LoginModal } from "./LoginModal";
import { RunnerKeyManager } from "./RunnerKeyManager";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { User, LogOut, Key, Loader2 } from "lucide-react";

export function AuthHeader() {
  const { user, isAuthenticated, isLocalMode, isLoading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRunnerKeys, setShowRunnerKeys] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out error:", error);
    } finally {
      setIsSigningOut(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-zinc-800 animate-pulse" />
      </div>
    );
  }

  // Not authenticated - show sign in button
  if (!isAuthenticated && !isLocalMode) {
    return (
      <>
        <Button
          onClick={() => setShowLoginModal(true)}
          variant="outline"
          size="sm"
          className="bg-transparent border-white/20 text-white hover:bg-white/10 hover:border-white/30"
        >
          <User className="w-4 h-4 mr-2" />
          Sign in
        </Button>
        <LoginModal
          open={showLoginModal}
          onOpenChange={setShowLoginModal}
        />
      </>
    );
  }

  // Authenticated or local mode - show avatar dropdown
  const displayName = user?.name || user?.email?.split("@")[0] || "User";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 p-1 rounded-full hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-theme-primary/50">
            {user?.image ? (
              <img
                src={user.image}
                alt={displayName}
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-theme-gradient flex items-center justify-center text-xs font-medium text-white">
                {initials}
              </div>
            )}
            {isLocalMode && (
              <span className="px-1.5 py-0.5 text-[9px] font-medium bg-green-500/20 text-green-400 rounded">
                LOCAL
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56 bg-zinc-950 border-zinc-800"
          align="end"
          sideOffset={8}
        >
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-white">{displayName}</p>
            <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
          </div>
          <DropdownMenuSeparator className="bg-zinc-800" />
          
          {!isLocalMode && (
            <>
              <DropdownMenuItem
                onClick={() => setShowRunnerKeys(true)}
                className="cursor-pointer text-zinc-300 focus:text-white focus:bg-zinc-800"
              >
                <Key className="w-4 h-4 mr-2" />
                Runner Keys
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-zinc-800" />
              <DropdownMenuItem
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="cursor-pointer text-red-400 focus:text-red-300 focus:bg-red-500/10"
              >
                {isSigningOut ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                {isSigningOut ? "Signing out..." : "Sign out"}
              </DropdownMenuItem>
            </>
          )}
          
          {isLocalMode && (
            <div className="px-3 py-2 text-xs text-zinc-500">
              Running in local mode. Authentication is not required.
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Runner Keys Modal */}
      <RunnerKeyManager
        open={showRunnerKeys}
        onOpenChange={setShowRunnerKeys}
      />
    </>
  );
}
