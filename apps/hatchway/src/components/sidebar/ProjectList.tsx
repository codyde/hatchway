"use client"

import { useState, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChevronDown,
  ChevronRight,
  Zap,
  FolderOpen,
  ArrowUpDown,
  Clock,
  SortAsc,
  Folder,
  Loader2,
  Copy,
  Check,
  Play,
  Square,
  ExternalLink,
  Edit3,
  Trash2,
  Server
} from "lucide-react"
import { type Project } from "@/contexts/ProjectContext"
import { ProjectCard } from "./ProjectCard"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { getFrameworkLogo } from "@/lib/framework-logos"
import { useDeleteProject } from "@/mutations/projects"
import { useToast } from "@/components/ui/toast"
import { useTheme } from "@/contexts/ThemeContext"
import Image from "next/image"

interface ProjectListProps {
  projects: Project[]
  onStartServer: (projectId: string) => void
  onStopServer: (projectId: string) => void
  onRename: (project: { id: string; name: string }) => void
  onDelete?: (project: { id: string; name: string; slug: string }) => void // Optional - deletion handled internally
  isCollapsed?: boolean
}

type SortOption = 'recent' | 'name' | 'framework'

// Collapsed project icon component
interface CollapsedProjectIconProps {
  project: Project
  onStartServer: () => void
  onStopServer: () => void
  onRename: () => void
  onDelete: () => void
}

function CollapsedProjectIcon({ 
  project, 
  onStartServer, 
  onStopServer, 
  onRename, 
  onDelete 
}: CollapsedProjectIconProps) {
  const { theme } = useTheme()
  const [copied, setCopied] = useState(false)
  const [hoverCardOpen, setHoverCardOpen] = useState(false)
  const isRunning = project.devServerStatus === 'running'
  const isStarting = project.devServerStatus === 'starting'
  const isStopping = project.devServerStatus === 'stopping'
  const isRestarting = project.devServerStatus === 'restarting'
  const isBuilding = project.status === 'in_progress' || project.status === 'pending'
  const hasFailed = project.status === 'failed' || project.devServerStatus === 'failed'
  const isServerBusy = isStarting || isStopping || isRestarting
  
  const frameworkLogoPath = project.detectedFramework
    ? getFrameworkLogo(project.detectedFramework, theme === 'light' ? 'light' : 'dark')
    : null

  // Get status color
  const getStatusColor = () => {
    if (isRunning) return 'bg-green-400'
    if (hasFailed) return 'bg-red-400'
    if (isBuilding || isServerBusy) return 'bg-yellow-400'
    return 'bg-gray-600'
  }

  // Get status text
  const getStatusText = () => {
    if (isRunning) return `Running on :${project.devServerPort || project.port || 3000}`
    if (isStarting) return 'Starting...'
    if (isStopping) return 'Stopping...'
    if (isRestarting) return 'Restarting...'
    if (isBuilding) return 'Building...'
    if (hasFailed) return 'Failed'
    return project.detectedFramework || 'Project'
  }

  const handleCopyPath = async () => {
    if (project.path) {
      await navigator.clipboard.writeText(project.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenBrowser = () => {
    const port = project.devServerPort || project.port || 3000
    window.open(`http://localhost:${port}`, '_blank')
  }

  // Close hover card when context menu opens
  const handleContextMenuOpen = () => {
    setHoverCardOpen(false)
  }

  // Icon content shared between hover and context triggers
  const iconContent = (
    <>
      {(isBuilding || isServerBusy) ? (
        <Loader2 className={`w-5 h-5 animate-spin ${
          isStarting ? 'text-green-400' :
          isStopping ? 'text-orange-400' :
          isRestarting ? 'text-blue-400' :
          'text-yellow-400'
        }`} />
      ) : frameworkLogoPath ? (
        <div className="relative">
          <Image
            src={frameworkLogoPath}
            alt={project.detectedFramework || ''}
            width={24}
            height={24}
            className="opacity-80"
          />
          <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${getStatusColor()}`} />
        </div>
      ) : (
        <div className="relative">
          <Folder className="w-5 h-5 text-gray-400" />
          <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${getStatusColor()}`} />
        </div>
      )}
    </>
  )

  return (
    <ContextMenu onOpenChange={(open) => open && handleContextMenuOpen()}>
      <HoverCard openDelay={300} closeDelay={0} open={hoverCardOpen} onOpenChange={setHoverCardOpen}>
        <ContextMenuTrigger asChild>
          <HoverCardTrigger asChild>
            <a
              href={`/?project=${project.slug}`}
              className="flex items-center justify-center p-2 hover:bg-white/5 rounded-lg transition-colors relative"
            >
              {iconContent}
            </a>
          </HoverCardTrigger>
        </ContextMenuTrigger>
        <HoverCardContent side="right" align="start" className="w-64 p-3 bg-popover border-border">
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-popover-foreground truncate">{project.name}</p>
              <p className={`text-xs ${
                isRunning ? 'text-green-500' :
                hasFailed ? 'text-red-500' :
                isBuilding || isServerBusy ? 'text-yellow-500' :
                'text-muted-foreground'
              }`}>
                {getStatusText()}
              </p>
            </div>
            {project.runnerId && (
              <div className="flex items-center gap-1.5">
                <Server className="w-3 h-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground truncate">{project.runnerId}</p>
              </div>
            )}
            {project.path && (
              <div className="flex items-center gap-2 group">
                <p className="text-xs text-muted-foreground truncate flex-1 font-mono">{project.path}</p>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleCopyPath()
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground/70">Right-click for more options</p>
          </div>
        </HoverCardContent>
      </HoverCard>
      <ContextMenuContent className="w-52 bg-popover border-border">
        {/* Project name header */}
        <div className="px-2 py-1.5 border-b border-border">
          <p className="text-sm font-medium text-popover-foreground truncate">{project.name}</p>
          <p className={`text-xs ${
            isRunning ? 'text-green-500' :
            hasFailed ? 'text-red-500' :
            isBuilding || isServerBusy ? 'text-yellow-500' :
            'text-muted-foreground'
          }`}>
            {getStatusText()}
          </p>
        </div>

        {/* Server actions */}
        {isRunning && (
          <>
            <ContextMenuItem 
              onClick={handleOpenBrowser}
              className="cursor-pointer text-popover-foreground focus:text-popover-foreground focus:bg-accent"
            >
              <ExternalLink className="w-4 h-4 mr-2 text-muted-foreground" />
              Open in Browser
            </ContextMenuItem>
            <ContextMenuItem 
              onClick={onStopServer}
              disabled={isStopping}
              className="cursor-pointer text-popover-foreground focus:text-popover-foreground focus:bg-accent"
            >
              <Square className="w-4 h-4 mr-2 text-muted-foreground" />
              Stop Server
            </ContextMenuItem>
            <ContextMenuSeparator className="bg-border" />
          </>
        )}

        {!isRunning && !isBuilding && !isServerBusy && project.runCommand && (
          <>
            <ContextMenuItem 
              onClick={onStartServer}
              className="cursor-pointer text-popover-foreground focus:text-popover-foreground focus:bg-accent"
            >
              <Play className="w-4 h-4 mr-2 text-green-500" />
              Start Server
            </ContextMenuItem>
            <ContextMenuSeparator className="bg-border" />
          </>
        )}

        {/* Path with copy */}
        {project.path && (
          <>
            <ContextMenuItem 
              onClick={handleCopyPath}
              className="cursor-pointer text-popover-foreground focus:text-popover-foreground focus:bg-accent"
            >
              {copied ? (
                <Check className="w-4 h-4 mr-2 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 mr-2 text-muted-foreground" />
              )}
              {copied ? 'Copied!' : 'Copy Path'}
            </ContextMenuItem>
            <ContextMenuSeparator className="bg-border" />
          </>
        )}

        {/* Edit actions */}
        <ContextMenuItem 
          onClick={onRename}
          className="cursor-pointer text-popover-foreground focus:text-popover-foreground focus:bg-accent"
        >
          <Edit3 className="w-4 h-4 mr-2 text-muted-foreground" />
          Rename
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-border" />

        {/* Delete action */}
        <ContextMenuItem 
          onClick={onDelete}
          className="cursor-pointer text-red-500 focus:text-red-400 focus:bg-red-500/10"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ProjectList({
  projects,
  onStartServer,
  onStopServer,
  onRename,
  // onDelete is now handled internally via useDeleteProject mutation
  isCollapsed = false
}: ProjectListProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const currentProjectSlug = searchParams?.get('project') ?? null
  const { addToast } = useToast()
  const deleteMutation = useDeleteProject()


  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [activeExpanded, setActiveExpanded] = useState(true)
  const [allExpanded, setAllExpanded] = useState(true)
  const [showAllProjects, setShowAllProjects] = useState(false)

  // Use projects directly (search removed for simplicity)
  const filteredProjects = projects

  // Separate active (building/running) from inactive
  const activeProjects = useMemo(() =>
    filteredProjects.filter(p =>
      p.status === 'in_progress' ||
      p.status === 'pending' ||
      p.devServerStatus === 'running' ||
      p.devServerStatus === 'failed'
    ),
    [filteredProjects]
  )

  const inactiveProjects = useMemo(() => {
    const inactive = filteredProjects.filter(p =>
      p.status !== 'in_progress' &&
      p.status !== 'pending' &&
      p.devServerStatus !== 'running' &&
      p.devServerStatus !== 'failed'
    )

    // Sort inactive projects
    return inactive.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'framework':
          const frameworkA = a.detectedFramework || 'zzz'
          const frameworkB = b.detectedFramework || 'zzz'
          return frameworkA.localeCompare(frameworkB)
        case 'recent':
        default:
          const dateA = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0
          const dateB = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0
          return dateB - dateA
      }
    })
  }, [filteredProjects, sortBy])

  // Show first 10 projects by default, all if expanded
  const displayedProjects = showAllProjects
    ? inactiveProjects
    : inactiveProjects.slice(0, 10)

  const hiddenCount = inactiveProjects.length - displayedProjects.length

  const sortLabels: Record<SortOption, string> = {
    recent: 'Recent',
    name: 'Name',
    framework: 'Framework'
  }

  // State for delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string; slug: string } | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(false)

  const handleDeleteClick = (project: Project) => {
    setProjectToDelete({ id: project.id, name: project.name, slug: project.slug })
    setDeleteFiles(false) // Reset checkbox each time
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return
    
    try {
      const result = await deleteMutation.mutateAsync({
        projectId: projectToDelete.id,
        options: { deleteFiles },
      })

      // Create success message based on actual result
      let message: string
      if (result.filesDeleted) {
        message = `"${projectToDelete.name}" and its files have been deleted`
      } else if (result.filesRequested && !result.filesDeleted) {
        message = `"${projectToDelete.name}" removed (files kept - no runner connected)`
      } else {
        message = `"${projectToDelete.name}" removed from Hatchway`
      }

      addToast('success', message)

      // If we deleted the currently viewed project, navigate home
      if (currentProjectSlug === projectToDelete.slug) {
        router.push('/')
      }

      setDeleteDialogOpen(false)
      setProjectToDelete(null)
      setDeleteFiles(false)
    } catch (error) {
      console.error('Failed to delete project:', error)
      addToast('error', error instanceof Error ? error.message : 'Failed to delete project')
    }
  }

  const handleCloseDeleteDialog = () => {
    if (deleteMutation.isPending) return
    setDeleteDialogOpen(false)
    setProjectToDelete(null)
    setDeleteFiles(false)
  }

  // Collapsed view - just show project icons with context menu
  if (isCollapsed) {
    return (
      <>
        <div className="flex flex-col h-full py-2">
        {/* Active projects section */}
        {activeProjects.length > 0 && (
          <div className="border-b border-border/50 pb-2 mb-2">
              {activeProjects.map(project => (
                <CollapsedProjectIcon 
                  key={project.id} 
                  project={project}
                  onStartServer={() => onStartServer(project.id)}
                  onStopServer={() => onStopServer(project.id)}
                  onRename={() => onRename({ id: project.id, name: project.name })}
                  onDelete={() => handleDeleteClick(project)}
                />
              ))}
            </div>
          )}
          
          {/* All projects section */}
          <div className="flex-1 overflow-y-auto">
            {inactiveProjects.slice(0, 15).map(project => (
              <CollapsedProjectIcon 
                key={project.id} 
                project={project}
                onStartServer={() => onStartServer(project.id)}
                onStopServer={() => onStopServer(project.id)}
                onRename={() => onRename({ id: project.id, name: project.name })}
                onDelete={() => handleDeleteClick(project)}
              />
            ))}
            
            {inactiveProjects.length > 15 && (
              <HoverCard openDelay={0} closeDelay={0}>
                <HoverCardTrigger asChild>
                  <div className="flex items-center justify-center p-2 text-muted-foreground text-xs">
                    +{inactiveProjects.length - 15}
                  </div>
                </HoverCardTrigger>
                <HoverCardContent side="right" align="center" className="w-auto p-2 px-3 bg-popover border-border">
                  <p className="text-xs text-muted-foreground">{inactiveProjects.length - 15} more projects</p>
                </HoverCardContent>
              </HoverCard>
            )}
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={handleCloseDeleteDialog}>
          <AlertDialogContent className="bg-zinc-950 border-zinc-800">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Delete Project</AlertDialogTitle>
              <AlertDialogDescription className="text-zinc-400">
                Are you sure you want to delete <span className="font-medium text-white">&quot;{projectToDelete?.name}&quot;</span>? 
                This will remove the project from Hatchway.
              </AlertDialogDescription>
            </AlertDialogHeader>
            
            {/* Delete files checkbox */}
            <div className="py-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <Checkbox
                  checked={deleteFiles}
                  onCheckedChange={(checked) => setDeleteFiles(checked === true)}
                  className="mt-0.5 border-zinc-600 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                />
                <div className="flex-1">
                  <span className="text-sm text-white group-hover:text-red-400 transition-colors">
                    Also delete project files from disk
                  </span>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {projectToDelete?.slug && (
                      <>Files at <code className="text-zinc-600">~/hatchway-projects/{projectToDelete.slug}</code></>
                    )}
                  </p>
                </div>
              </label>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel 
                disabled={deleteMutation.isPending}
                className="bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700 hover:text-white disabled:opacity-50"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className={`text-white border-0 disabled:opacity-50 ${
                  deleteFiles 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : deleteFiles ? (
                  'Delete Everything'
                ) : (
                  'Remove from Hatchway'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  // Expanded view - full project list
  return (
    <>
    <div className="flex flex-col h-full">
      {/* Project Sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Active Projects Section */}
        {activeProjects.length > 0 && (
          <div className="border-b border-border/50">
            <button
              onClick={() => setActiveExpanded(!activeExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-2">
                {activeExpanded ? (
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                )}
                <Zap className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-foreground">Active</span>
              </div>
              <span className="text-xs text-muted-foreground">{activeProjects.length}</span>
            </button>

            <AnimatePresence>
              {activeExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pb-2 space-y-0.5">
                    {activeProjects.map(project => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        isCurrentProject={project.slug === currentProjectSlug}
                        onStartServer={() => onStartServer(project.id)}
                        onStopServer={() => onStopServer(project.id)}
                        onRename={() => onRename({ id: project.id, name: project.name })}
                        onDelete={() => handleDeleteClick(project)}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* All Projects Section */}
        <div>
          <div className="flex items-center justify-between px-3 py-2">
            <button
              onClick={() => setAllExpanded(!allExpanded)}
              className="flex items-center gap-2 hover:bg-accent transition-colors rounded px-1 -ml-1"
            >
              {allExpanded ? (
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              )}
              <FolderOpen className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Projects</span>
              <span className="text-xs text-muted-foreground">({inactiveProjects.length})</span>
            </button>

            {/* Sort Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors">
                  <ArrowUpDown className="w-3 h-3" />
                  {sortLabels[sortBy]}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-32 bg-popover border-border" align="end">
                <DropdownMenuItem
                  onClick={() => setSortBy('recent')}
                  className={sortBy === 'recent' ? 'bg-white/10' : ''}
                >
                  <Clock className="w-3 h-3 mr-2" />
                  Recent
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSortBy('name')}
                  className={sortBy === 'name' ? 'bg-white/10' : ''}
                >
                  <SortAsc className="w-3 h-3 mr-2" />
                  Name
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSortBy('framework')}
                  className={sortBy === 'framework' ? 'bg-white/10' : ''}
                >
                  <FolderOpen className="w-3 h-3 mr-2" />
                  Framework
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <AnimatePresence>
            {allExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                {displayedProjects.length > 0 ? (
                  <div className="pb-2 space-y-0.5">
                    {displayedProjects.map(project => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        isCurrentProject={project.slug === currentProjectSlug}
                        onStartServer={() => onStartServer(project.id)}
                        onStopServer={() => onStopServer(project.id)}
                        onRename={() => onRename({ id: project.id, name: project.name })}
                        onDelete={() => handleDeleteClick(project)}
                      />
                    ))}

                    {/* Show more button */}
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => setShowAllProjects(true)}
                        className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-center"
                      >
                        Show {hiddenCount} more projects...
                      </button>
                    )}

                    {showAllProjects && inactiveProjects.length > 10 && (
                      <button
                        onClick={() => setShowAllProjects(false)}
                        className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-center"
                      >
                        Show less
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="px-3 py-6 text-center">
                    <p className="text-xs text-muted-foreground">No projects yet</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>

    {/* Delete Confirmation Dialog */}
    <AlertDialog open={deleteDialogOpen} onOpenChange={handleCloseDeleteDialog}>
      <AlertDialogContent className="bg-zinc-950 border-zinc-800">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">Delete Project</AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-400">
            Are you sure you want to delete <span className="font-medium text-white">&quot;{projectToDelete?.name}&quot;</span>? 
            This will remove the project from Hatchway.
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        {/* Delete files checkbox */}
        <div className="py-2">
          <label className="flex items-start gap-3 cursor-pointer group">
            <Checkbox
              checked={deleteFiles}
              onCheckedChange={(checked) => setDeleteFiles(checked === true)}
              className="mt-0.5 border-zinc-600 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
            />
            <div className="flex-1">
              <span className="text-sm text-white group-hover:text-red-400 transition-colors">
                Also delete project files from disk
              </span>
              <p className="text-xs text-zinc-500 mt-0.5">
                {projectToDelete?.slug && (
                  <>Files at <code className="text-zinc-600">~/hatchway-projects/{projectToDelete.slug}</code></>
                )}
              </p>
            </div>
          </label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel 
            disabled={deleteMutation.isPending}
            className="bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700 hover:text-white disabled:opacity-50"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleConfirmDelete}
            disabled={deleteMutation.isPending}
            className={`text-white border-0 disabled:opacity-50 ${
              deleteFiles 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : deleteFiles ? (
              'Delete Everything'
            ) : (
              'Remove from Hatchway'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
