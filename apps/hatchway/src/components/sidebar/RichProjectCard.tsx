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
  Unplug,
  type LucideIcon
} from "lucide-react"
import { type Project } from "@/contexts/ProjectContext"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useState } from "react"

interface RichProjectCardProps {
  project: Project
  icon: LucideIcon
  onStartServer?: () => void
  onStopServer?: () => void
  onRename?: () => void
  onDelete?: () => void
  compact?: boolean
  isCurrentProject?: boolean
}

export function RichProjectCard({
  project,
  icon: Icon,
  onStartServer,
  onStopServer,
  onRename,
  onDelete,
  compact = false,
  isCurrentProject = false
}: RichProjectCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const isRunning = project.devServerStatus === 'running'
  const isStarting = project.devServerStatus === 'starting'
  const isStopping = project.devServerStatus === 'stopping'
  const isRestarting = project.devServerStatus === 'restarting'
  const isBuilding = project.status === 'in_progress'
  const hasFailed = project.status === 'failed' || project.devServerStatus === 'failed'
  const isServerBusy = isStarting || isStopping || isRestarting
  
  // Check if runner is disconnected - project has a runnerId but runner is not connected
  const isRunnerDisconnected = project.runnerId && !project.runnerConnected

  // Status indicator
  const getStatusColor = () => {
    if (isRunnerDisconnected) return 'bg-orange-400' // Disconnected state
    if (isBuilding) return 'bg-yellow-400'
    if (isStarting) return 'bg-green-400'
    if (isStopping) return 'bg-orange-400'
    if (isRestarting) return 'bg-blue-400'
    if (isRunning) return 'bg-green-400'
    if (hasFailed) return 'bg-red-400'
    if (project.status === 'completed') return 'bg-blue-400'
    return 'bg-gray-600'
  }

  const getStatusAnimation = () => {
    if (isBuilding || isRunning || isServerBusy) {
      return { scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }
    }
    return {}
  }

  const handleOpenBrowser = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const port = project.devServerPort || project.port || 3000
    window.open(`http://localhost:${port}`, '_blank')
  }

  const handleQuickAction = (e: React.MouseEvent, action: () => void) => {
    e.preventDefault()
    e.stopPropagation()
    action()
  }

  if (compact) {
    return (
      <motion.a
        href={`/?project=${project.slug}`}
        className={`block px-3 py-2 rounded-lg transition-all group ${
          isCurrentProject
            ? 'theme-selected'
            : 'hover:bg-white/5'
        }`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="flex items-center gap-2">
          <motion.div
            className={`w-1.5 h-1.5 rounded-full ${getStatusColor()}`}
            animate={getStatusAnimation()}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${
            isCurrentProject ? 'text-theme-primary' : 'text-gray-400 group-hover:text-white'
          }`} />
          <span className={`text-sm truncate flex-1 ${
            isCurrentProject ? 'text-white font-medium' : 'text-white'
          }`}>{project.name}</span>

          {/* Runner badge / Disconnected indicator */}
          {isRunnerDisconnected && !isHovered && (
            <span className="text-[10px] text-orange-400 flex items-center gap-0.5">
              <Unplug className="w-2.5 h-2.5" />
            </span>
          )}
          {project.runnerId && !isRunnerDisconnected && !isHovered && (
            <span className="text-[10px] text-gray-500 font-mono truncate max-w-[60px]">
              {project.runnerId.substring(0, 8)}
            </span>
          )}

          {/* Quick actions on hover */}
          {isHovered && !isRunnerDisconnected && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1"
            >
              {isRunning && (
                <>
                  <button
                    onClick={handleOpenBrowser}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                  >
                    <ExternalLink className="w-3 h-3 text-gray-400" />
                  </button>
                  <button
                    onClick={(e) => handleQuickAction(e, onStopServer!)}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                  >
                    <Square className="w-3 h-3 text-gray-400" />
                  </button>
                </>
              )}
              {!isRunning && !isBuilding && project.runCommand && (
                <button
                  onClick={(e) => handleQuickAction(e, onStartServer!)}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                >
                  <Play className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </motion.div>
          )}
          {isHovered && isRunnerDisconnected && (
            <span className="text-[9px] text-orange-400">disconnected</span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 hover:bg-white/10 rounded transition-colors opacity-0 group-hover:opacity-100">
                <MoreHorizontal className="w-3 h-3 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48 rounded-lg bg-black border-white/10" side="right" align="start">
              <DropdownMenuItem className="text-white hover:bg-white/5" asChild>
                <a href={`/?project=${project.slug}`}>
                  <Folder className="text-gray-400" />
                  <span>View Project</span>
                </a>
              </DropdownMenuItem>
              {onRename && (
                <DropdownMenuItem className="text-white hover:bg-white/5 cursor-pointer" onClick={onRename}>
                  <Edit3 className="text-gray-400" />
                  <span>Rename</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-white/10" />
              {onDelete && (
                <DropdownMenuItem className="text-red-400 hover:bg-red-500/10 cursor-pointer" onClick={onDelete}>
                  <Trash2 className="text-red-400" />
                  <span>Delete</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.a>
    )
  }

  // Full card view
  return (
    <motion.a
      href={`/?project=${project.slug}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`block p-4 rounded-lg transition-all group ${
        isCurrentProject
          ? 'bg-theme-gradient-muted border-2 border-theme-primary\/50'
          : 'bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative">
            <Icon className="w-6 h-6 text-gray-400 group-hover:text-white transition-colors" />
            <motion.div
              className={`absolute -bottom-1 -right-1 w-2 h-2 rounded-full ${getStatusColor()}`}
              animate={getStatusAnimation()}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-white truncate">{project.name}</h3>
            {project.description && (
              <p className="text-xs text-gray-500 truncate">{project.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Status info */}
      <div className="flex items-center gap-2 text-xs mb-3 flex-wrap">
        {isRunnerDisconnected && (
          <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 flex items-center gap-1">
            <Unplug className="w-3 h-3" />
            Runner Disconnected
          </span>
        )}
        {!isRunnerDisconnected && isRunning && (
          <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
            Running :{project.devServerPort || project.port}
          </span>
        )}
        {!isRunnerDisconnected && isStarting && (
          <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
            Starting...
          </span>
        )}
        {!isRunnerDisconnected && isStopping && (
          <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">
            Stopping...
          </span>
        )}
        {!isRunnerDisconnected && isRestarting && (
          <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
            Restarting...
          </span>
        )}
        {!isRunnerDisconnected && isBuilding && (
          <span className="px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
            Building...
          </span>
        )}
        {!isRunnerDisconnected && hasFailed && (
          <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
            Failed
          </span>
        )}
        {project.runnerId && !isRunnerDisconnected && (
          <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono text-[10px]">
            {project.runnerId.substring(0, 12)}
          </span>
        )}
        {project.lastActivityAt && (
          <span className="text-gray-500">
            {new Date(project.lastActivityAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2">
        {isRunnerDisconnected ? (
          <div className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-orange-500/10 border border-orange-500/20 text-orange-300/70 rounded cursor-not-allowed">
            <Unplug className="w-3 h-3" />
            Reconnect runner to continue
          </div>
        ) : isRunning ? (
          <>
            <button
              onClick={handleOpenBrowser}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Open
            </button>
            <button
              onClick={(e) => handleQuickAction(e, onStopServer!)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          </>
        ) : !isBuilding && project.runCommand ? (
          <button
            onClick={(e) => handleQuickAction(e, onStartServer!)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-300 rounded transition-colors"
          >
            <Play className="w-3 h-3" />
            Start
          </button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="px-2 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors">
              <MoreHorizontal className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48 rounded-lg bg-black border-white/10" side="right" align="start">
            <DropdownMenuItem className="text-white hover:bg-white/5" asChild>
              <a href={`/?project=${project.slug}`}>
                <Folder className="text-gray-400" />
                <span>View Project</span>
              </a>
            </DropdownMenuItem>
            {onRename && (
              <DropdownMenuItem className="text-white hover:bg-white/5 cursor-pointer" onClick={onRename}>
                <Edit3 className="text-gray-400" />
                <span>Rename</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-white/10" />
            {onDelete && (
              <DropdownMenuItem className="text-red-400 hover:bg-red-500/10 cursor-pointer" onClick={onDelete}>
                <Trash2 className="text-red-400" />
                <span>Delete</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.a>
  )
}
