"use client"

import { motion } from "framer-motion"
import {
  MoreHorizontal,
  Play,
  Square,
  ExternalLink,
  Edit3,
  Trash2,
  Folder,
  Loader2,
  Server,
  Unplug
} from "lucide-react"
import { type Project } from "@/contexts/ProjectContext"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getFrameworkLogo } from "@/lib/framework-logos"
import { useTheme } from "@/contexts/ThemeContext"
import Image from "next/image"

interface ProjectCardProps {
  project: Project
  onStartServer?: () => void
  onStopServer?: () => void
  onRename?: () => void
  onDelete?: () => void
  isCurrentProject?: boolean
  showRunner?: boolean
}

export function ProjectCard({
  project,
  onStartServer,
  onStopServer,
  onRename,
  onDelete,
  isCurrentProject = false,
  showRunner = true
}: ProjectCardProps) {
  const { theme } = useTheme()
  const isRunning = project.devServerStatus === 'running'
  const isStarting = project.devServerStatus === 'starting'
  const isStopping = project.devServerStatus === 'stopping'
  const isRestarting = project.devServerStatus === 'restarting'
  const isBuilding = project.status === 'in_progress' || project.status === 'pending'
  const hasFailed = project.status === 'failed' || project.devServerStatus === 'failed'
  const isServerBusy = isStarting || isStopping || isRestarting
  
  // Check if runner is disconnected - project has a runnerId but runner is not connected
  const isRunnerDisconnected = project.runnerId && !project.runnerConnected

  // Get framework logo path (theme-aware)
  const frameworkLogoPath = project.detectedFramework
    ? getFrameworkLogo(project.detectedFramework, theme === 'light' ? 'light' : 'dark')
    : null

  // Format relative time
  const getRelativeTime = (date: Date | string | null) => {
    if (!date) return null
    const now = new Date()
    const then = new Date(date)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return then.toLocaleDateString()
  }

  const handleOpenBrowser = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const port = project.devServerPort || project.port || 3000
    window.open(`http://localhost:${port}`, '_blank')
  }

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    e.preventDefault()
    e.stopPropagation()
    action()
  }

  return (
    <motion.a
      href={`/?project=${project.slug}`}
      className={`group flex items-center gap-2 px-3 py-2 mx-2 rounded-lg transition-all ${
        isCurrentProject
          ? 'bg-theme-gradient border border-theme-primary/30'
          : 'hover:bg-accent'
      }`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
    >
      {/* Status indicator */}
      <div className="relative flex-shrink-0">
        {isRunnerDisconnected ? (
          <Unplug className="w-3.5 h-3.5 text-orange-400" />
        ) : (isBuilding || isServerBusy) ? (
          <Loader2 className={`w-4 h-4 animate-spin ${
            isStarting ? 'text-green-400' :
            isStopping ? 'text-orange-400' :
            isRestarting ? 'text-blue-400' :
            'text-yellow-400'
          }`} />
        ) : (
          <motion.div
            className={`w-2 h-2 rounded-full ${
              isRunning ? 'bg-green-400' :
              hasFailed ? 'bg-red-400' :
              'bg-gray-600'
            }`}
            animate={isRunning ? {
              scale: [1, 1.2, 1],
              opacity: [1, 0.7, 1]
            } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
      </div>

      {/* Project info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm truncate ${
            isCurrentProject ? 'text-foreground font-medium' : 'text-foreground'
          }`}>
            {project.name}
          </span>
        </div>

        {/* Secondary info row */}
        <div className="flex items-center gap-2 mt-0.5">
          {/* Runner disconnected state */}
          {isRunnerDisconnected && (
            <span className="text-[10px] text-orange-400">Runner disconnected</span>
          )}
          {/* Status badge for active states */}
          {!isRunnerDisconnected && isRunning && (
            <>
              <span className="text-[10px] text-green-500 font-medium">
                :{project.devServerPort || project.port}
              </span>
              {showRunner && project.runnerId && (
                <div className="flex items-center gap-1">
                  <Server className="w-2.5 h-2.5 text-muted-foreground/70" />
                  <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">
                    {project.runnerId}
                  </span>
                </div>
              )}
            </>
          )}
          {!isRunnerDisconnected && isStarting && (
            <span className="text-[10px] text-green-500">Starting...</span>
          )}
          {!isRunnerDisconnected && isStopping && (
            <span className="text-[10px] text-orange-500">Stopping...</span>
          )}
          {!isRunnerDisconnected && isRestarting && (
            <span className="text-[10px] text-blue-500">Restarting...</span>
          )}
          {!isRunnerDisconnected && isBuilding && !isServerBusy && (
            <>
              <span className="text-[10px] text-yellow-500">Building...</span>
              {showRunner && project.runnerId && (
                <div className="flex items-center gap-1">
                  <Server className="w-2.5 h-2.5 text-muted-foreground/70" />
                  <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">
                    {project.runnerId}
                  </span>
                </div>
              )}
            </>
          )}
          {!isRunnerDisconnected && hasFailed && (
            <span className="text-[10px] text-red-500">Failed</span>
          )}

          {/* Framework + runner + time for inactive */}
          {!isRunnerDisconnected && !isRunning && !isBuilding && !hasFailed && !isServerBusy && (
            <>
              {frameworkLogoPath && (
                <div className="flex items-center gap-1">
                  <Image
                    src={frameworkLogoPath}
                    alt={project.detectedFramework || ''}
                    width={12}
                    height={12}
                    className="opacity-50"
                  />
                  <span className="text-[10px] text-muted-foreground capitalize">
                    {project.detectedFramework}
                  </span>
                </div>
              )}
              {showRunner && project.runnerId && (
                <div className="flex items-center gap-1">
                  <Server className="w-2.5 h-2.5 text-muted-foreground/70" />
                  <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">
                    {project.runnerId}
                  </span>
                </div>
              )}
              {project.lastActivityAt && (
                <span className="text-[10px] text-muted-foreground">
                  {getRelativeTime(project.lastActivityAt)}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Inline Actions - Always visible */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* Show disabled state when runner is disconnected */}
        {isRunnerDisconnected && (
          <span className="text-[9px] text-orange-400 opacity-0 group-hover:opacity-100 px-1">
            reconnect runner
          </span>
        )}
        
        {!isRunnerDisconnected && isRunning && (
          <>
            <button
              onClick={handleOpenBrowser}
              className="p-1.5 hover:bg-accent rounded transition-colors"
              title="Open in browser"
            >
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
            </button>
            <button
              onClick={(e) => handleAction(e, onStopServer!)}
              disabled={isStopping}
              className="p-1.5 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
              title="Stop server"
            >
              <Square className="w-3.5 h-3.5 text-muted-foreground hover:text-red-500" />
            </button>
          </>
        )}

        {!isRunnerDisconnected && !isRunning && !isBuilding && !isServerBusy && project.runCommand && (
          <button
            onClick={(e) => handleAction(e, onStartServer!)}
            className="p-1.5 hover:bg-green-500/20 rounded transition-colors opacity-0 group-hover:opacity-100"
            title="Start server"
          >
            <Play className="w-3.5 h-3.5 text-muted-foreground hover:text-green-500" />
          </button>
        )}

        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-1.5 hover:bg-accent rounded transition-colors opacity-0 group-hover:opacity-100"
              onClick={(e) => e.preventDefault()}
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-40 bg-popover border-border" side="right" align="start">
            <DropdownMenuItem className="text-popover-foreground hover:bg-accent text-xs" asChild>
              <a href={`/?project=${project.slug}`}>
                <Folder className="w-3 h-3 mr-2 text-muted-foreground" />
                View Project
              </a>
            </DropdownMenuItem>
            {onRename && (
              <DropdownMenuItem
                className="text-popover-foreground hover:bg-accent text-xs cursor-pointer"
                onClick={onRename}
              >
                <Edit3 className="w-3 h-3 mr-2 text-muted-foreground" />
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-border" />
            {onDelete && (
              <DropdownMenuItem
                className="text-red-500 hover:bg-red-500/10 text-xs cursor-pointer"
                onClick={onDelete}
              >
                <Trash2 className="w-3 h-3 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.a>
  )
}
