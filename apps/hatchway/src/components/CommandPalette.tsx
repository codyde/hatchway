'use client';

import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { useProjects } from '@/contexts/ProjectContext';
import { useRunner } from '@/contexts/RunnerContext';
// SDK mode selection removed - now controlled via environment variables
import { useToast } from '@/components/ui/toast';
import {
  Search,
  Plus,
  Play,
  Square,
  Folder,
  ExternalLink,
  Trash2,
  Edit3,
  CheckSquare,
  XSquare,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Clock,
  Zap,
  Bug,
  type LucideIcon,
} from 'lucide-react';
import { getIconComponent } from '@hatchway/agent-core/lib/icon-mapper';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenameProject?: (project: { id: string; name: string }) => void;
  onDeleteProject?: (project: { id: string; name: string; slug: string }) => void;
}

type CommandAction =
  | { type: 'navigate'; path: string }
  | { type: 'action'; fn: () => void | Promise<void> }
  | { type: 'bulk-select'; projectId: string };

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  action: CommandAction;
  group?: string;
}

export function CommandPalette({ open, onOpenChange, onRenameProject, onDeleteProject }: CommandPaletteProps) {
  const router = useRouter();
  const { projects, refetch } = useProjects();
  const { selectedRunnerId } = useRunner();
  // SDK mode removed - now controlled via environment variables
  const { addToast } = useToast();
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [recentCommands, setRecentCommands] = useState<string[]>([]);

  // Load recent commands from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('recentCommands');
    if (stored) {
      try {
        setRecentCommands(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse recent commands:', e);
      }
    }
  }, []);

  // Save recent command to localStorage
  const trackRecentCommand = (commandId: string) => {
    setRecentCommands((prev) => {
      const updated = [commandId, ...prev.filter((id) => id !== commandId)].slice(0, 5);
      localStorage.setItem('recentCommands', JSON.stringify(updated));
      return updated;
    });
  };

  // Reset all state when closing
  useEffect(() => {
    if (!open) {
      setBulkMode(false);
      setSelectedItems(new Set());
      setLoadingAction(null);
      setSelectedProject(null);
    }
  }, [open]);

  // Handle escape key for navigation
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedProject) {
          e.preventDefault();
          e.stopPropagation();
          setSelectedProject(null);
        }
        // Otherwise let Command.Dialog handle closing
      }
    };

    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => document.removeEventListener('keydown', handleEscape, { capture: true });
  }, [open, selectedProject]);

  // Build command list
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // If a project is selected, show only that project's actions
    if (selectedProject) {
      const project = projects.find(p => p.id === selectedProject);
      if (!project) return items;

      const isRunning = project.devServerStatus === 'running';
      const isBuilding = project.status === 'in_progress';

      // View/Navigate to project
      items.push({
        id: 'view-project',
        label: `Open "${project.name}"`,
        description: 'Go to project workspace',
        icon: Folder,
        action: {
          type: 'action',
          fn: () => {
            router.push(`/?project=${project.slug}`);
            trackRecentCommand('view-project');
            onOpenChange(false);
          },
        },
        group: 'Navigate',
      });

      // Server actions
      if (isRunning) {
        items.push({
          id: 'stop-server',
          label: 'Stop Server',
          description: loadingAction === 'stop-server' ? 'Stopping...' : 'Stop development server',
          icon: Square,
          action: {
            type: 'action',
            fn: async () => {
              setLoadingAction('stop-server');
              await fetch(`/api/projects/${project.id}/stop`, { method: 'POST' });
              await refetch();
              setLoadingAction(null);
              addToast('success', `Server stopped for "${project.name}"`);
              onOpenChange(false);
            },
          },
          group: 'Server',
        });

        items.push({
          id: 'open-browser',
          label: 'Open in Browser',
          description: `localhost:${project.devServerPort || project.port}`,
          icon: ExternalLink,
          action: {
            type: 'action',
            fn: () => {
              const port = project.devServerPort || project.port || 3000;
              window.open(`http://localhost:${port}`, '_blank');
            },
          },
          group: 'Server',
        });
      } else if (!isBuilding && project.runCommand) {
        items.push({
          id: 'start-server',
          label: 'Start Server',
          description: loadingAction === 'start-server' ? 'Starting...' : 'Start development server',
          icon: Play,
          action: {
            type: 'action',
            fn: async () => {
              setLoadingAction('start-server');
              await fetch(`/api/projects/${project.id}/start`, { method: 'POST' });
              await refetch();
              setLoadingAction(null);
              addToast('success', `Server starting for "${project.name}"`);
              onOpenChange(false);
            },
          },
          group: 'Server',
        });
      }

      // Project management
      if (onRenameProject) {
        items.push({
          id: 'rename-project',
          label: 'Rename Project',
          description: 'Change project name',
          icon: Edit3,
          action: {
            type: 'action',
            fn: () => {
              onRenameProject({ id: project.id, name: project.name });
              onOpenChange(false);
            },
          },
          group: 'Manage',
        });
      }

      if (onDeleteProject) {
        items.push({
          id: 'delete-project',
          label: 'Delete Project',
          description: 'Permanently delete this project',
          icon: Trash2,
          action: {
            type: 'action',
            fn: () => {
              onDeleteProject({ id: project.id, name: project.name, slug: project.slug });
              onOpenChange(false);
            },
          },
          group: 'Manage',
        });
      }

      // Debug actions
      items.push({
        id: 'force-reset',
        label: 'Force Reset State',
        description: loadingAction === 'force-reset' ? 'Resetting...' : 'Reset stuck builds & server status',
        icon: Bug,
        action: {
          type: 'action',
          fn: async () => {
            setLoadingAction('force-reset');
            try {
              const response = await fetch(`/api/projects/${project.id}/force-complete`, { method: 'POST' });
              const data = await response.json();
              
              if (response.ok) {
                await refetch();
                addToast('success', data.message || 'Project state reset');
              } else {
                addToast('error', data.error || 'Failed to reset project state');
              }
            } catch (err) {
              addToast('error', 'Failed to reset project state');
            }
            setLoadingAction(null);
            onOpenChange(false);
          },
        },
        group: 'Debug',
      });

      return items;
    }

    // Top-level view: Show global actions and project list
    // Global actions
    items.push({
      id: 'new-project',
      label: 'New Project',
      description: 'Create a new AI-powered project',
      icon: Plus,
      action: { type: 'navigate', path: '/' },
      group: 'Actions',
    });

    // SDK Mode selection removed - now controlled via environment variables:
    // - ENABLE_OPENCODE_SDK=true enables OpenCode SDK
    // - ENABLE_FACTORY_SDK=true enables Factory Droid SDK
    // Users select models via the tag dropdown in the chat input

    // Exit bulk mode if active (only show if in bulk mode)
    if (bulkMode) {
      items.push({
        id: 'exit-bulk',
        label: 'Exit Multi-Select Mode',
        description: 'Clear selection and return to normal mode',
        icon: XSquare,
        action: {
          type: 'action',
          fn: () => {
            setBulkMode(false);
            setSelectedItems(new Set());
          },
        },
        group: 'Actions',
      });
    }

    // Project list - drill down on selection
    projects.forEach((project) => {
      // In bulk mode, show selection toggle
      if (bulkMode) {
        const isSelected = selectedItems.has(project.id);
        items.push({
          id: `select-${project.id}`,
          label: `${isSelected ? '✓ ' : ''}${project.name}`,
          description: isSelected ? 'Click to deselect' : 'Click to select',
          icon: getIconComponent(project.icon),
          action: { type: 'bulk-select', projectId: project.id },
          group: 'Projects',
        });
        return;
      }

      // Normal mode: Show project list with inline status
      const projectIcon = getIconComponent(project.icon);
      const isRunning = project.devServerStatus === 'running';
      const isStarting = project.devServerStatus === 'starting';
      const isBuilding = project.status === 'in_progress' || project.status === 'pending';
      const hasFailed = project.status === 'failed' || project.devServerStatus === 'failed';

      // Build status description
      let statusDesc = '';
      if (isRunning) {
        statusDesc = `🟢 Running :${project.devServerPort || project.port}`;
      } else if (isStarting) {
        statusDesc = '🟡 Starting...';
      } else if (isBuilding) {
        statusDesc = '🟡 Building...';
      } else if (hasFailed) {
        statusDesc = '🔴 Failed';
      } else if (project.detectedFramework) {
        statusDesc = `${project.detectedFramework}`;
      } else {
        statusDesc = 'Idle';
      }

      items.push({
        id: `project-${project.id}`,
        label: project.name,
        description: statusDesc,
        icon: projectIcon,
        action: {
          type: 'action',
          fn: () => setSelectedProject(project.id),
        },
        group: 'Projects',
      });
    });

    return items;
  }, [projects, selectedRunnerId, onRenameProject, onDeleteProject, onOpenChange, refetch, router, bulkMode, selectedItems, loadingAction, selectedProject, addToast]);

  // Filter recent commands that still exist
  const recentCommandItems = useMemo(() => {
    if (selectedProject || bulkMode || recentCommands.length === 0) return [];
    return recentCommands
      .map((id) => commands.find((cmd) => cmd.id === id))
      .filter((cmd): cmd is CommandItem => cmd !== undefined)
      .slice(0, 5);
  }, [recentCommands, commands, selectedProject, bulkMode]);

  // Group commands
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandItem[]>();

    // Add recent commands as first group if available
    if (recentCommandItems.length > 0) {
      groups.set('Recent', recentCommandItems);
    }

    commands.forEach((cmd) => {
      // Skip if already in recent
      if (recentCommandItems.some((r) => r.id === cmd.id)) return;

      const group = cmd.group || 'Other';
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(cmd);
    });
    return Array.from(groups.entries());
  }, [commands, recentCommandItems]);

  // Bulk action handlers
  const handleBulkStopServers = async () => {
    const count = selectedItems.size;
    setLoadingAction('bulk-stop-servers');
    await Promise.all(
      Array.from(selectedItems).map((id) =>
        fetch(`/api/projects/${id}/stop`, { method: 'POST' })
      )
    );
    await refetch();
    setLoadingAction(null);
    setSelectedItems(new Set());
    setBulkMode(false);
    addToast('success', `Stopped ${count} server${count > 1 ? 's' : ''}`);
    onOpenChange(false);
  };

  const handleBulkDelete = async () => {
    const count = selectedItems.size;
    if (confirm(`Are you sure you want to delete ${count} project(s)?`)) {
      setLoadingAction('bulk-delete');
      await Promise.all(
        Array.from(selectedItems).map((id) =>
          fetch(`/api/projects/${id}`, { method: 'DELETE' })
        )
      );
      await refetch();
      setLoadingAction(null);
      setSelectedItems(new Set());
      setBulkMode(false);
      addToast('success', `Deleted ${count} project${count > 1 ? 's' : ''}`);
      onOpenChange(false);
    }
  };

  const handleClearSelection = () => {
    setSelectedItems(new Set());
  };

  const handleSelect = (command: CommandItem, e?: React.MouseEvent | React.KeyboardEvent) => {
    // Check for Cmd/Ctrl+Click for multi-select on project commands
    const isMultiSelect = e && ('metaKey' in e || 'ctrlKey' in e) && (e.metaKey || e.ctrlKey);
    const isProjectCommand = command.id.startsWith('project-');

    // Handle Cmd+Click multi-select for projects
    if (isMultiSelect && isProjectCommand) {
      const projectId = command.id.replace('project-', '');
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (next.has(projectId)) {
          next.delete(projectId);
        } else {
          next.add(projectId);
        }
        return next;
      });
      // Enter bulk mode automatically when multi-selecting
      if (!bulkMode) {
        setBulkMode(true);
      }
      return;
    }

    // Track recent commands (except bulk-select)
    if (command.action.type !== 'bulk-select') {
      trackRecentCommand(command.id);
    }

    const action = command.action;
    switch (action.type) {
      case 'navigate':
        router.push(action.path);
        onOpenChange(false);
        break;
      case 'action':
        action.fn();
        break;
      case 'bulk-select':
        setSelectedItems((prev) => {
          const next = new Set(prev);
          if (next.has(action.projectId)) {
            next.delete(action.projectId);
          } else {
            next.add(action.projectId);
          }
          return next;
        });
        break;
    }
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command Menu"
      className="fixed left-[50%] top-[50%] z-50 w-full max-w-[640px] translate-x-[-50%] translate-y-[-50%]"
    >
      <div className="overflow-hidden rounded-xl border-2 border-theme-primary bg-gray-950 shadow-2xl">
        <VisuallyHidden.Root asChild>
          <Dialog.Title>Command Menu</Dialog.Title>
        </VisuallyHidden.Root>

        {/* Breadcrumb when project selected */}
        {selectedProject && (() => {
          const project = projects.find(p => p.id === selectedProject);
          const isRunning = project?.devServerStatus === 'running';
          const isStarting = project?.devServerStatus === 'starting';
          const isBuilding = project?.status === 'in_progress' || project?.status === 'pending';

          return (
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 theme-card-header">
              <button
                onClick={() => setSelectedProject(null)}
                className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors group"
              >
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
                <span>All Projects</span>
              </button>
              <div className="flex items-center gap-2">
                {isRunning && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
                {isStarting && <Loader2 className="w-3 h-3 text-green-400 animate-spin" />}
                {isBuilding && <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />}
                <span className="text-sm text-white font-medium">{project?.name}</span>
              </div>
            </div>
          );
        })()}

        <div className="flex items-center border-b border-white/10 px-4">
          <Search className="mr-2 h-4 w-4 shrink-0 text-gray-500" />
          <Command.Input
            placeholder={
              selectedProject
                ? 'Search actions...'
                : selectedItems.size > 0
                ? 'Multi-select mode (Cmd+Click to toggle)...'
                : 'Search projects and commands...'
            }
            className="flex h-12 w-full bg-transparent py-3 text-sm text-white placeholder:text-gray-500 outline-none"
          />
          {selectedItems.size > 0 && (
            <span className="ml-2 rounded bg-theme-primary-muted px-2 py-1 text-xs text-theme-accent border border-theme-primary\/30 whitespace-nowrap flex items-center gap-1">
              <CheckSquare className="w-3 h-3" />
              {selectedItems.size} selected
            </span>
          )}
        </div>

        {/* Bulk Action Buttons */}
        {selectedItems.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-theme-primary-muted">
            <button
              onClick={handleBulkStopServers}
              disabled={loadingAction === 'bulk-stop-servers'}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-red-500/20 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingAction === 'bulk-stop-servers' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              <span>Stop {selectedItems.size} Server{selectedItems.size > 1 ? 's' : ''}</span>
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={loadingAction === 'bulk-delete'}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-red-500/20 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingAction === 'bulk-delete' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              <span>Delete {selectedItems.size} Project{selectedItems.size > 1 ? 's' : ''}</span>
            </button>
            <button
              onClick={handleClearSelection}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800/50 border border-gray-700/50 rounded-md hover:bg-gray-800 hover:text-white transition-colors ml-auto"
            >
              <XSquare className="h-3 w-3" />
              <span>Clear</span>
            </button>
          </div>
        )}

        <Command.List className="max-h-[400px] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-gray-500">
            No results found.
          </Command.Empty>

          {groupedCommands.map(([group, items]) => (
            <Command.Group
              key={group}
              heading={group}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-gray-500 [&_[cmdk-group-heading]]:uppercase"
            >
              {items.map((command) => {
                const Icon = command.icon || Folder;
                const isLoading = loadingAction === command.id;
                const isProjectCmd = command.id.startsWith('project-');
                const projectId = isProjectCmd ? command.id.replace('project-', '') : null;
                const isSelected = projectId ? selectedItems.has(projectId) : false;

                return (
                  <Command.Item
                    key={command.id}
                    value={command.label}
                    onSelect={(value, metadata) => {
                      // Handle keyboard Enter - no modifier keys possible
                      handleSelect(command);
                    }}
                    onMouseDown={(e: React.MouseEvent) => {
                      // Intercept mousedown to detect Cmd/Ctrl key before cmdk processes it
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelect(command, e);
                    }}
                    disabled={isLoading}
                    className="relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white outline-none data-[selected=true]:bg-theme-gradient-muted data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed"
                  >
                    {isSelected && (
                      <div className="absolute left-1 top-1 w-1.5 h-1.5 bg-theme-primary rounded-full" />
                    )}
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 shrink-0 text-theme-primary animate-spin" />
                    ) : (
                      <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                    )}
                    <div className="flex-1 overflow-hidden">
                      <div className="font-medium truncate">
                        {isSelected && '✓ '}
                        {command.label}
                      </div>
                      {command.description && (
                        <div className="text-xs text-gray-500 truncate">{command.description}</div>
                      )}
                    </div>
                    {/* Show chevron for project items to indicate drill-down */}
                    {isProjectCmd && !isSelected && (
                      <ChevronRight className="h-4 w-4 text-gray-600" />
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>

        {/* Keyboard Hints Footer */}
        <div className="border-t border-white/10 px-4 py-2 bg-black/20">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">↵</kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">⎋</kbd>
                {selectedProject ? 'Back' : 'Close'}
              </span>
            </div>
            {!selectedProject && !bulkMode && (
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">⌘</kbd>
                <span>+Click for multi-select</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Command.Dialog>
  );
}
