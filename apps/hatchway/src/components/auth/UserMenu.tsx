"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/lib/auth-client";
import { LoginModal } from "./LoginModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Key, ChevronDown } from "lucide-react";

interface UserMenuProps {
  onOpenRunnerKeys?: () => void;
}

export function UserMenu({ onOpenRunnerKeys }: UserMenuProps) {
  const { user, isAuthenticated, isLocalMode, isLoading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      // Page will refresh/update via session change
    } catch (error) {
      console.error("Sign out error:", error);
    } finally {
      setIsSigningOut(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="w-full flex items-center justify-between px-3 py-2 bg-black/20 border border-white/10 rounded-lg">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-zinc-800 animate-pulse" />
          <div className="w-20 h-3 bg-zinc-800 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  // Not authenticated - show sign in button
  if (!isAuthenticated && !isLocalMode) {
    return (
      <>
        <button
          onClick={() => setShowLoginModal(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 btn-theme-primary text-sm font-medium rounded-lg"
        >
          <User className="w-4 h-4" />
          <span>Sign in</span>
        </button>
        <LoginModal
          open={showLoginModal}
          onOpenChange={setShowLoginModal}
        />
      </>
    );
  }

  // Authenticated or local mode - show user dropdown
  const displayName = user?.name || user?.email?.split("@")[0] || "User";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center justify-between px-3 py-2 bg-black/20 hover:bg-black/30 border border-white/10 rounded-lg transition-colors">
          <div className="flex items-center gap-2">
            {user?.image ? (
              <img
                src={user.image}
                alt={displayName}
                className="w-6 h-6 rounded-full"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-theme-gradient-br flex items-center justify-center text-[10px] font-medium text-white">
                {initials}
              </div>
            )}
            <span className="text-xs text-white truncate max-w-[100px]">
              {displayName}
            </span>
            {isLocalMode && (
              <span className="px-1.5 py-0.5 text-[9px] font-medium bg-green-500/20 text-green-400 rounded">
                LOCAL
              </span>
            )}
          </div>
          <ChevronDown className="w-3 h-3 text-gray-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56 bg-zinc-950 border-zinc-800"
        align="start"
        side="top"
      >
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-white">{displayName}</p>
          <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
        </div>
        <DropdownMenuSeparator className="bg-zinc-800" />
        
        {!isLocalMode && (
          <>
            <DropdownMenuItem
              onClick={onOpenRunnerKeys}
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
              <LogOut className="w-4 h-4 mr-2" />
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
  );
}
