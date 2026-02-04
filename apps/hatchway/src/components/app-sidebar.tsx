"use client"

import * as React from "react"
import { useState } from "react"
import { Plus, Server, ChevronDown, CheckCircle2, Circle, Lock, BookOpen, ChevronLeft, ChevronRight, User, LogOut, Key, Loader2 } from "lucide-react"
import { useProjects } from "@/contexts/ProjectContext"
import { useRunner } from "@/contexts/RunnerContext"
import { useAuth } from "@/contexts/AuthContext"
import { ProjectList } from "@/components/sidebar/ProjectList"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { useQueryClient } from "@tanstack/react-query"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { LoginModal } from "@/components/auth/LoginModal"
import { RunnerKeyManager } from "@/components/auth/RunnerKeyManager"
import { signOut } from "@/lib/auth-client"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onRenameProject: (project: { id: string; name: string }) => void;
  onDeleteProject: (project: { id: string; name: string; slug: string }) => void;
  onOpenOnboarding?: () => void;
}

export function AppSidebar({ onRenameProject, onDeleteProject, onOpenOnboarding, ...props }: AppSidebarProps) {
  const { projects, isLoading } = useProjects();
  const { selectedRunnerId, setSelectedRunnerId, availableRunners, isLoading: runnersLoading } = useRunner();
  const { user, isAuthenticated, isLocalMode, hasCompletedOnboarding, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentProjectSlug = searchParams?.get('project') ?? null;
  const queryClient = useQueryClient();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  
  // Auth state
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRunnerKeys, setShowRunnerKeys] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  
  // Show projects only when authenticated or in local mode
  const canViewProjects = isAuthenticated || isLocalMode;
  
  // User display info
  const displayName = user?.name || user?.email?.split("@")[0] || "User";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

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



  const handleStartServer = async (projectId: string) => {
    try {
      // Optimistically update the project status to 'starting'
      queryClient.setQueryData(['projects'], (old: { projects: typeof projects } | undefined) => {
        if (!old?.projects) return old;
        return {
          ...old,
          projects: old.projects.map((p) =>
            p.id === projectId ? { ...p, devServerStatus: 'starting' as const } : p
          ),
        };
      });

      const res = await fetch(`/api/projects/${projectId}/start`, { method: 'POST' });

      if (res.ok) {
        // Poll for status updates since the server starts asynchronously
        const pollForRunning = async (attempts = 0) => {
          if (attempts > 20) return; // Stop after ~10 seconds

          await queryClient.invalidateQueries({ queryKey: ['projects'] });

          // Check if it's running now
          const data = queryClient.getQueryData(['projects']) as { projects: typeof projects } | undefined;
          const project = data?.projects?.find((p) => p.id === projectId);

          if (project?.devServerStatus === 'running' || project?.devServerStatus === 'failed') {
            return; // Done polling
          }

          // Keep polling
          setTimeout(() => pollForRunning(attempts + 1), 500);
        };

        pollForRunning();
      } else {
        // Revert optimistic update on error
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
    } catch (error) {
      console.error('Failed to start server:', error);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  };

  const handleStopServer = async (projectId: string) => {
    try {
      // Optimistically update the project status to 'stopping'
      queryClient.setQueryData(['projects'], (old: { projects: typeof projects } | undefined) => {
        if (!old?.projects) return old;
        return {
          ...old,
          projects: old.projects.map((p) =>
            p.id === projectId ? { ...p, devServerStatus: 'stopping' as const } : p
          ),
        };
      });

      const res = await fetch(`/api/projects/${projectId}/stop`, { method: 'POST' });

      if (res.ok) {
        // Invalidate to get final state
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      } else {
        // Revert optimistic update on error
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
    } catch (error) {
      console.error('Failed to stop server:', error);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  };

  // Get selected runner info
  const selectedRunner = availableRunners.find(r => r.runnerId === selectedRunnerId);
  const selectedRunnerHealthy = selectedRunner
    ? (Date.now() - selectedRunner.lastHeartbeat) < 30000
    : false;

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* Header */}
      <SidebarHeader className={`border-b border-border bg-[var(--theme-primary-muted)] ${isCollapsed ? 'p-2' : 'p-4'}`}>
        {isCollapsed ? (
          // Collapsed header - just the logo icon
          <HoverCard openDelay={0} closeDelay={0}>
            <HoverCardTrigger asChild>
              <a href="/" className="flex items-center justify-center">
<div 
                                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-1.5 border border-white/20"
                                  style={{ background: `linear-gradient(to bottom right, var(--theme-primary), var(--theme-secondary))` }}
                                >
                                  <img
                                    src="/icon-192.png"
                                    alt="Hatchway"
                                    className="h-full w-full object-contain"
                                  />
                                </div>
              </a>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" className="w-auto p-3 bg-popover border-border">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-bold text-popover-foreground">Hatchway</p>
                <p className="text-xs text-muted-foreground">AI App Builder</p>
              </div>
            </HoverCardContent>
          </HoverCard>
        ) : (
          // Expanded header
          <div className="flex items-center gap-3">
            <div 
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-1.5 border border-white/20"
              style={{ background: `linear-gradient(to bottom right, var(--theme-primary), var(--theme-secondary))` }}
            >
              <img
                src="/icon-192.png"
                alt="Hatchway"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-foreground">
                Hatchway
              </h1>
              <p className="text-xs text-muted-foreground">AI App Builder</p>
            </div>
          </div>
        )}
      </SidebarHeader>

      {/* Content - Project List */}
      <SidebarContent className="px-0">
        {/* New Project Button - only show when signed in */}
        {canViewProjects && (
          <>
            <div className={isCollapsed ? 'p-2' : 'p-3'}>
              {isCollapsed ? (
                <HoverCard openDelay={0} closeDelay={0}>
                  <HoverCardTrigger asChild>
                    <a
                      href="/"
                      className="flex items-center justify-center w-8 h-8 mx-auto rounded-md transition-all border border-white/20 hover:border-white/40"
                      style={{ 
                        background: `linear-gradient(to right, var(--theme-primary), var(--theme-secondary))`,
                        color: 'var(--theme-button-text, white)'
                      }}
                    >
                      <Plus className="w-4 h-4" />
                    </a>
                  </HoverCardTrigger>
                  <HoverCardContent side="right" align="center" className="w-auto p-2 px-3 bg-popover border-border">
                    <p className="text-sm text-popover-foreground whitespace-nowrap">New Project</p>
                  </HoverCardContent>
                </HoverCard>
              ) : (
                <a
                  href="/"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium rounded-lg transition-all border border-white/20 hover:border-white/40"
                  style={{ 
                    background: `linear-gradient(to right, var(--theme-primary), var(--theme-secondary))`,
                    color: 'var(--theme-button-text, white)'
                  }}
                >
                  <Plus className="w-4 h-4" />
                  <span>New Project</span>
                </a>
              )}
            </div>
            <SidebarSeparator className="bg-border" />
          </>
        )}

        {!canViewProjects ? (
          // Not authenticated - show sign in prompt
          isCollapsed ? (
            <HoverCard openDelay={0} closeDelay={0}>
              <HoverCardTrigger asChild>
                <div className="flex items-center justify-center py-4">
                  <Lock className="w-6 h-6 text-zinc-700" />
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="center" className="w-auto p-3 bg-popover border-border">
                <p className="text-sm text-muted-foreground font-medium">Sign in to view projects</p>
              </HoverCardContent>
            </HoverCard>
          ) : (
            <div className="px-4 py-8 text-center">
              <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground font-medium">Sign in to view projects</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Your projects will appear here after signing in
              </p>
            </div>
          )
        ) : isLoading ? (
          <div className="px-3 py-4 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-white/5 rounded mb-2" style={{ width: `${60 + (i * 8)}%` }} />
                <div className="h-3 bg-white/5 rounded" style={{ width: `${40 + (i * 5)}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <ProjectList
            projects={projects}
            onStartServer={handleStartServer}
            onStopServer={handleStopServer}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
            isCollapsed={isCollapsed}
          />
        )}
      </SidebarContent>

      {/* Footer - Runner Selector & Settings */}
      <SidebarFooter className={`border-t border-border space-y-2 ${isCollapsed ? 'p-2' : 'p-3'}`}>
        {/* Runner Dropdown - only show when authenticated and NOT in local mode */}
        {canViewProjects && !isLocalMode && (
          isCollapsed ? (
            <HoverCard openDelay={0} closeDelay={0}>
              <HoverCardTrigger asChild>
                <button className="w-full flex items-center justify-center p-2.5 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors">
                  <div className="relative">
                    <Server className="w-5 h-5 text-muted-foreground" />
                    {availableRunners.length > 0 && (
                      <div className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                        selectedRunnerHealthy ? 'bg-green-400' : 'bg-red-400'
                      }`} />
                    )}
                  </div>
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="center" className="w-auto p-3 bg-popover border-border">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">Runner</p>
                  {runnersLoading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : availableRunners.length === 0 ? (
                    <p className="text-sm text-orange-500">No runners connected</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        selectedRunnerHealthy ? 'bg-green-400' : 'bg-red-400'
                      }`} />
                      <p className="text-sm text-popover-foreground">{selectedRunnerId || 'Select runner'}</p>
                    </div>
                  )}
                </div>
              </HoverCardContent>
            </HoverCard>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-muted-foreground" />
                    {runnersLoading ? (
                      <span className="text-xs text-muted-foreground">Loading...</span>
                    ) : availableRunners.length === 0 ? (
                      <span className="text-xs text-orange-500">No runners</span>
                    ) : (
                      <>
                        <div className={`w-2 h-2 rounded-full ${
                          selectedRunnerHealthy ? 'bg-green-400' : 'bg-red-400'
                        }`} />
                        <span className="text-xs text-foreground truncate max-w-[120px]">
                          {selectedRunnerId || 'Select runner'}
                        </span>
                      </>
                    )}
                  </div>
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-popover border-border" align="start" side="top">
                {availableRunners.length === 0 ? (
                  <div className="px-3 py-4 text-center">
                    <Circle className="w-6 h-6 mx-auto mb-2 text-orange-500" />
                    <p className="text-xs text-orange-500 font-medium">No Runners Connected</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Start a runner to begin building</p>
                  </div>
                ) : (
                  availableRunners.filter(runner => runner != null).map((runner) => {
                    const isSelected = runner.runnerId === selectedRunnerId;
                    const isHealthy = (Date.now() - runner.lastHeartbeat) < 30000;

                    return (
                      <DropdownMenuItem
                        key={runner.runnerId}
                        onClick={() => setSelectedRunnerId(runner.runnerId)}
                        className={`flex items-center gap-2 cursor-pointer ${
                          isSelected ? 'bg-[var(--theme-primary-muted)]' : ''
                        }`}
                      >
                        {isSelected ? (
                          <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--theme-primary)' }} />
                        ) : (
                          <Circle className="w-4 h-4 text-muted-foreground" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate text-popover-foreground">{runner.runnerId}</p>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${
                          isHealthy ? 'bg-green-400' : 'bg-red-400'
                        }`} />
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}

        {/* Setup Guide Button - always show when authenticated */}
        {canViewProjects && onOpenOnboarding && (
          isCollapsed ? (
            <HoverCard openDelay={0} closeDelay={0}>
              <HoverCardTrigger asChild>
                <button
                  onClick={onOpenOnboarding}
                  className="w-full flex items-center justify-center p-2.5 bg-[var(--theme-primary-muted)] hover:bg-[color-mix(in_srgb,var(--theme-primary-muted)_150%,transparent)] border border-[var(--theme-primary)]/30 rounded-lg transition-colors relative"
                >
                  <BookOpen className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />
                  {!isLocalMode && availableRunners.length === 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full" />
                  )}
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="center" className="w-auto p-3 bg-popover border-border">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium" style={{ color: 'var(--theme-primary)' }}>Setup Guide</p>
                  {!isLocalMode && availableRunners.length === 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-500/20 text-orange-500 rounded">
                      Action needed
                    </span>
                  )}
                </div>
              </HoverCardContent>
            </HoverCard>
          ) : (
            <button
              onClick={onOpenOnboarding}
              className="w-full flex items-center justify-between px-3 py-2 bg-[var(--theme-primary-muted)] hover:bg-[color-mix(in_srgb,var(--theme-primary-muted)_150%,transparent)] border border-[var(--theme-primary)]/30 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" style={{ color: 'var(--theme-primary)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--theme-primary)' }}>Setup Guide</span>
              </div>
              {!isLocalMode && availableRunners.length === 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-500/20 text-orange-400 rounded">
                  Action needed
                </span>
              )}
            </button>
          )
        )}

        {/* Theme Switcher */}
        <ThemeSwitcher isCollapsed={isCollapsed} />

        {/* User Auth Section */}
        {authLoading ? (
          // Loading state
          <div className={`flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'px-3 py-2'}`}>
            <div className="w-8 h-8 rounded-full bg-zinc-800 animate-pulse" />
          </div>
        ) : !isAuthenticated && !isLocalMode ? (
          // Not authenticated - show sign in button
          isCollapsed ? (
            <HoverCard openDelay={0} closeDelay={0}>
              <HoverCardTrigger asChild>
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="w-full flex items-center justify-center p-2.5 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors"
                >
                  <User className="w-5 h-5 text-muted-foreground" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="center" className="w-auto p-2 px-3 bg-popover border-border">
                <p className="text-sm text-popover-foreground">Sign in</p>
              </HoverCardContent>
            </HoverCard>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors"
            >
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-foreground">Sign in</span>
            </button>
          )
        ) : (
          // Authenticated or local mode - show user avatar dropdown
          isCollapsed ? (
            <DropdownMenu>
              <HoverCard openDelay={0} closeDelay={0}>
                <HoverCardTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button className="w-full flex items-center justify-center p-1.5 hover:bg-white/5 rounded-lg transition-colors">
                      {user?.image ? (
                        <img
                          src={user.image}
                          alt={displayName}
                          className="w-8 h-8 rounded-full border border-white/20"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-theme-gradient flex items-center justify-center text-xs font-medium border border-white/20" style={{ color: 'var(--theme-button-text, white)' }}>
                          {initials}
                        </div>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                </HoverCardTrigger>
                <HoverCardContent side="right" align="center" className="w-auto p-3 bg-popover border-border pointer-events-none">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-popover-foreground">{displayName}</p>
                    {user?.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                    {isLocalMode && <p className="text-xs text-green-500">Local Mode</p>}
                  </div>
                </HoverCardContent>
              </HoverCard>
              <DropdownMenuContent className="w-56 bg-popover border-border" align="start" side="right">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-popover-foreground">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-border" />
                {!isLocalMode && (
                  <>
                    <DropdownMenuItem
                      onClick={() => setShowRunnerKeys(true)}
                      className="cursor-pointer text-popover-foreground focus:text-popover-foreground focus:bg-accent"
                    >
                      <Key className="w-4 h-4 mr-2" />
                      Runner Keys
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      disabled={isSigningOut}
                      className="cursor-pointer text-red-500 focus:text-red-400 focus:bg-red-500/10"
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
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Running in local mode
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors">
                  {user?.image ? (
                    <img
                      src={user.image}
                      alt={displayName}
                      className="w-6 h-6 rounded-full border border-border"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-theme-gradient flex items-center justify-center text-[10px] font-medium border border-border" style={{ color: 'var(--theme-button-text, white)' }}>
                      {initials}
                    </div>
                  )}
                  <span className="text-xs text-foreground truncate flex-1 text-left">{displayName}</span>
                  {isLocalMode && (
                    <span className="px-1 py-0.5 text-[9px] font-medium bg-green-500/20 text-green-500 rounded">
                      LOCAL
                    </span>
                  )}
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-popover border-border" align="start" side="top">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-popover-foreground">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-border" />
                {!isLocalMode && (
                  <>
                    <DropdownMenuItem
                      onClick={() => setShowRunnerKeys(true)}
                      className="cursor-pointer text-popover-foreground focus:text-popover-foreground focus:bg-accent"
                    >
                      <Key className="w-4 h-4 mr-2" />
                      Runner Keys
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      disabled={isSigningOut}
                      className="cursor-pointer text-red-500 focus:text-red-400 focus:bg-red-500/10"
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
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Running in local mode
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}

        {/* Toggle Button */}
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-2 hover:bg-accent rounded-lg transition-colors mt-2"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          )}
        </button>
      </SidebarFooter>

      {/* Auth Modals */}
      <LoginModal
        open={showLoginModal}
        onOpenChange={setShowLoginModal}
      />
      <RunnerKeyManager
        open={showRunnerKeys}
        onOpenChange={setShowRunnerKeys}
      />

      <SidebarRail />
    </Sidebar>
  )
}
