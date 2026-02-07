"use client";

import { Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import * as Sentry from "@sentry/nextjs";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import TabbedPreview from "@/components/TabbedPreview";
import { ResizablePanel } from "@/components/ui/resizable-panel";
import { getModelLogo } from "@/lib/model-logos";
import { getFrameworkLogo } from "@/lib/framework-logos";
import { useTheme } from "@/contexts/ThemeContext";

import RenameProjectModal from "@/components/RenameProjectModal";
import DeleteProjectModal from "@/components/DeleteProjectModal";
import { TodoList } from "@/components/BuildProgress/TodoList";
import { CompletedTodosSummary } from "@/components/CompletedTodosSummary";
import { ErrorDetectedSection } from "@/components/ErrorDetectedSection";
import { PlanningPhase } from "@/components/BuildProgress/PlanningPhase";
import { AgentNotesSection, ActiveAgentNote } from "@/components/AgentNotesSection";
import ProjectMetadataCard from "@/components/ProjectMetadataCard";
import ImageAttachment from "@/components/ImageAttachment";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/components/ui/toast";
import { CommandPaletteProvider } from "@/components/CommandPaletteProvider";
import { SDKModeProvider } from "@/contexts/SDKModeContext";
import { useProjects, type Project } from "@/contexts/ProjectContext";
import { useRunner } from "@/contexts/RunnerContext";
import { useAgent } from "@/contexts/AgentContext";
import { useProjectMessages, useProject } from "@/queries/projects";
import { useGitHubStatus } from "@/queries/github";
import { useSaveMessage } from "@/mutations/messages";
import { useQueryClient } from "@tanstack/react-query";
import { useBrowserMetrics } from "@/hooks/useBrowserMetrics";
import type {
  GenerationState,
  ToolCall,
  BuildOperationType,
  CodexSessionState,
  TodoItem,
  TextMessage,
} from "@/types/generation";
import { deserializeGenerationState } from "@hatchway/agent-core/lib/generation-persistence";
import {
  detectOperationType,
  createFreshGenerationState,
  validateGenerationState,
  createInitialCodexSessionState,
} from "@hatchway/agent-core/lib/build-helpers";
import { processCodexEvent } from "@hatchway/agent-core/lib/agents/codex/events";

import { TagInput } from "@/components/tags/TagInput";
import type { AppliedTag } from "@hatchway/agent-core/types/tags";
import { parseModelTag } from "@hatchway/agent-core/lib/tags/model-parser";
import { getClaudeModelLabel } from "@hatchway/agent-core/client";
import { deserializeTags, serializeTags } from "@hatchway/agent-core/lib/tags/serialization";
import { useBuildWebSocket } from "@/hooks/useBuildWebSocket";
import { WebSocketStatus } from "@/components/WebSocketStatus";
import { useProjectStatusSSE } from "@/hooks/useProjectStatusSSE";
import { useAuthGate } from "@/components/auth/AuthGate";

import { useAuth } from "@/contexts/AuthContext";
import { OnboardingModal, LocalModeOnboarding } from "@/components/onboarding";
import { LoginModal as LoginModalComponent } from "@/components/auth/LoginModal";
import { Button } from "@/components/ui/button";
import { GitHubButton, getGitHubPushMessage, getGitHubSyncMessage, type RepoVisibility } from "@/components/github";

import { DeployToRailwayButton } from "@/components/railway";

import { Monitor, Code, Terminal, MousePointer2, RefreshCw, Copy, Check, Smartphone, Tablet, Cloud, Play, Square, ExternalLink, Loader2, User } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
// Simplified message structure kept
interface MessagePart {
  type: string;

  // Text content
  text?: string;

  // Image content
  image?: string;              // base64 data URL
  mimeType?: string;           // e.g., "image/png"
  fileName?: string;           // e.g., "screenshot.png"

  // Tool content
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  state?: string;
}

interface Message {
  id: string;
  projectId?: string;
  type?: 'user' | 'assistant' | 'system' | 'tool-call' | 'tool-result';
  role?: 'user' | 'assistant';
  content: string;
  parts?: MessagePart[];
  timestamp?: number;
}

const DEBUG_PAGE = false; // Set to true to enable verbose page logging

function extractMarkdownFromMessage(message: Message | null | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return message.content.trim();
  }
  if (message.parts && message.parts.length > 0) {
    const textParts = message.parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0)
      .map((part) => part.text!.trim());
    if (textParts.length > 0) {
      return textParts.join('\n\n');
    }
  }
  return '';
}

function normalizeHydratedState(state: unknown): GenerationState {
  const toDate = (value: unknown): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  const stateObj = state as Record<string, unknown>;
  const normalizedTools: Record<number, ToolCall[]> = {};
  const toolsByTodo = (stateObj.toolsByTodo ?? {}) as Record<number, ToolCall[]>;
  for (const [index, tools] of Object.entries(toolsByTodo)) {
    normalizedTools[Number(index)] = (tools as ToolCall[] | undefined)?.map((tool) => ({
      ...tool,
      startTime: toDate(tool.startTime) ?? new Date(),
      endTime: toDate(tool.endTime),
    })) ?? [];
  }

  const normalizedText: Record<number, TextMessage[]> = {};
  const textByTodo = (stateObj.textByTodo ?? {}) as Record<number, TextMessage[]>;
  for (const [index, notes] of Object.entries(textByTodo)) {
    normalizedText[Number(index)] =
      (notes as TextMessage[] | undefined)?.map((note) => ({
        ...note,
        timestamp: toDate(note.timestamp) ?? new Date(),
      })) ?? [];
  }

  // CRITICAL: Data loaded from database (sessions) should NEVER be marked as active
  // Active state is only valid during live WebSocket connections
  // This prevents stale "Analyzing project" UI from appearing for completed/interrupted builds
  const isActiveFromServer = Boolean(stateObj.isActive);
  const todos = Array.isArray(stateObj.todos) ? (stateObj.todos as TodoItem[]) : [];
  
  // A build can only be considered active if it has in-progress todos
  // If there are no todos or all todos are complete, it's not active
  const hasInProgressTodo = todos.some(t => t.status === 'in_progress');
  const isActuallyActive = isActiveFromServer && hasInProgressTodo;

  const result: GenerationState = {
    id: (stateObj.id as string) ?? '',
    projectId: (stateObj.projectId as string) ?? '',
    projectName: (stateObj.projectName as string) ?? '',
    operationType: (stateObj.operationType as GenerationState['operationType']) ?? 'continuation',
    agentId: stateObj.agentId as GenerationState['agentId'],
    claudeModelId: stateObj.claudeModelId as GenerationState['claudeModelId'],
    todos: todos,
    toolsByTodo: normalizedTools,
    textByTodo: normalizedText,
    activeTodoIndex: (stateObj.activeTodoIndex as number) ?? -1,
    isActive: isActuallyActive,
    startTime: toDate(stateObj.startTime) ?? new Date(),
    endTime: toDate(stateObj.endTime),
    buildSummary: stateObj.buildSummary as string | undefined,
    codex: stateObj.codex as GenerationState['codex'],
    stateVersion: stateObj.stateVersion as number | undefined,
    // Auto-fix tracking fields
    isAutoFix: Boolean(stateObj.isAutoFix),
    autoFixError: stateObj.autoFixError as string | undefined,
    // Source tracking for debugging
    source: (stateObj.source as GenerationState['source']) ?? 'database',
  };
  return result;
}

function HomeContent() {
  // Track browser metrics on page load
  useBrowserMetrics();
  
  // Theme for theme-aware assets
  const { theme } = useTheme();
  
  // Auth gate for protected actions
  const { requireAuth, LoginModal, isAuthenticated } = useAuthGate();
  
  // Auth context for onboarding
  const { isLocalMode, hasCompletedOnboarding, setHasCompletedOnboarding, isLoading: isAuthLoading } = useAuth();
  
  // Onboarding modal state
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  const [input, setInput] = useState("");
  const [imageAttachments, setImageAttachments] = useState<MessagePart[]>([]);
  const queryClient = useQueryClient();

  // Message mutation hook for saving
  const saveMessageMutation = useSaveMessage();

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<{
    name: string;
    framework: string;
    analyzedBy: string;
  } | null>(null);
  const [templateProvisioningInfo, setTemplateProvisioningInfo] = useState<{
    templateName?: string;
    framework?: string;
    downloadPath?: string;
    timestamp?: Date;
  } | null>(null);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [showHeaderLoginModal, setShowHeaderLoginModal] = useState(false);
  const [renamingProject, setRenamingProject] = useState<{ id: string; name: string } | null>(null);
  const [deletingProject, setDeletingProject] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [appliedTags, setAppliedTags] = useState<AppliedTag[]>([]);
  const [generationState, setGenerationState] =
    useState<GenerationState | null>(null);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [isStoppingServer, setIsStoppingServer] = useState(false);
  const [isStartingTunnel, setIsStartingTunnel] = useState(false);
  const [isStoppingTunnel, setIsStoppingTunnel] = useState(false);
  const [devicePreset, setDevicePreset] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [chatPanelWidth, setChatPanelWidth] = useState(450);
  const [activeTab, setActiveTab] = useState<'preview' | 'editor' | 'terminal'>('preview');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const generationStateRef = useRef<GenerationState | null>(generationState);
  const lastRefetchedBuildIdRef = useRef<string | null>(null);
  const freshBuildIdRef = useRef<string | null>(null); // Track fresh build to prevent stale state merging
  const [generationRevision, setGenerationRevision] = useState(0);

  const isThinking =
    generationState?.isActive &&
    (!generationState.todos || generationState.todos.length === 0);
  const classifyMessage = useCallback((message: Message) => {
    const role = (message.role ?? message.type ?? '').toLowerCase();
    if (role === 'user') return 'user';
    if (role === 'assistant' || role === 'tool-result') return 'assistant';
    return 'other';
  }, []);

  const sanitizeMessageText = useCallback((raw: string) => {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') return raw;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }, []);

  const isToolAssistantMessage = useCallback(
    (message: Message | null | undefined) => {
      if (!message) return false;
      if (classifyMessage(message) !== 'assistant') return false;
      return !!message.parts?.some((part) => !!part.toolName);
    },
    [classifyMessage]
  );

  const getMessageContent = useCallback((message: Message | null | undefined) => {
    if (!message) return '';
    if (message.content && message.content.trim().length > 0) {
      return sanitizeMessageText(message.content);
    }
    if (message.parts && message.parts.length > 0) {
      const textContent = message.parts
        .filter((part) => part.type === 'text' && part.text)
        .map((part) => part.text)
        .join(' ');

      if (textContent.trim().length > 0) {
        return sanitizeMessageText(textContent);
      }

      const toolSummaries = message.parts
        .filter((part) => part.toolName)
        .map((part) => {
          if (!part.toolName) return 'Tool update';
          if (part.state === 'output-available') {
            return `${part.toolName} completed`;
          }
          if (part.state === 'input-available') {
            return `${part.toolName} started`;
          }
          return `${part.toolName} updated`;
        });

      if (toolSummaries.length > 0) {
        return toolSummaries.join('\n');
      }
    }
    return '';
  }, [sanitizeMessageText]);




  // WebSocket connection for real-time updates (primary source)
  // FIX: Always enable WebSocket when project exists (eager connection)
  // This ensures we're connected BEFORE follow-up builds start
  // Previous logic was: enabled: !!currentProject && (isGenerating || hasActiveSession)
  // Problem: After build completes, hasActiveSession=false, so WS disconnects
  // Then follow-up build starts but WS isn't reconnected yet (race condition)
  const {
    state: wsState,
    autoFixState,
    isConnected: wsConnected,
    isReconnecting: wsReconnecting,
    error: wsError,
    reconnect: wsReconnect,
    clearAutoFixState,
    clearState: clearWsState,
    cancelBuild,
    isCancelling,
    sentryTrace: wsSentryTrace,
    runnerActive,
  } = useBuildWebSocket({
    projectId: currentProject?.id || '',
    sessionId: undefined, // Subscribe to all sessions for this project
    enabled: !!currentProject, // Always connect when project exists (eager mode)
  });

  // SSE connection for real-time project status updates
  useProjectStatusSSE(currentProject?.id, !!currentProject);

  // Subscribe to single project query for SSE updates
  const { data: projectFromQuery } = useProject(currentProject?.id);
  
  // GitHub status for auto-push feature
  const { data: githubStatus } = useGitHubStatus(currentProject?.id || '');

  // Use ref to track current project state without causing effect re-runs
  const currentProjectRef = useRef(currentProject);
  useEffect(() => {
    currentProjectRef.current = currentProject;
  }, [currentProject]);

  // Sync query data back to currentProject when SSE updates arrive
  // IMPORTANT: Only depend on projectFromQuery to avoid infinite loops
  useEffect(() => {
    const current = currentProjectRef.current;
    if (projectFromQuery && current && projectFromQuery.id === current.id) {
      // Only update if data actually changed (prevent unnecessary re-renders)
      if (projectFromQuery.detectedFramework !== current.detectedFramework ||
          projectFromQuery.devServerStatus !== current.devServerStatus ||
          projectFromQuery.devServerPort !== current.devServerPort ||
          projectFromQuery.tunnelUrl !== current.tunnelUrl ||
          projectFromQuery.runnerConnected !== current.runnerConnected) {
        console.log('[page] 🔄 Syncing project from SSE query update:', {
          detectedFramework: projectFromQuery.detectedFramework,
          existingFramework: current.detectedFramework,
          devServerStatus: projectFromQuery.devServerStatus,
          runnerConnected: projectFromQuery.runnerConnected,
        });

        // STICKY FRAMEWORK: Preserve existing framework if new value is null
        const preservedFramework = projectFromQuery.detectedFramework || current.detectedFramework;

        console.log('[page] 🏷️ Framework update logic:', {
          incomingFramework: projectFromQuery.detectedFramework,
          existingFramework: current.detectedFramework,
          preservedFramework,
          willUpdate: preservedFramework !== current.detectedFramework,
        });

        setCurrentProject({
          ...projectFromQuery,
          detectedFramework: preservedFramework,
        });
      }
    }
  }, [projectFromQuery]); // Only depend on projectFromQuery - use ref for currentProject

  // Load messages from database when project changes
  const {
    data: messagesFromDB,
    refetch: refetchProjectMessages,
  } = useProjectMessages(currentProject?.id);

  // Derive conversation messages from TanStack Query (single source of truth)
  const conversationMessages = useMemo(() => {
    const dbMessages = messagesFromDB?.messages ?? [];
    
    if (DEBUG_PAGE && dbMessages.length > 0) {
      console.log('[conversationMessages] Processing messages from DB:', dbMessages.length);
      dbMessages.slice(0, 3).forEach((msg, idx) => {
        console.log(`  [${idx}] id=${msg.id}, role=${msg.role}, contentType=${typeof msg.content}`, 
          typeof msg.content === 'string' ? msg.content.substring(0, 100) : msg.content);
      });
    }
    
    return dbMessages
      .filter((msg) => !!msg && !!msg.id)
      .map((msg): Message | null => {
        // Handle content that might be an array of parts
        let contentStr = '';
        if (typeof msg.content === 'string') {
          contentStr = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Extract text from parts array
          const contentArray = msg.content as unknown[];
          contentStr = contentArray
            .filter((p: unknown) => {
              const part = p as { type?: string; text?: string };
              return part.type === 'text' && part.text;
            })
            .map((p: unknown) => (p as { text: string }).text)
            .join(' ')
            .trim();
        } else if (msg.content && typeof msg.content === 'object') {
          // Skip error objects - they shouldn't show as messages
          const obj = msg.content as { error?: string };
          if (obj.error) {
            if (DEBUG_PAGE) console.log(`  Filtering out error message: ${msg.id}`, obj.error);
            return null; // Filter out error messages
          }
          contentStr = JSON.stringify(msg.content);
        }
        
        if (!contentStr || contentStr.trim().length === 0) {
          return null; // Filter out empty messages
        }
        
        return {
          id: msg.id,
          content: contentStr,
          parts: msg.parts as MessagePart[] | undefined,
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : new Date(msg.timestamp as unknown as string).getTime(),
          role: msg.role as 'user' | 'assistant' | undefined,
        } as Message;
      })
      .filter((msg): msg is Message => msg !== null);
  }, [messagesFromDB]);

  const initialUserMessage = useMemo(() => {
    if (conversationMessages.length === 0) {
      return null;
    }

    const first = conversationMessages[0];
    if (classifyMessage(first) === 'user') {
      return first;
    }

    const firstUser = conversationMessages.find((message) => classifyMessage(message) === 'user');
    return firstUser ?? first;
  }, [conversationMessages, classifyMessage]);

  const displayedInitialMessage = useMemo(() => {
    if (initialUserMessage) {
      return initialUserMessage;
    }

    if (currentProject?.originalPrompt) {
      const fallbackDate =
        (currentProject.createdAt instanceof Date
          ? currentProject.createdAt
          : currentProject.createdAt
        ) ??
        (currentProject.updatedAt instanceof Date
          ? currentProject.updatedAt
          : currentProject.updatedAt) ??
        new Date();

      return {
        id: 'project-original-prompt',
        projectId: currentProject.id,
        role: 'user' as const,
        type: 'user' as const,
        content: currentProject.originalPrompt,
        timestamp: new Date(fallbackDate).getTime(),
      } satisfies Message;
    }

    return null;
  }, [initialUserMessage, currentProject]);

  const sessionStates = useMemo(() => {
    const sessions = messagesFromDB?.sessions ?? [];
    return sessions
      .map((session) =>
        session.hydratedState ? normalizeHydratedState(session.hydratedState) : null
      )
      .filter((state): state is GenerationState => !!state);
  }, [messagesFromDB]);

  const serverBuilds = useMemo(() => {
    // Include builds that have todos OR have a summary (element edits may complete without todos)
    const builds = sessionStates.filter(
      (state) => !state.isActive && ((state.todos && state.todos.length > 0) || state.buildSummary)
    );

    return builds;
  }, [sessionStates]);

  // Build history: Completed builds from server + current completed build (if not already in server data)
  // BUG FIX: Prevent same build from appearing in BOTH active section AND history
  const buildHistory = useMemo(() => {
    const builds = [...serverBuilds];

    // Include builds that have todos OR have a summary (element edits may complete without todos)
    const hasContent = generationState && 
      !generationState.isActive && 
      ((generationState.todos && generationState.todos.length > 0) || generationState.buildSummary);
    
    if (
      hasContent &&
      !builds.some((build) => build.id === generationState.id)
    ) {
      builds.unshift({ ...generationState, source: generationState.source || 'local' });
    }

    return builds;
  }, [serverBuilds, generationState]);

  const latestCompletedBuild = useMemo(() => {
    // Include builds that have todos OR have a summary
    if (
      generationState &&
      !generationState.isActive &&
      ((generationState.todos && generationState.todos.length > 0) || generationState.buildSummary)
    ) {
      return generationState;
    }
    return buildHistory.length > 0 ? buildHistory[0] : null;
  }, [generationState, buildHistory]);

  // Track which builds we've already triggered auto-push for
  const autoPushedBuildIdsRef = useRef<Set<string>>(new Set());
  // Track pending auto-push to trigger after startGeneration is available
  const pendingAutoPushRef = useRef<{ projectId: string; buildId: string } | null>(null);
  
  // Force refetch when build completes to ensure fresh data from database
  // This eliminates duplicate "Build complete!" messages
  useEffect(() => {
    if (!generationState || generationState.isActive) return;
    if (!generationState.id || !currentProject?.id) return;
    if (lastRefetchedBuildIdRef.current === generationState.id) return;
    
    console.log('✅ [Build Complete] Refetching messages to sync completed build:', {
      buildId: generationState.id,
      projectId: currentProject.id,
    });
    
    lastRefetchedBuildIdRef.current = generationState.id;
    
    // Invalidate queries to force fresh fetch
    queryClient.invalidateQueries({
      queryKey: ['projects', currentProject.id, 'messages'],
      refetchType: 'all',  // Force refetch even if not mounted
    });
    
    // Also trigger explicit refetch
    refetchProjectMessages?.();
    
    // Check if we should auto-push to GitHub
    // Don't auto-push if the build was a GitHub push itself (avoid infinite loop)
    const isGitHubPushBuild = generationState.buildPlan?.toLowerCase().includes('push') && 
                              generationState.buildPlan?.toLowerCase().includes('git');
    if (githubStatus?.isConnected && 
        githubStatus?.autoPush && 
        !isGitHubPushBuild &&
        !autoPushedBuildIdsRef.current.has(generationState.id)) {
      console.log('🐙 [Auto-Push] Scheduling auto-push after build completion');
      autoPushedBuildIdsRef.current.add(generationState.id);
      pendingAutoPushRef.current = { projectId: currentProject.id, buildId: generationState.id };
    }
    
    // NOTE: We intentionally do NOT clear generationState here anymore.
    // The completed build state (with todos and summary) should remain visible
    // until the refetch completes and serverBuilds/buildHistory is populated.
    // This prevents the "blank state" flash that occurred when we cleared state
    // before the DB data arrived. The buildHistory useMemo already handles
    // deduplication to prevent the same build appearing twice.
    console.log('✅ [State Preserved] Keeping completed build in state until server data arrives:', generationState.id);
  }, [generationState, currentProject?.id, refetchProjectMessages, queryClient, serverBuilds, githubStatus]);

  const updateGenerationState = useCallback(
    (
      updater:
        | ((prev: GenerationState | null) => GenerationState | null)
        | GenerationState
        | null
    ) => {
      setGenerationState((prev) => {
        const next =
          typeof updater === "function"
            ? (
                updater as (
                  prev: GenerationState | null
                ) => GenerationState | null
              )(prev)
            : updater;

        generationStateRef.current = next;
        setGenerationRevision((rev) => rev + 1);
        return next;
      });
    },
    []
  );




  // Track if component has mounted to avoid hydration errors
  const [isMounted, setIsMounted] = useState(false);

  // Don't read sessionStorage during SSR - prevents hydration mismatch
  const [activeView, setActiveView] = useState<"chat" | "build">("chat");
  const hasStartedGenerationRef = useRef<Set<string>>(new Set());
  const isGeneratingRef = useRef(false); // Sync flag for immediate checks
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedProjectSlug = searchParams?.get("project") ?? null;
  const { projects, refetch, runnerOnline, setActiveProjectId } = useProjects();
  const { selectedRunnerId, availableRunners } = useRunner();
  const { selectedAgentId, selectedClaudeModelId, claudeModels } = useAgent();
  const { addToast } = useToast();
  const selectedClaudeModel = claudeModels.find(
    (model) => model.id === selectedClaudeModelId,
  );
  const selectedClaudeModelLabel = selectedClaudeModel?.label ?? "Claude Haiku 4.5";

  // Restore view preference from sessionStorage after mount (avoids hydration error)
  useEffect(() => {
    setIsMounted(true);
    const stored = sessionStorage.getItem("preferredView") as
      | "chat"
      | "build"
      | null;
    if (stored) {
      setActiveView(stored);
    }
  }, []);

  // Onboarding modal trigger logic
  // Show onboarding for:
  // - Force flag: ?forceHostedOnboarding=true always shows hosted modal
  // - Users who haven't completed onboarding (both local and hosted mode)
  // Users who completed onboarding can use the "Setup Guide" button if runners disconnect
  const forceHostedOnboarding = searchParams?.get('forceHostedOnboarding') === 'true';
  
  useEffect(() => {
    if (!isMounted) return;
    
    // If force flag is present, always show immediately (bypass all checks)
    if (forceHostedOnboarding) {
      setShowOnboarding(true);
      return;
    }
    
    // Don't show onboarding if auth/onboarding status is still loading
    // This prevents a race condition where hasCompletedOnboarding is false
    // simply because the API hasn't responded yet
    if (isAuthLoading) return;
    
    // Don't show onboarding if not authenticated (hosted mode only)
    if (!isAuthenticated && !isLocalMode) return;
    
    // Determine if we should show onboarding
    // Only show for users who haven't completed onboarding
    // Users who completed onboarding can use the "Setup Guide" button if runners disconnect
    const shouldShow = !hasCompletedOnboarding;
    
    if (shouldShow) {
      // Small delay to let the page settle
      const timer = setTimeout(() => {
        setShowOnboarding(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isMounted, isLocalMode, hasCompletedOnboarding, isAuthenticated, isAuthLoading, forceHostedOnboarding]);

  // Load tags from existing project or initialize defaults for new project
  useEffect(() => {
    if (currentProject?.tags) {
      // Load tags from existing project
      const loadedTags = deserializeTags(currentProject.tags as never);
      setAppliedTags(loadedTags);
    } else if (!selectedProjectSlug && availableRunners.length > 0 && appliedTags.length === 0) {
      // Set default tags ONLY if no tags are currently applied
      // This prevents overwriting user's tag selections when availableRunners updates
      const defaultRunnerId = availableRunners[0]?.runnerId || selectedRunnerId;
      const defaultTags: AppliedTag[] = [
        {
          key: 'runner',
          value: defaultRunnerId,
          appliedAt: new Date()
        },
        {
          key: 'model',
          value: 'claude-haiku-4-5', // Default to Haiku for cost savings
          appliedAt: new Date()
        }
      ];
      setAppliedTags(defaultTags);
      if (DEBUG_PAGE) console.log('[page] ✓ Default tags set: runner=%s, model=claude-haiku-4-5', defaultRunnerId);
    }
  }, [currentProject, selectedProjectSlug, availableRunners, selectedRunnerId, appliedTags.length]);

  useEffect(() => {
    generationStateRef.current = generationState;
  }, [generationState]);

  // Sync WebSocket state to local state (both hydrated and live updates)
  // IMPORTANT: Merge WebSocket updates with existing state to preserve metadata
  // FOLLOW-UP BUILDS: This effect handles the transition from local fresh state to server state:
  //   1. User sends follow-up message
  //   2. startGeneration() creates fresh local state (empty todos, isActive: true)
  //   3. Server creates NEW session and starts build
  //   4. Server sends WebSocket updates with todos, tool calls, etc.
  //   5. This effect merges server updates into local state
  useEffect(() => {
    if (wsState) {
      // GUARD: If we just started a fresh build, ignore stale WebSocket state
      // until we receive updates for the new build
      if (freshBuildIdRef.current && wsState.id !== freshBuildIdRef.current) {
        return; // Skip this update - it's from an old build
      }
      
      // Clear the fresh build guard once we receive matching state from server
      if (freshBuildIdRef.current && wsState.id === freshBuildIdRef.current) {
        freshBuildIdRef.current = null;
      }
      
      setGenerationState((prevState) => {
        // If no previous state, use WebSocket state ONLY if build is active OR has new summary
        // Don't restore completed builds without summaries - they belong in serverBuilds/buildHistory
        if (!prevState) {
          if (!wsState.isActive) {
            // EXCEPTION: If this is a summary update for a just-completed build, accept it
            // This handles the race where build-complete clears state before build-summary arrives
            if (wsState.buildSummary) {
              if (DEBUG_PAGE) console.log('   Accepting completed build from WebSocket (has summary)');
              return wsState;
            }
            if (DEBUG_PAGE) console.log('   Skipping completed build from WebSocket (should be in DB)');
            return null;
          }
          if (DEBUG_PAGE) console.log('   No previous state, using WebSocket state directly');
          // Clear autoFixState when auto-fix session starts
          if (wsState.isAutoFix) {
            console.log('🔧 [Auto-Fix Session] Clearing autoFixState - session started');
            clearAutoFixState();
          }
          return wsState;
        }
        
        // CRITICAL FIX: Check if buildId changed (new build started)
        // If buildId changed, REPLACE old state instead of merging
        // This prevents old build plans from appearing in new follow-up sections
        const buildIdChanged = wsState.id !== prevState.id;
        
        if (buildIdChanged) {
          console.log('🔄 [State Transition] New build detected, replacing state:', {
            oldBuildId: prevState.id,
            newBuildId: wsState.id,
            oldOperationType: prevState.operationType,
            newOperationType: wsState.operationType,
          });
          
          // Replace with new build state (preserve metadata from WebSocket or prev)
          return {
            ...wsState,
            // Ensure metadata is populated
            agentId: wsState.agentId || prevState.agentId,
            claudeModelId: wsState.claudeModelId || prevState.claudeModelId,
            projectId: wsState.projectId || prevState.projectId,
            projectName: wsState.projectName || prevState.projectName,
          };
        }
        
        // If build becomes inactive (completed/failed), keep the state with summary
        // Don't clear it - we need to show the buildSummary until it's saved to DB
        if (!wsState.isActive && prevState.isActive) {
          console.log('🏁 Build became inactive, preserving state with summary:', {
            buildId: wsState.id,
            hasSummary: !!wsState.buildSummary,
            summaryLength: wsState.buildSummary?.length,
          });
          
          // Return the completed state (including buildSummary) instead of null
          return {
            ...prevState,
            ...wsState,
            isActive: false,
            buildSummary: wsState.buildSummary || prevState.buildSummary,
          };
        }

        // Same build - merge updates incrementally
        // This handles todos being added, tools updating, etc. within the same build
        const merged = {
          ...prevState,
          ...wsState,
          // Ensure critical metadata is never lost (use WebSocket value OR previous value)
          agentId: wsState.agentId || prevState.agentId,
          claudeModelId: wsState.claudeModelId || prevState.claudeModelId,
          projectId: wsState.projectId || prevState.projectId,
          projectName: wsState.projectName || prevState.projectName,
          operationType: wsState.operationType || prevState.operationType,
        };
        
        if (DEBUG_PAGE) console.log('   Merged state (same build):', {
          buildId: merged.id,
          agentId: merged.agentId,
          claudeModelId: merged.claudeModelId,
          todosLength: merged.todos?.length,
        });
        
        return merged;
      });
      
      // NOTE: Query invalidation removed from here - it was causing unnecessary refetches
      // during active builds. The build completion effect (line ~538) handles the final
      // sync when a build completes. During active builds, WebSocket state is the source
      // of truth and doesn't need DB sync on every update.
    }
  }, [wsState, wsConnected, currentProject?.id, queryClient, clearAutoFixState]);

  // Track previous wsState values to detect important transitions
  const prevWsStateIsActiveRef = useRef<boolean | undefined>(undefined);
  const prevWsStateSummaryRef = useRef<string | undefined>(undefined);
  
  // Effect to invalidate queries when build completes OR summary arrives via WebSocket
  // This is separate from the state sync effect to avoid side effects in state setters
  useEffect(() => {
    const wasActive = prevWsStateIsActiveRef.current;
    const isNowActive = wsState?.isActive;
    const prevSummary = prevWsStateSummaryRef.current;
    const currentSummary = wsState?.buildSummary;
    
    // Detect transition from active to inactive (build completed)
    if (wasActive === true && isNowActive === false && currentProject?.id) {
      console.log('🔄 [Build Completed] WebSocket state transitioned to inactive - invalidating queries');
      queryClient.invalidateQueries({
        queryKey: ['projects', currentProject.id, 'messages'],
        refetchType: 'all',
      });
    }
    
    // Detect when summary arrives (late-arriving summary after build-complete)
    // This ensures the UI refreshes to show the summary from DB
    if (!prevSummary && currentSummary && !isNowActive && currentProject?.id) {
      console.log('📝 [Build Summary] Summary arrived after completion - invalidating queries');
      queryClient.invalidateQueries({
        queryKey: ['projects', currentProject.id, 'messages'],
        refetchType: 'all',
      });
    }
    
    // Update refs for next comparison
    prevWsStateIsActiveRef.current = isNowActive;
    prevWsStateSummaryRef.current = currentSummary;
  }, [wsState?.isActive, wsState?.buildSummary, currentProject?.id, queryClient]);

  const ensureGenerationState = useCallback(
    (prevState: GenerationState | null): GenerationState | null => {
      // Capture values BEFORE any type narrowing/early returns
      const existingState =
        prevState || generationStateRef.current || generationState;
      const previousOperationType = existingState?.operationType;
      const previousAgentId = existingState?.agentId;
      const previousClaudeModelId = existingState?.claudeModelId;

      if (prevState) return prevState;
      if (generationStateRef.current) return generationStateRef.current;
      if (generationState) return generationState;
      if (currentProject) {
        return createFreshGenerationState({
          projectId: currentProject.id,
          projectName: currentProject.name,
          operationType: previousOperationType ?? "initial-build",
          agentId: previousAgentId ?? selectedAgentId,
          claudeModelId:
            selectedAgentId === "claude-code"
              ? previousClaudeModelId ?? selectedClaudeModelId
              : undefined,
        });
      }
      return null;
    },
    [
      generationState,
      currentProject,
      selectedAgentId,
      selectedClaudeModelId,
    ]
  );

  const updateCodexState = useCallback(
    (mutator: (state: CodexSessionState) => CodexSessionState) => {
      updateGenerationState((prev) => {
        const baseState = ensureGenerationState(prev);
        if (!baseState) return prev;

        const existingCodex =
          baseState.codex ?? createInitialCodexSessionState();
        const workingCodex: CodexSessionState = {
          ...existingCodex,
          phases: existingCodex.phases.map((phase) => ({ ...phase })),
          executionInsights: existingCodex.executionInsights
            ? existingCodex.executionInsights.map((insight) => ({ ...insight }))
            : [],
        };

        const nextCodex = mutator(workingCodex);
        const updated: GenerationState = {
          ...baseState,
          agentId: baseState.agentId ?? "openai-codex",
          codex: {
            ...nextCodex,
            phases: nextCodex.phases.map((phase) => ({ ...phase })),
            executionInsights: nextCodex.executionInsights
              ? nextCodex.executionInsights.map((insight) => ({ ...insight }))
              : [],
            lastUpdatedAt: new Date(),
          },
        };

        if (DEBUG_PAGE) console.log("🌀 Codex state updated:", {
          phases: updated.codex?.phases.map((p) => `${p.id}:${p.status}`),
        });

        // Note: No saveGenerationState() - persistent processor handles all DB writes
        // Frontend just receives WebSocket updates (read-only)
        return updated;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Use ref to access latest projects without triggering effects
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const isLoading = isCreatingProject || isGenerating;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const isNearBottom = useCallback(() => {
    if (!scrollContainerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    const threshold = 100; // pixels from bottom
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, []);

  // Handle tab switching
  const switchTab = useCallback((tab: "chat" | "build") => {
    setActiveView(tab);
    sessionStorage.setItem("preferredView", tab);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        switchTab("chat");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "2") {
        e.preventDefault();
        switchTab("build");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [switchTab]);

  // Listen for selection change requests from SelectionMode
  useEffect(() => {
    const handleSelectionChange = (e: CustomEvent) => {
      const { element, prompt } = e.detail;
      if (DEBUG_PAGE) console.log("🎯 Selection change received:", { element, prompt });

      if (!currentProject) {
        if (DEBUG_PAGE) console.warn("⚠️ No current project for element change");
        return;
      }

      // Switch to Build tab to show build progress
      switchTab("build");

      // Build enhanced prompt with element context using code formatting for selectors/classes
      const elementContext = element ? `

[Element Context]
- Selector: \`${element.selector || 'unknown'}\`
- Tag: \`${element.tagName || 'unknown'}\`
- Class: \`${element.className || 'none'}\`
- Text: ${element.textContent?.substring(0, 100) || 'none'}` : '';
      const enhancedPrompt = `${prompt}${elementContext}`;

      // Use the standard generation flow with isElementChange flag
      startGeneration(currentProject.id, enhancedPrompt, {
        addUserMessage: true,
        isElementChange: true,
      });
    };

    window.addEventListener(
      "selection-change-requested",
      handleSelectionChange as EventListener
    );
    return () =>
      window.removeEventListener(
        "selection-change-requested",
        handleSelectionChange as EventListener
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject]);

  // Auto-switch to Build when todos first populate
  const previousTodoCountRef = useRef(0);
  const codexAutoSwitchRef = useRef(false);
  useEffect(() => {
    codexAutoSwitchRef.current = false;
  }, [generationState?.id]);
  useEffect(() => {
    const currentTodoCount = generationState?.todos?.length || 0;

    if (DEBUG_PAGE) console.log("👀 Todo count tracker:", {
      current: currentTodoCount,
      previous: previousTodoCountRef.current,
      activeView,
      shouldSwitch: currentTodoCount > 0 && previousTodoCountRef.current === 0,
    });

    // If we just got our first todo, switch to build tab (regardless of current tab)
    if (currentTodoCount > 0 && previousTodoCountRef.current === 0) {
      if (DEBUG_PAGE) console.log("📊 First todos arrived! Switching to Build tab");
      switchTab("build");
    }

    previousTodoCountRef.current = currentTodoCount;
  }, [generationState?.todos?.length, activeView, switchTab]);

  useEffect(() => {
    const isCodex =
      (generationState?.agentId ?? selectedAgentId) === "openai-codex";
    if (!isCodex) {
      codexAutoSwitchRef.current = false;
      return;
    }
    if (!generationState?.codex?.lastUpdatedAt) return;
    if (codexAutoSwitchRef.current) return;
    if (DEBUG_PAGE) console.log("🌀 Codex activity detected, switching to Build tab");
    switchTab("build");
    codexAutoSwitchRef.current = true;
  }, [
    generationState?.codex?.lastUpdatedAt,
    generationState?.agentId,
    selectedAgentId,
    switchTab,
  ]);


  // Only auto-scroll if user is near bottom or if loading (new message streaming)
  useEffect(() => {
    if (isLoading || isNearBottom()) {
      scrollToBottom();
    }
  }, [conversationMessages.length, isLoading, generationRevision, isNearBottom, scrollToBottom]);

  // Initialize project when slug or project data changes (handles data arriving after navigation)
  useEffect(() => {
    if (selectedProjectSlug) {
      const project = projectsRef.current.find(
        (p) => p.slug === selectedProjectSlug
      );
      if (project && (!currentProject || currentProject.id !== project.id)) {
        if (DEBUG_PAGE) console.log("🔄 Project changed to:", project.slug);
        if (DEBUG_PAGE) console.log("   Currently generating?", isGeneratingRef.current);
        if (DEBUG_PAGE) console.log("   Has generationState in DB?", !!project.generationState);
        setCurrentProject(project);
        setActiveProjectId(project.id);

        // CRITICAL: Don't touch generationState if we're actively generating!
        if (isGeneratingRef.current) {
          if (DEBUG_PAGE) console.log(
            "⚠️  Generation in progress - keeping existing generationState"
          );
          return;
        }

        // Load persisted generationState if it exists
        if (project.generationState) {
          if (DEBUG_PAGE) console.log("🎨 Restoring generationState from DB...");
          const restored = deserializeGenerationState(
            project.generationState as string
          );

          if (restored && validateGenerationState(restored)) {
            if (DEBUG_PAGE) console.log("   ✅ Valid state, todos:", restored.todos.length);
            // CRITICAL: Force isActive to false when restoring from DB
            // If we're loading from DB, there's no active WebSocket connection driving the build
            // This prevents stuck "Analyzing project" states from interrupted builds
            restored.isActive = false;
            updateGenerationState(restored);
          }
        }

        // Load messages
        if (DEBUG_PAGE) console.log("📥 Loading messages from DB...");
      } else if (!project) {
        if (DEBUG_PAGE) console.log(
          "⚠️  No project found for slug yet:",
          selectedProjectSlug,
          "Projects loaded:",
          projectsRef.current.length
        );
      }
    } else {
      // Leaving project
      if (isGeneratingRef.current) {
        if (DEBUG_PAGE) console.log("⚠️  Generation in progress - not clearing state");
        return;
      }

      setCurrentProject(null);
      setActiveProjectId(null);

      // The useLiveQuery automatically filters by currentProject.id
      // When currentProject is null, query returns empty array
      // TanStack Query handles this automatically

      updateGenerationState(null);
      setTemplateProvisioningInfo(null);
      // Don't clear history - it's now per-project and preserved
      hasStartedGenerationRef.current.clear();
    }
  }, [
    selectedProjectSlug,
    projects,
    currentProject,
    setActiveProjectId,
    updateGenerationState,
  ]);

  // Handle GitHub OAuth callback - select the project that initiated the flow
  useEffect(() => {
    const githubConnectPending = searchParams?.get('github_connect_pending');
    const pendingProjectId = searchParams?.get('projectId');
    
    if (githubConnectPending === 'true' && pendingProjectId && projects.length > 0) {
      // Find the project by ID
      const project = projects.find((p) => p.id === pendingProjectId);
      if (project && (!currentProject || currentProject.id !== project.id)) {
        if (DEBUG_PAGE) console.log("🔄 GitHub OAuth callback - selecting project:", project.slug);
        setCurrentProject(project);
        setActiveProjectId(project.id);
        
        // Update URL to include project slug for consistency
        const url = new URL(window.location.href);
        url.searchParams.set('project', project.slug);
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, [searchParams, projects, currentProject, setActiveProjectId]);

  // Sync currentProject with latest data - immediate for important changes, debounced for rapid updates
  const lastSyncKeyRef = useRef<string>("");
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!selectedProjectSlug || !currentProject) return;

    const latestProject = projects.find((p) => p.id === currentProject.id);
    if (!latestProject) return;

    // Create comparison key from critical fields
    const latestKey = `${latestProject.status}-${latestProject.devServerStatus}-${latestProject.devServerPort}`;

    // If data hasn't changed, skip
    if (lastSyncKeyRef.current === latestKey) return;

    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTimeRef.current;

    // If it's been more than 500ms since last sync, update immediately (user action)
    if (timeSinceLastSync > 500) {
      if (DEBUG_PAGE) console.log(
        "🔄 Syncing currentProject immediately (user action or first update)"
      );
      lastSyncKeyRef.current = latestKey;
      lastSyncTimeRef.current = now;
      setCurrentProject(latestProject);
    } else {
      // Rapid updates - debounce
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }

      syncTimeoutRef.current = setTimeout(() => {
        if (DEBUG_PAGE) console.log("🔄 Syncing currentProject after debounce (rapid updates)");
        lastSyncKeyRef.current = latestKey;
        lastSyncTimeRef.current = Date.now();
        setCurrentProject(latestProject);
      }, 200);
    }

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, selectedProjectSlug]);

  // Clear generationState as a fallback when project TRANSITIONS to completed
  // NOTE: Dev server auto-start is handled SERVER-SIDE in the build-completed event handler
  // (apps/hatchway/src/app/api/runner/events/route.ts lines 638-710)
  // We do NOT auto-start from the frontend to avoid duplicate start commands
  const prevProjectStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const currentStatus = currentProject?.status;
    const prevStatus = prevProjectStatusRef.current;

    // FALLBACK: Only clear if project TRANSITIONED from in_progress to completed
    // This prevents falsely clearing state when a new build starts while project is already "completed"
    // The key insight: project status stays "completed" from the PREVIOUS build, so we can't just check
    // currentStatus === "completed" - we need to detect the actual transition
    if (
      prevStatus === "in_progress" &&
      currentStatus === "completed" &&
      generationState?.isActive &&
      generationState?.projectId === currentProject?.id
    ) {
      console.log("🔄 [Fallback] Project transitioned to completed but generationState still active, clearing...");
      setGenerationState((prev) => prev ? { ...prev, isActive: false } : null);
    }

    prevProjectStatusRef.current = currentStatus || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentProject?.status,
    currentProject?.id,
    generationState?.isActive,
    generationState?.projectId,
  ]);

  // Disabled: We now handle generation directly in handleSubmit without redirects
  // This prevents the flash/reload issue when creating new projects

  const startGeneration = async (
    projectId: string,
    prompt: string,
    options: {
      addUserMessage?: boolean;
      isElementChange?: boolean;
      isRetry?: boolean;
      messageParts?: MessagePart[];
    } = {}
  ) => {
    const {
      addUserMessage = false,
      isElementChange = false,
      isRetry = false,
      messageParts,
    } = options;

    // Lock FIRST
    isGeneratingRef.current = true;
    setIsGenerating(true);

    // Only add user message to UI if this is a continuation (not auto-start)
    if (addUserMessage) {
      const userMessage: Message = {
        id: crypto.randomUUID(), // Use UUID to match database
        projectId: projectId,
        type: "user",
        role: "user",
        content: prompt, // Keep as string for display
        parts: messageParts && messageParts.length > 0 ? messageParts : undefined,
        timestamp: Date.now(),
      };

      // Optimistically add to query cache for immediate display
      queryClient.setQueryData(
        ['projects', projectId, 'messages'],
        (old: unknown) => {
          const data = old as { messages: Message[]; sessions: unknown[] } | undefined;
          if (!data) return { messages: [userMessage], sessions: [] };
          return {
            ...data,
            messages: [...data.messages, userMessage],
          };
        }
      );

      // Save to database so it's included in conversation history
      // PERF: Fire-and-forget - don't block UI on DB write
      // The optimistic cache update above already shows the message immediately
      saveMessageMutation.mutate(
        {
          id: crypto.randomUUID(),
          projectId: projectId,
          type: 'user',
          content: prompt, // Always save text content as string
          parts: messageParts && messageParts.length > 0 ? messageParts : undefined, // Save parts separately if they exist
          timestamp: Date.now(),
        },
        {
          onSuccess: () => {
            if (DEBUG_PAGE) console.log("💾 User message saved to database");
          },
          onError: (error) => {
            console.error("Failed to save user message:", error);
            // Notify user - message is in UI but may not persist after refresh
            addToast("warning", "Your message is visible but may not persist after refresh.");
            // Continue anyway - message is in local state and build still happens
          },
        }
      );
    }

    // Find project and detect operation type
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      console.error("❌ Project not found for ID:", projectId);
      setIsGenerating(false);
      isGeneratingRef.current = false;
      return;
    }

    // Initialize template info from existing project if available
    if (project.projectType && project.projectType !== "unknown" && !selectedTemplate) {
      const agentName = selectedAgentId === "claude-code" ? selectedClaudeModelLabel : "GPT-5 Codex";
      setSelectedTemplate({
        name: project.projectType,
        framework: project.projectType,
        analyzedBy: agentName,
      });
      if (DEBUG_PAGE) console.log(`📦 Initialized template info from project: ${project.projectType}`);
    }

    // Detect operation type
    const operationType = detectOperationType({
      project,
      isElementChange,
      isRetry,
    });
    
    // CRITICAL DEBUG: Log project state and detected operation type
    console.log("🎬 Starting build for existing project:", {
      projectName: project.name,
      projectId: project.id,
      projectStatus: project.status,
      projectPath: project.path,
      hasRunCommand: !!project.runCommand,
      runCommand: project.runCommand,
      detectedOperationType: operationType,
      isElementChange,
      isRetry,
    });

    // Log helpful info about iteration context
    if (operationType === 'enhancement') {
      console.log("✅ Enhancement mode - Agent will receive existing project context:");
      console.log("   - Project location:", project.path);
      console.log("   - Project type:", project.projectType);
      console.log("   - Will modify existing code, not re-scaffold");
    } else if (operationType === 'initial-build') {
      console.warn("⚠️  Initial-build mode detected for existing project!");
      console.warn("   This may cause re-scaffolding. Project status:", project.status);
    }
    
    if (DEBUG_PAGE) console.log("🎬 Starting build:", {
      projectName: project.name,
      operationType,
    });

    // Parse model tag to get effective agent and model BEFORE creating state
    const modelTag = appliedTags.find(t => t.key === 'model');
    let effectiveAgent = selectedAgentId;
    let effectiveClaudeModel = selectedAgentId === "claude-code" ? selectedClaudeModelId : undefined;

    if (modelTag?.value) {
      const parsed = parseModelTag(modelTag.value);
      effectiveAgent = parsed.agent;
      effectiveClaudeModel = parsed.claudeModel;
    }

    // Create FRESH generation state for this build with tag-derived values
    const freshState = createFreshGenerationState({
      projectId: project.id,
      projectName: project.name,
      operationType,
      agentId: effectiveAgent,
      claudeModelId: effectiveClaudeModel,
    });

    console.log('🎬 [Follow-up Debug] Creating fresh state for build:', {
      buildId: freshState.id,
      operationType,
      isActive: freshState.isActive,
      previousBuildId: generationState?.id,
      previousIsActive: generationState?.isActive,
      wsConnected: wsConnected,
      hasWsState: !!wsState,
      wsStateBuildId: wsState?.id,
      projectId: project.id,
    });

    // CRITICAL: Set fresh build ID guard BEFORE updating state
    // This prevents stale WebSocket state from overwriting our fresh state
    freshBuildIdRef.current = freshState.id;
    console.log('🛡️ [Fresh Build Guard] Set guard for new build:', freshState.id);

    // CRITICAL: Clear WebSocket state to prevent stale data from previous build
    // This ensures the old completed build's todos/summary don't flash on screen
    clearWsState();

    // Set the fresh local state (optimistic, will be replaced by WebSocket updates)
    updateGenerationState(freshState);

    console.log('🎬 [Follow-up Debug] Starting generation stream with WebSocket:', {
      wsConnected,
      wsReconnecting,
      hasWsState: !!wsState,
    });

    await startGenerationStream(
      projectId,
      prompt,
      operationType,
      isElementChange,
      undefined, // messageParts
      freshState.id // Pass buildId directly
    );
  };

  // Effect to trigger pending auto-push (after startGeneration is defined)
  useEffect(() => {
    const pending = pendingAutoPushRef.current;
    if (!pending) return;
    
    // Clear the pending ref immediately to prevent double-triggering
    pendingAutoPushRef.current = null;
    
    console.log('🐙 [Auto-Push] Triggering auto-push for build:', pending.buildId);
    
    // Small delay to let the UI settle before starting new generation
    const timer = setTimeout(() => {
      startGeneration(pending.projectId, getGitHubSyncMessage(), {
        addUserMessage: false, // Don't show as user message, it's automatic
      });
    }, 1500);
    
    return () => clearTimeout(timer);
  });

  const startGenerationStream = async (
    projectId: string,
    prompt: string,
    operationType: BuildOperationType,
    isElementChange: boolean = false,
    messageParts?: MessagePart[],
    buildId?: string,
    template?: {
      id: string;
      name: string;
      framework: string;
      port: number;
      runCommand: string;
      repository: string;
      branch: string;
    }
  ) => {
    // CRITICAL: Use the buildId passed from startGeneration() or fall back to ref
    // This ensures client and server use the SAME build ID for proper deduplication
    const existingBuildId = buildId || generationStateRef.current?.id;

    console.log('🆔 [Build ID Sync] Using build ID:', existingBuildId, buildId ? '(passed)' : '(from ref)');

    // Start a Sentry span for the entire build operation
    // This creates the root trace that will be continued by the backend and runner
    return await Sentry.startSpan(
      {
        name: `build.${operationType}`,
        op: 'build.request',
        attributes: {
          'build.id': existingBuildId || 'unknown',
          'build.operation_type': operationType,
          'build.project_id': projectId,
          'build.is_element_change': isElementChange,
        },
      },
      async (span) => {
    try {
      // Derive agent and model from tags if present, otherwise use context
      const modelTag = appliedTags.find(t => t.key === 'model');
      let effectiveAgent = selectedAgentId;
      let effectiveClaudeModel = selectedAgentId === "claude-code" ? selectedClaudeModelId : undefined;

      if (modelTag?.value) {
        const parsed = parseModelTag(modelTag.value);
        effectiveAgent = parsed.agent;
        effectiveClaudeModel = parsed.claudeModel;
      }

      // Derive runner from tags if present, otherwise use context
      const runnerTag = appliedTags.find(t => t.key === 'runner');
      const effectiveRunnerId = runnerTag?.value || selectedRunnerId;

      const res = await fetch(`/api/projects/${projectId}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationType,
          prompt,
          messageParts,
          buildId: existingBuildId,
          runnerId: effectiveRunnerId,
          agent: effectiveAgent,
          claudeModel: effectiveClaudeModel,
          codexThreadId: generationStateRef.current?.codex?.threadId, // For Codex thread resumption
          tags: appliedTags.length > 0 ? appliedTags : undefined, // Tag-based configuration
          template, // Pass template from runner analysis (for initial builds)
          context: isElementChange
            ? {
                elementSelector: "unknown", // Will be enhanced later
                elementInfo: {},
              }
            : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Generation failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader available");

      const decoder = new TextDecoder();
      let currentMessage: Message = {
        id: '',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      const textBlocksMap = new Map<string, { type: string; text: string }>(); // Track text blocks by ID
      let pendingDataLines: string[] = [];
      let streamCompleted = false;

      // Tool messages are handled entirely by the backend (persistent-event-processor)
      // They're saved to the messages table and associated with todos in the database
      // We don't create them on the frontend to avoid duplicates

      const processEventPayload = (payload: string) => {
        if (!payload) {
          return;
        }
        if (payload === "[DONE]") {
          streamCompleted = true;
          return;
        }
        if (payload.startsWith(':')) {
          // Heartbeat/comment frame — ignore
          return;
        }

        try {
          const data = JSON.parse(payload);
          const eventTimestamp = new Date().toISOString();
          if (DEBUG_PAGE) console.log(`\n🌊 [${eventTimestamp}] SSE Event: ${data.type}`, data.toolName ? `(${data.toolName})` : "");

          if (data.type === "start") {
            // Track assistant message locally for UI updates
            // Backend will save to DB (hybrid approach for reliability)
            currentMessage = {
              id: crypto.randomUUID(),
              projectId: projectId,
              type: "assistant",
              role: "assistant",
              content: "",
              timestamp: Date.now(),
            };

            // Optimistically add to query cache for immediate display
            queryClient.setQueryData(
              ['projects', projectId, 'messages'],
              (old: unknown) => {
                const data = old as { messages: Message[]; sessions: unknown[] } | undefined;
                if (!data) return old;
                return {
                  ...data,
                  messages: [...data.messages, currentMessage],
                };
              }
            );
          } else if (data.type === "text-start") {
            // Track text blocks for accumulation
            textBlocksMap.set(data.id, { type: "text", text: "" });
          } else if (data.type === "text-delta") {
            const blockId = data.id;

            // Get or create text block
            let textBlock = textBlocksMap.get(blockId);
            if (!textBlock) {
              textBlock = { type: "text", text: "" };
              textBlocksMap.set(blockId, textBlock);
            }

            // Accumulate text
            textBlock.text += data.delta;

            // Update message content (simplified - just update content string!)
            if (currentMessage?.id) {
              // Combine all text blocks into content
              const allText = Array.from(textBlocksMap.values())
                .map(block => block.text)
                .join('');

              const updatedMessage: Message = {
                ...currentMessage,
                content: allText, // Simple string update!
              };

              currentMessage = updatedMessage;

              // Optimistically update message in query cache
              queryClient.setQueryData(
                ['projects', projectId, 'messages'],
                (old: unknown) => {
                  const data = old as { messages: Message[]; sessions: unknown[] } | undefined;
                  if (!data) return old;
                  const exists = data.messages.some((m) => m.id === updatedMessage.id);
                  return {
                    ...data,
                    messages: exists
                      ? data.messages.map((m) => m.id === updatedMessage.id ? updatedMessage : m)
                      : [...data.messages, updatedMessage],
                  };
                }
              );
            }
          } else if (data.type === "text-end") {
            if (DEBUG_PAGE) console.log("✅ Text block finished:", data.id);
            // Text messages are stored in textByTodo and displayed inside BuildProgress
            // Don't add to main conversation messages array
          } else if (data.type?.startsWith("codex-")) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            updateCodexState((codex) => processCodexEvent(codex, data as any));
          } else if (data.type === "tool-input-available") {
            if (DEBUG_PAGE) console.log(
              "🧰 Tool event detected:",
              data.toolName,
              "toolCallId:",
              data.toolCallId
            );
            if (DEBUG_PAGE) console.log(
              "   Current activeTodoIndex:",
              generationStateRef.current?.activeTodoIndex
            );
            if (DEBUG_PAGE) console.log(
              "   Current todos count:",
              generationStateRef.current?.todos?.length
            );
            // Route TodoWrite to separate generation state

            // Handle CodexThreadCapture - store thread ID for resumption
            if (data.toolName === "CodexThreadCapture") {
              const inputData = data.input as { threadId?: string };
              if (inputData?.threadId) {
                updateGenerationState((prev) => {
                  if (!prev) return null;
                  return {
                    ...prev,
                    codex: {
                      ...(prev.codex || createInitialCodexSessionState()),
                      threadId: inputData.threadId,
                    },
                  };
                });
                if (DEBUG_PAGE) console.log("📝 Codex thread ID captured:", inputData.threadId);
              }
              return;
            }
            if (data.toolName === "TodoWrite") {
              const inputData = data.input as { todos?: TodoItem[] };
              const todos = inputData?.todos || [];
              const timestamp = new Date().toISOString();

              if (DEBUG_PAGE) console.log(`\n━━━ [${timestamp}] 📝 TodoWrite Event Received ━━━`);
              if (DEBUG_PAGE) console.log("   BEFORE: Current state todos:", generationStateRef.current?.todos?.map(
                (t, i) => `[${i}] ${t.status}: ${t.content.substring(0, 40)}`
              ));
              if (DEBUG_PAGE) console.log("   INCOMING: New todos:", todos.length);
              if (DEBUG_PAGE) console.log(
                "   INCOMING: Todo details:",
                todos.map((t, i) => `[${i}] ${t.status}: ${t.content.substring(0, 40)}`)
              );

              // Find the active todo index (first in_progress, or -1 if none)
              const activeIndex = todos.findIndex(
                (t) => t.status === "in_progress"
              );
              if (DEBUG_PAGE) console.log("   ACTIVE INDEX:", activeIndex >= 0 ? activeIndex : "none");
              if (DEBUG_PAGE) console.log("   ACTIVE TODO:", activeIndex >= 0 ? todos[activeIndex]?.content : "none");

              updateGenerationState((prev) => {
                const baseState = ensureGenerationState(prev);
                if (!baseState) {
                  console.error(
                    "❌ Cannot update todos - generationState is null!"
                  );
                  return prev;
                }

                const updated = {
                  ...baseState,
                  todos,
                  activeTodoIndex: activeIndex,
                };

                if (DEBUG_PAGE) console.log("   Active index set to:", activeIndex);

                // Note: No saveGenerationState() - persistent processor handles all DB writes

                if (DEBUG_PAGE) console.log("🧠 Generation state snapshot:", {
                  todoCount: updated.todos.length,
                  activeTodoIndex: updated.activeTodoIndex,
                  todoStatuses: updated.todos.map((t) => t.status),
                });

                return updated;
              });

              // Tool messages handled by backend
            } else {
              // Route other tools to generation state (nested under active todo)
              const timestamp = new Date().toISOString();
              const activeTodoIndex = generationStateRef.current?.activeTodoIndex ?? -1;
              if (DEBUG_PAGE) console.log(`\n━━━ [${timestamp}] 🔧 Tool Call Event ━━━`);
              if (DEBUG_PAGE) console.log(`   TOOL: ${data.toolName} (${data.toolCallId})`);
              if (DEBUG_PAGE) console.log(`   ACTIVE TODO INDEX: ${activeTodoIndex}`);
              if (activeTodoIndex >= 0 && generationStateRef.current?.todos?.[activeTodoIndex]) {
                if (DEBUG_PAGE) console.log(`   ACTIVE TODO: ${generationStateRef.current.todos[activeTodoIndex].content.substring(0, 50)}`);
              } else {
                if (DEBUG_PAGE) console.log(`   ACTIVE TODO: none (will associate with index 0 or wait for TodoWrite)`);
              }

              updateGenerationState((prev) => {
                const baseState = ensureGenerationState(prev);
                if (!baseState) return prev;

                // Skip nesting if todos haven't been created yet
                // Tools will be saved to DB and re-associated when state refreshes from backend
                if (!baseState.todos || baseState.todos.length === 0) {
                  // Silent: This is expected during project exploration phase
                  return prev;
                }

                const tool: ToolCall = {
                  id: data.toolCallId,
                  name: data.toolName,
                  input: data.input,
                  state: "input-available",
                  startTime: new Date(),
                };

                const activeIndex =
                  baseState.activeTodoIndex >= 0
                    ? baseState.activeTodoIndex
                    : 0;
                const existing = baseState.toolsByTodo[activeIndex] || [];

                if (DEBUG_PAGE) console.log(
                  "   ✅ Nesting under todo",
                  activeIndex,
                  "Current tools for this todo:",
                  existing.length
                );

                const updated = {
                  ...baseState,
                  toolsByTodo: {
                    ...baseState.toolsByTodo,
                    [activeIndex]: [...existing, tool],
                  },
                };

                if (DEBUG_PAGE) console.log(
                  "   📊 Updated toolsByTodo:",
                  Object.keys(updated.toolsByTodo)
                    .map(
                      (idx) =>
                        `todo${idx}: ${
                          updated.toolsByTodo[Number(idx)].length
                        } tools`
                    )
                    .join(", ")
                );

                // Note: No saveGenerationState() - persistent processor handles all DB writes

                return updated;
              });

              // Tool messages handled by backend
            }

            // SKIP: Don't add tools to messages - they belong ONLY in BuildProgress!
            // Tools are tracked via toolsByTodo and rendered in BuildProgress component
            // No need to update messages for tools
          } else if (data.type === "tool-output-available") {
            // Update tool in generation state
            const timestamp = new Date().toISOString();
            if (DEBUG_PAGE) console.log(`\n━━━ [${timestamp}] ✅ Tool Output Event ━━━`);
            if (DEBUG_PAGE) console.log(`   TOOL ID: ${data.toolCallId}`);

            updateGenerationState((prev) => {
              const baseState = ensureGenerationState(prev);
              if (!baseState) return prev;

              const newToolsByTodo = { ...baseState.toolsByTodo };

              // Find and update the tool
              for (const todoIndexStr in newToolsByTodo) {
                const todoIndex = parseInt(todoIndexStr);
                const tools = newToolsByTodo[todoIndex];
                const toolIndex = tools.findIndex(
                  (t) => t.id === data.toolCallId
                );
                if (toolIndex >= 0) {
                  const updatedTools = [...tools];
                  updatedTools[toolIndex] = {
                    ...updatedTools[toolIndex],
                    output: data.output,
                    state: "output-available",
                    endTime: new Date(),
                  };
                  newToolsByTodo[todoIndex] = updatedTools;
                  if (DEBUG_PAGE) console.log(`   FOUND: Tool in todo[${todoIndex}], name: ${updatedTools[toolIndex].name}`);
                  break;
                }
              }

              // Note: If tool not found, it arrived before TodoWrite
              // Backend saves it and will re-associate when state refreshes from DB

              const updated = {
                ...baseState,
                toolsByTodo: newToolsByTodo,
              };

              // Note: No saveGenerationState() - persistent processor handles all DB writes

              return updated;
            });

            // Tool messages handled by backend
            // Note: GitHub repo parsing is handled server-side in build-events route

            // REMOVED: Tool output handling for messages
            // Tools are displayed in BuildProgress via toolsByTodo, not as separate messages
            // This code was trying to use old Message.parts structure which doesn't exist
            // in simplified Message (type + content only)
          } else if (
            data.type === "data-reasoning" ||
            data.type === "reasoning"
          ) {
            // Handle reasoning messages - add as text to active todo
            const message =
              (data.data as unknown as { message?: string })?.message ||
              data.message;
            if (DEBUG_PAGE) console.log("💭 Reasoning:", message);

            if (message) {
              updateGenerationState((prev) => {
                if (!prev) return null;

                const activeIndex =
                  prev.activeTodoIndex >= 0 ? prev.activeTodoIndex : 0;
                const existing = prev.textByTodo[activeIndex] || [];

                const updated = {
                  ...prev,
                  textByTodo: {
                    ...prev.textByTodo,
                    [activeIndex]: [
                      ...existing,
                      {
                        id: `reasoning-${Date.now()}`,
                        text: message,
                        timestamp: new Date(),
                      },
                    ],
                  },
                };

                return updated;
              });
            }
          } else if (
            data.type === "data-metadata-extracted" ||
            data.type === "metadata-extracted"
          ) {
            const metadata = (data.data as Record<string, unknown>)?.metadata;
            if (DEBUG_PAGE) console.log("📋 Metadata extracted:", metadata);
            // Could show this in UI if desired
          } else if (
            data.type === "data-template-selected" ||
            data.type === "template-selected"
          ) {
            const template = (data.data as Record<string, unknown>)?.template as Record<string, unknown> | undefined;
            const templateName = template?.name as string | undefined;
            const framework = template?.framework as string | undefined;
            if (DEBUG_PAGE) console.log("🎯 Template selected:", templateName);

            // Store template info for UI display
            setTemplateProvisioningInfo(prev => ({
              ...prev,
              templateName: templateName || prev?.templateName,
              framework: framework || prev?.framework,
              timestamp: new Date(),
            }));
          } else if (
            data.type === "data-template-downloaded" ||
            data.type === "template-downloaded"
          ) {
            const path = (data.data as unknown as { path?: string })?.path;
            if (DEBUG_PAGE) console.log("📦 Template downloaded to:", path);

            // Update template info with download path
            setTemplateProvisioningInfo(prev => ({
              ...prev,
              downloadPath: path,
              timestamp: new Date(),
            }));
          } else if (data.type === "project-metadata") {
            // NEW: Handle project metadata event (includes template info)
            const metadata = data.payload || data.data || data;
            if (DEBUG_PAGE) console.log("🎯 Project metadata received:", metadata);
            if (DEBUG_PAGE) console.log(`   Framework: ${metadata.projectType}`);
            if (DEBUG_PAGE) console.log(`   Run command: ${metadata.runCommand}`);
            if (DEBUG_PAGE) console.log(`   Port: ${metadata.port}`);

            // Store for UI display
            const agentName =
              selectedAgentId === "claude-code"
                ? selectedClaudeModelLabel
                : "GPT-5 Codex";

            if (metadata.projectType && metadata.projectType !== "unknown") {
              setSelectedTemplate({
                name: metadata.projectType,
                framework: metadata.projectType,
                analyzedBy: agentName,
              });
              if (DEBUG_PAGE) console.log(
                `✅ Template selected by ${agentName}: ${metadata.projectType}`
              );
            } else if (templateProvisioningInfo?.templateName) {
              // Fallback to provisioning info if metadata lacks framework
              if (DEBUG_PAGE) console.log(
                `📦 Using provisioning info for template: ${templateProvisioningInfo.templateName}`
              );
              setSelectedTemplate({
                name: templateProvisioningInfo.templateName,
                framework: templateProvisioningInfo.framework || "Unknown",
                analyzedBy: agentName,
              });
            }
          } else if (data.type === "finish") {
            currentMessage = {
              id: '',
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
            };
            textBlocksMap.clear(); // Clear for next message
          }
        } catch (e) {
          console.error("Failed to parse SSE payload:", payload, e);
        }
      };

      const pushChunk = (chunk: string) => {
        if (!chunk) return;

        const normalized = chunk.replace(/\r\n/g, "\n");
        const lines = normalized.split("\n");

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, "");
          const trimmed = line.trim();

          if (trimmed.length === 0) {
            if (pendingDataLines.length > 0) {
              const payload = pendingDataLines.join("\n");
              pendingDataLines = [];
              processEventPayload(payload);
            }
            continue;
          }

          if (trimmed.startsWith(":")) {
            continue;
          }

          const match = trimmed.match(/^data:\s?(.*)$/);
          if (match) {
            pendingDataLines.push(match[1] ?? "");
          } else {
            pendingDataLines.push(trimmed);
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          if (DEBUG_PAGE) console.log("📡 SSE chunk received:", chunk.slice(0, 200));
          if (chunk.includes("TodoWrite")) {
            if (DEBUG_PAGE) console.log("🧩 Chunk contains TodoWrite payload");
          }
          pushChunk(chunk);
        }

        if (done) {
          const finalChunk = decoder.decode();
          if (finalChunk) {
            pushChunk(finalChunk);
          }

          if (pendingDataLines.length > 0) {
            const payload = pendingDataLines.join("\n");
            pendingDataLines = [];
            processEventPayload(payload);
          }

          break;
        }
      }

      if (!streamCompleted) {
        console.warn('⚠️ Generation stream ended without explicit completion signal');
      }

      // Save final message if it exists (arrives after backend closes)
      if (currentMessage && currentMessage.content && currentMessage.content.trim().length > 0) {
        saveMessageMutation.mutate({
          id: currentMessage.id || crypto.randomUUID(),
          projectId: projectId,
          type: 'assistant',
          content: currentMessage.content,
          timestamp: Date.now(),
        });
        
        // Note: GitHub repo parsing is handled server-side in build-events route
      }

      // Ensure final summary todo is marked completed before finishing
      updateGenerationState((prev) => {
        if (!prev || !prev.todos || prev.todos.length === 0) return prev;

        const lastTodoIndex = prev.todos.length - 1;
        const lastTodo = prev.todos[lastTodoIndex];
        if (!lastTodo) return prev;

        const allButLastCompleted = prev.todos
          .slice(0, -1)
          .every((todo) => todo.status === "completed");

        const needsCompletion =
          allButLastCompleted && lastTodo.status !== "completed";

        if (!needsCompletion) {
          return prev;
        }

        const updatedTodos = [...prev.todos];
        updatedTodos[lastTodoIndex] = {
          ...lastTodo,
          status: "completed",
        };

        const completedState = {
          ...prev,
          todos: updatedTodos,
          activeTodoIndex: -1,
        };

        if (DEBUG_PAGE) console.log(
          "✅ Final summary detected, marking last todo as completed"
        );
        // Note: No saveGenerationState() - persistent processor already finalized session

        return completedState;
      });

      // Mark generation as complete and SAVE
      updateGenerationState((prev) => {
        if (!prev) return null;
        const completed = {
          ...prev,
          isActive: false,
          endTime: new Date(),
        };

        // Note: No saveGenerationState() - persistent processor already finalized session

        return completed;
      });

      setCurrentProject((prev) =>
        prev
          ? {
              ...prev,
              status: "completed",
              devServerStatus:
                prev.devServerStatus && prev.devServerStatus !== "stopped"
                  ? prev.devServerStatus
                  : "stopped",
            }
          : prev
      );

      // Refresh once to get final status
      // Don't poll - sync effect handles updates, and window focus has cooldown refetch
      setTimeout(() => refetch(), 1000);
    } catch (error) {
      console.error("Generation error:", error);
      // Set span status to error
      span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'Build failed' });
      // Mark generation as failed and SAVE
      updateGenerationState((prev) => {
        if (!prev) return null;
        const failed = {
          ...prev,
          isActive: false,
          endTime: new Date(),
        };

        // Note: No saveGenerationState() - persistent processor already finalized session

        return failed;
      });
    } finally {
      setIsGenerating(false);
      isGeneratingRef.current = false; // Unlock
      if (DEBUG_PAGE) console.log("🔓 Unlocked generation mode");
      // Keep generationState visible - don't hide it!
      // User can manually dismiss with X button
    }
      } // Close Sentry.startSpan callback
    ); // Close Sentry.startSpan
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow submission if there's either text input or image attachments
    if ((!input.trim() && imageAttachments.length === 0) || isLoading) return;

    // Wrap the actual submission in requireAuth
    // This will show login modal if not authenticated (in hosted mode)
    requireAuth(() => performSubmit());
  };
  
  // The actual submission logic, called after auth is confirmed
  const performSubmit = async () => {
    const userPrompt = input;
    const userImages = imageAttachments;
    setInput("");
    setImageAttachments([]);

    // If no project selected, create new project
    if (!currentProject) {
      setIsCreatingProject(true);
      setTemplateProvisioningInfo(null); // Clear previous template info

      try {
        // Derive agent/model from tags
        const modelTag = appliedTags.find(t => t.key === 'model');
        let effectiveAgent = selectedAgentId;
        let effectiveClaudeModel = selectedAgentId === "claude-code" ? selectedClaudeModelId : undefined;

        if (modelTag?.value) {
          const parsed = parseModelTag(modelTag.value);
          effectiveAgent = parsed.agent;
          effectiveClaudeModel = parsed.claudeModel;
        }

        // Step 1: Analyze project with AI to get friendly name, icon, template
        if (DEBUG_PAGE) console.log("🔍 Analyzing project...");
        const analyzeRes = await fetch("/api/projects/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userPrompt,
            agent: effectiveAgent,
            claudeModel: effectiveClaudeModel,
            tags: serializeTags(appliedTags),
            runnerId: selectedRunnerId,
          }),
        });

        if (!analyzeRes.ok) {
          const errorData = await analyzeRes.json().catch(() => ({}));
          console.error("Analysis failed:", errorData);
          // Fall back to old flow if analysis fails
          throw new Error(errorData.error || "Analysis failed");
        }

        const analyzeData = await analyzeRes.json();
        const analysis = analyzeData.analysis;

        if (DEBUG_PAGE) console.log("✅ Analysis complete:", analysis.friendlyName, `(${analysis.slug})`);

        // Step 2: Create project with AI-generated metadata
        const res = await fetch("/api/projects/create-from-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userPrompt,
            analysis,
            agent: effectiveAgent,
            runnerId: selectedRunnerId,
            claudeModel: effectiveClaudeModel,
            tags: serializeTags(appliedTags),
          }),
        });

        if (!res.ok) throw new Error("Failed to create project");

        const data = await res.json();
        const project = data.project;

        if (DEBUG_PAGE) console.log("✅ Project created:", project.slug);

        // LOCK generation mode FIRST (before anything else!)
        isGeneratingRef.current = true;
        if (DEBUG_PAGE) console.log("🔒 Locked generation mode with ref");

        // Create FRESH generationState BEFORE URL changes
        if (DEBUG_PAGE) console.log(
          "🎬 Creating generation state for initial build:",
          project.name
        );
        console.log("🔍 [page.tsx] Creating fresh state with agent:", {
          effectiveAgent,
          effectiveClaudeModel,
          selectedAgentId,
          selectedClaudeModelId,
          tags: appliedTags,
        });
        const freshState = createFreshGenerationState({
          projectId: project.id,
          projectName: project.name,
          operationType: "initial-build",
          agentId: effectiveAgent,
          claudeModelId: effectiveAgent === "claude-code" ? effectiveClaudeModel : undefined,
        });

        if (DEBUG_PAGE) console.log("✅ Fresh state created:", {
          id: freshState.id,
          todosLength: freshState.todos.length,
          isActive: freshState.isActive,
          agentId: freshState.agentId,
          claudeModelId: freshState.claudeModelId,
        });

        // CRITICAL: Set fresh build guard to prevent stale WebSocket state from overwriting
        // This ensures we only accept updates for THIS new build, not old builds
        freshBuildIdRef.current = freshState.id;
        console.log('🛡️ [Fresh Build Guard] Set guard for new project build:', freshState.id);

        // CRITICAL: Clear WebSocket state to prevent stale data from previous build/project
        clearWsState();

        updateGenerationState(freshState);
        if (DEBUG_PAGE) console.log("✅ GenerationState set in React");

        // Switch to Build tab
        if (DEBUG_PAGE) console.log("🎯 Switching to Build tab for new project");
        switchTab("build");

        // Set project state
        setCurrentProject(project);
        setIsCreatingProject(false);

        // Refresh project list IMMEDIATELY so sidebar updates
        await refetch();
        if (DEBUG_PAGE) console.log("🔄 Sidebar refreshed with new project");

        // Update URL WITHOUT reloading (prevents flash!)
        // This triggers useEffect, but isGeneratingRef is already locked
        router.replace(`/?project=${project.slug}`, { scroll: false });
        if (DEBUG_PAGE) console.log("🔄 URL updated");

        // Add user message (with image support)
        const messageParts: MessagePart[] = [];

        // Add images first (Claude best practice)
        if (userImages.length > 0) {
          messageParts.push(...userImages);
        }

        // Add text content
        if (userPrompt.trim()) {
          messageParts.push({
            type: 'text',
            text: userPrompt.trim(),
          });
        }

        const userMessage: Message = {
          id: crypto.randomUUID(), // Use UUID to match database
          projectId: project.id,
          type: "user",
          role: "user",
          content: userPrompt,
          parts: messageParts.length > 0 ? messageParts : undefined,
          timestamp: Date.now(),
        };

        // Optimistically add to query cache for immediate display
        queryClient.setQueryData(
          ['projects', project.id, 'messages'],
          (old: unknown) => {
            const data = old as { messages: Message[]; sessions: unknown[] } | undefined;
            if (!data) return { messages: [userMessage], sessions: [] };
            return {
              ...data,
              messages: [...data.messages, userMessage],
            };
          }
        );

        // Start generation stream (don't add user message again)
        if (DEBUG_PAGE) console.log("🚀 Starting generation stream...");
        await startGenerationStream(
          project.id,
          userPrompt,
          "initial-build",
          false,
          messageParts.length > 0 ? messageParts : undefined,
          freshState.id, // Pass buildId for initial builds too
          analysis.template // Pass template from runner analysis
        );

        // Refresh project list to pick up final state
        refetch();
      } catch (error) {
        console.error("Error creating project:", error);
        setIsCreatingProject(false);
      }
    } else {
      // Continue conversation on existing project
      // Build message parts array
      const messageParts: MessagePart[] = [];

      // Add images first (Claude best practice)
      if (userImages.length > 0) {
        messageParts.push(...userImages);
      }

      // Add text content
      if (userPrompt.trim()) {
        messageParts.push({
          type: 'text',
          text: userPrompt.trim(),
        });
      }

      await startGeneration(currentProject.id, userPrompt, {
        addUserMessage: true,
        messageParts: messageParts.length > 0 ? messageParts : undefined,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Prevent default paste behavior for images

        const file = item.getAsFile();
        if (!file) continue;

        // Check size limit (5MB for Claude API)
        if (file.size > 5 * 1024 * 1024) {
          console.error('Image too large. Maximum size is 5MB.');
          continue;
        }

        // Check max images (20 per Claude API)
        if (imageAttachments.length >= 20) {
          console.error('Maximum 20 images per message.');
          continue;
        }

        // Verify supported format
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
          console.error('Unsupported format. Use JPEG, PNG, GIF, or WebP.');
          continue;
        }

        // Convert to base64
        try {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64Data = event.target?.result as string;

            setImageAttachments(prev => [...prev, {
              type: 'image',
              image: base64Data,
              mimeType: file.type,
              fileName: file.name || `pasted-image-${Date.now()}.${file.type.split('/')[1]}`,
            }]);
          };
          reader.onerror = () => {
            console.error('Failed to process image. Please try again.');
          };
          reader.readAsDataURL(file);
        } catch (error) {
          console.error('Failed to process image:', error);
        }
      }
    }
  };

  const startDevServer = async () => {
    if (!currentProject || isStartingServer) return;

    setIsStartingServer(true);
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId: selectedRunnerId }),
      });
      if (res.ok) {
        if (DEBUG_PAGE) console.log("✅ Dev server started successfully!");

        const data = await res.json();

        // Update currentProject directly with new status
        setCurrentProject((prev) =>
          prev
            ? {
                ...prev,
                devServerStatus: "starting",
                devServerPid: data.pid,
                devServerPort: data.port,
              }
            : null
        );

        // Mark final todo as completed when server starts!
        updateGenerationState((prev) => {
          if (!prev || !prev.todos || prev.todos.length === 0) return prev;

          const lastTodoIndex = prev.todos.length - 1;
          const lastTodo = prev.todos[lastTodoIndex];
          if (!lastTodo) return prev;

          const allButLastCompleted = prev.todos
            .slice(0, -1)
            .every((todo) => todo.status === "completed");

          if (!allButLastCompleted || lastTodo.status === "completed") {
            return prev;
          }

          const updatedTodos = [...prev.todos];
          updatedTodos[lastTodoIndex] = {
            ...lastTodo,
            status: "completed",
          };

          const completed = {
            ...prev,
            todos: updatedTodos,
          };

          if (DEBUG_PAGE) console.log(
            "🎉 Marking final todo as completed - server is running!"
          );

          // Note: No saveGenerationState() - persistent processor handles all DB writes

          return completed;
        });

        // Poll for port detection (runner sends port-detected event asynchronously)
        let pollCount = 0;
        const maxPolls = 30;

        const pollInterval = setInterval(async () => {
          pollCount++;
          await refetch();

          // Use projectsRef to avoid stale closure
          const updated = projectsRef.current.find(
            (p) => p.id === currentProject.id
          );
          if (
            updated?.devServerStatus === "running" &&
            updated?.devServerPort
          ) {
            if (DEBUG_PAGE) console.log("✅ Port detected, stopping poll");
            clearInterval(pollInterval);
          } else if (pollCount >= maxPolls) {
            if (DEBUG_PAGE) console.log("⏱️ Poll timeout reached, stopping");
            clearInterval(pollInterval);
          }
        }, 1000); // Poll every second
      }
    } catch (error) {
      console.error("Failed to start dev server:", error);
    } finally {
      // Clear loading state after a delay
      setTimeout(() => setIsStartingServer(false), 2000);
    }
  };

  const stopDevServer = async () => {
    if (!currentProject || isStoppingServer) return;

    setIsStoppingServer(true);
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId: selectedRunnerId }),
      });
      if (res.ok) {
        // Update currentProject directly
        setCurrentProject((prev) =>
          prev
            ? {
                ...prev,
                devServerStatus: "stopped",
                devServerPid: null,
                devServerPort: null,
              }
            : null
        );

        // Refresh project list so UI reflects stopped status
        refetch();
      }
    } catch (error) {
      console.error("Failed to stop dev server:", error);
    } finally {
      setTimeout(() => setIsStoppingServer(false), 1000);
    }
  };

  const startTunnel = async () => {
    if (!currentProject || isStartingTunnel) return;

    setIsStartingTunnel(true);
    try {
      const res = await fetch(
        `/api/projects/${currentProject.id}/start-tunnel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runnerId: selectedRunnerId }),
        }
      );
      if (res.ok) {
        if (DEBUG_PAGE) console.log("✅ Tunnel start requested");

        // Poll for tunnel URL to appear
        let pollCount = 0;
        const maxPolls = 15;

        const pollInterval = setInterval(async () => {
          pollCount++;
          await refetch();

          const updated = projectsRef.current.find(
            (p) => p.id === currentProject.id
          );
          if (updated?.tunnelUrl) {
            if (DEBUG_PAGE) console.log("✅ Tunnel URL detected:", updated.tunnelUrl);
            clearInterval(pollInterval);
            setIsStartingTunnel(false);
          } else if (pollCount >= maxPolls) {
            if (DEBUG_PAGE) console.log("⏱️ Tunnel poll timeout reached");
            clearInterval(pollInterval);
            setIsStartingTunnel(false);
          }
        }, 1000);
      } else {
        // API returned an error
        const error = await res.json();
        console.error("Failed to start tunnel:", error);
        setIsStartingTunnel(false);
      }
    } catch (error) {
      console.error("Failed to start tunnel:", error);
      setIsStartingTunnel(false);
    }
  };

  const stopTunnel = async () => {
    if (!currentProject || isStoppingTunnel) return;

    setIsStoppingTunnel(true);
    try {
      const res = await fetch(
        `/api/projects/${currentProject.id}/stop-tunnel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runnerId: selectedRunnerId }),
        }
      );
      if (res.ok) {
        if (DEBUG_PAGE) console.log("✅ Tunnel stop requested");
        // Update currentProject to clear tunnel URL
        setCurrentProject((prev) =>
          prev
            ? {
                ...prev,
                tunnelUrl: null,
              }
            : null
        );
        // Refresh to confirm
        await refetch();
      }
    } catch (error) {
      console.error("Failed to stop tunnel:", error);
    } finally {
      setTimeout(() => setIsStoppingTunnel(false), 1000);
    }
  };

  return (
    <SDKModeProvider>
    <CommandPaletteProvider
      onRenameProject={setRenamingProject}
      onDeleteProject={setDeletingProject}
    >
      {/* Login Modal - shown when auth is required */}
      {LoginModal}
      
      {/* Header Login Modal - for sign in button in top right */}
      <LoginModalComponent
        open={showHeaderLoginModal}
        onOpenChange={setShowHeaderLoginModal}
      />
      
      {/* Onboarding Modal - shown for new users */}
      {/* Debug: Add ?forceHostedOnboarding=true to URL to test SaaS modal in local mode */}
      {isLocalMode && !forceHostedOnboarding ? (
        <LocalModeOnboarding
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
          onComplete={() => {
            setHasCompletedOnboarding(true);
            setShowOnboarding(false);
          }}
        />
      ) : (
        <OnboardingModal
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
          onComplete={() => {
            setHasCompletedOnboarding(true);
            setShowOnboarding(false);
          }}
          forceStartAtStepOne={forceHostedOnboarding}
        />
      )}
      
      {/* WebSocket Connection Status Indicator */}
      {isGenerating && (
        <WebSocketStatus
          isConnected={wsConnected}
          isReconnecting={wsReconnecting}
          error={wsError}
          onReconnect={wsReconnect}
        />
      )}
      
      <SidebarProvider defaultOpen={false}>
        <AppSidebar
          onRenameProject={setRenamingProject}
          onDeleteProject={setDeletingProject}
          onOpenOnboarding={() => setShowOnboarding(true)}
        />
        {renamingProject && (
          <RenameProjectModal
            isOpen={!!renamingProject}
            onClose={() => setRenamingProject(null)}
            projectId={renamingProject.id}
            currentName={renamingProject.name}
            onRenameComplete={() => {
              setRenamingProject(null);
              refetch();
            }}
          />
        )}
        {deletingProject && (
          <DeleteProjectModal
            isOpen={!!deletingProject}
            onClose={() => setDeletingProject(null)}
            projectId={deletingProject.id}
            projectName={deletingProject.name}
            projectSlug={deletingProject.slug}
            onDeleteComplete={(message: string) => {
              setDeletingProject(null);
              refetch();
              // Show success toast
              addToast('success', message);
              // If viewing deleted project, navigate home and reset tags
              if (selectedProjectSlug === deletingProject.slug) {
                router.push('/');
                // Reset tags to default state for fresh start
                if (availableRunners.length > 0) {
                  const defaultRunnerId = availableRunners[0]?.runnerId || selectedRunnerId;
                  const defaultTags: AppliedTag[] = [
                    {
                      key: 'runner',
                      value: defaultRunnerId,
                      appliedAt: new Date()
                    },
                    {
                      key: 'model',
                      value: 'claude-haiku-4-5',
                      appliedAt: new Date()
                    }
                  ];
                  setAppliedTags(defaultTags);
                } else {
                  setAppliedTags([]);
                }
              }
            }}
          />
        )}
        <SidebarInset className="bg-theme-content pt-2">
        {/* Top Header Bar - Breadcrumb and Auth */}
        <header className="flex h-10 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {/* Mobile sidebar trigger */}
            <SidebarTrigger className="md:hidden" />
            {/* Breadcrumb - Project name with status indicator */}
            {currentProject && (
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    currentProject.status === "pending"
                      ? "bg-[#7553FF]"
                      : currentProject.status === "in_progress"
                      ? "bg-[#FFD00E] animate-pulse"
                      : currentProject.status === "completed"
                      ? "bg-[#92DD00]"
                      : "bg-[#FF45A8]"
                  }`}
                />
                <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
                  {currentProject.name}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Integrations - show when project is selected and completed */}
            {currentProject && currentProject.status === 'completed' && (
              <>
                <GitHubButton
                  projectId={currentProject.id}
                  projectSlug={currentProject.slug}
                  isGenerating={isGenerating}
                  onRepoCreated={(repoUrl: string, cloneUrl: string) => {
                    // Repo was created via API - now trigger skill to push code
                    switchTab("build");
                    startGeneration(currentProject.id, getGitHubPushMessage(repoUrl, cloneUrl), {
                      addUserMessage: true,
                    });
                  }}
                  onPushClick={() => {
                    // Push changes to existing repo
                    switchTab("build");
                    startGeneration(currentProject.id, getGitHubSyncMessage(), {
                      addUserMessage: true,
                    });
                  }}
                  variant="default"
                />
                <DeployToRailwayButton
                  projectId={currentProject.id}
                />
              </>
            )}
            {/* Sign in button - show when not authenticated and not in local mode */}
            {!isAuthenticated && !isLocalMode && (
              <Button
                onClick={() => setShowHeaderLoginModal(true)}
                variant="outline"
                size="sm"
                className="bg-transparent border-border text-foreground hover:bg-accent hover:border-border"
              >
                <User className="w-4 h-4 mr-2" />
                Sign in
              </Button>
            )}
          </div>
        </header>
        
        {runnerOnline === false && (
          <div className="bg-amber-500/20 border border-amber-400/40 text-amber-200 px-4 py-2 text-sm">
            Local runner is offline. Start the runner CLI on your machine to
            enable builds and previews.
          </div>
        )}
        
        {/* Project's runner disconnected warning - also check runnerActive which tracks recent WebSocket events */}
        {currentProject && currentProject.runnerId && !currentProject.runnerConnected && !runnerActive && (
          <div className="bg-orange-500/20 border border-orange-400/40 text-orange-200 px-4 py-2 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m19 5 3-3"/>
                <path d="m2 22 3-3"/>
                <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/>
                <path d="M7.5 13.5 10 11"/>
                <path d="M10.5 16.5 13 14"/>
                <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-3.6-3.6a2.4 2.4 0 0 0-3.4 0Z"/>
              </svg>
              <span>
                <strong>Runner disconnected.</strong> This project was managed by runner <code className="bg-orange-400/20 px-1 rounded text-xs">{currentProject.runnerId}</code> which is no longer connected. 
                Restart the runner CLI to continue working on this project.
              </span>
            </div>
          </div>
        )}
        <div className="h-[calc(100vh-3.5rem)] bg-theme-content text-foreground flex flex-col overflow-hidden">
          {/* Landing Page */}
          <AnimatePresence mode="wait">
            {conversationMessages.length === 0 &&
              !selectedProjectSlug &&
              !isCreatingProject && (
                <motion.div
                  key="landing"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.5 }}
                  className="flex-1 flex items-center justify-center p-4"
                >
                  <div className="w-full h-full flex items-center justify-center overflow-x-auto">
                    {/* Main Input - Centered */}
                    <div className="relative w-full max-w-5xl mx-auto px-4">
                      {/* Logo and 3D block ASCII title above prompt */}
                      <div className="flex items-center justify-center gap-6 mb-8">
                        <img
                          src="/icon-192.png"
                          alt="Hatchway"
                          className="w-24 h-24 object-contain"
                        />
                        {/* ASCII art - hidden on narrow screens */}
                        <div className="relative hidden lg:block">
                          {/* 3D shadow layer - subtle dark shadow */}
                          <pre 
                            className="absolute top-0 left-0 text-[12px] leading-[1.1] font-mono select-none whitespace-pre"
                            style={{ 
                              color: '#000000',
                              opacity: 0.15,
                              transform: 'translate(2px, 2px)'
                            }}
                            aria-hidden="true"
                          >{`██╗  ██╗ █████╗ ████████╗ ██████╗██╗  ██╗██╗    ██╗ █████╗ ██╗   ██╗
██║  ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║██║    ██║██╔══██╗╚██╗ ██╔╝
███████║███████║   ██║   ██║     ███████║██║ █╗ ██║███████║ ╚████╔╝ 
██╔══██║██╔══██║   ██║   ██║     ██╔══██║██║███╗██║██╔══██║  ╚██╔╝  
██║  ██║██║  ██║   ██║   ╚██████╗██║  ██║╚███╔███╔╝██║  ██║   ██║   
╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝`}</pre>
                          {/* Front layer - muted theme color */}
                          <pre 
                            className="relative text-[12px] leading-[1.1] font-mono select-none whitespace-pre"
                            style={{ 
                              color: 'var(--theme-primary)',
                              opacity: 0.7
                            }}
                            aria-label="Hatchway"
                          >{`██╗  ██╗ █████╗ ████████╗ ██████╗██╗  ██╗██╗    ██╗ █████╗ ██╗   ██╗
██║  ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║██║    ██║██╔══██╗╚██╗ ██╔╝
███████║███████║   ██║   ██║     ███████║██║ █╗ ██║███████║ ╚████╔╝ 
██╔══██║██╔══██║   ██║   ██║     ██╔══██║██║███╗██║██╔══██║  ╚██╔╝  
██║  ██║██║  ██║   ██║   ╚██████╗██║  ██║╚███╔███╔╝██║  ██║   ██║   
╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝`}</pre>
                        </div>
                      </div>
                      <form
                        onSubmit={handleSubmit}
                        className="relative w-full"
                      >
                      {/* Image attachments preview */}
                      {imageAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {imageAttachments.map((attachment, idx) => (
                            <ImageAttachment
                              key={idx}
                              fileName={attachment.fileName || 'image.png'}
                              imageSrc={attachment.image || ''}
                              showRemove
                              onRemove={() => {
                                setImageAttachments(prev => prev.filter((_, i) => i !== idx));
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <div className="relative input-theme border rounded-lg shadow-2xl overflow-hidden hover:border-[var(--theme-input-border-focus)] transition-all duration-300">
                        <textarea
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onPaste={handlePaste}
                          placeholder="Lets ship something cool...where should we start?"
                          rows={3}
                          className="w-full px-8 py-[calc(1.5rem+3px)] pr-20 bg-transparent text-white placeholder-gray-500 focus:outline-none text-2xl font-light resize-none max-h-[300px] overflow-y-auto"
                          style={{ minHeight: "150px" }}
                          disabled={isLoading}
                        />
                        <button
                          type="submit"
                          disabled={isLoading || (!input.trim() && imageAttachments.length === 0)}
                          className="absolute right-4 bottom-4 p-3 text-white hover:text-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          <svg
                            className="w-8 h-8"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            strokeWidth="2"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                            />
                          </svg>
                        </button>
                      </div>

                      {/* Tag Input - Only show when authenticated */}
                      {isAuthenticated && (
                        <div className="mt-4 px-2">
                          <TagInput
                            tags={appliedTags}
                            onTagsChange={setAppliedTags}
                            runnerOptions={availableRunners.filter(r => r != null).map(r => ({
                              value: r.runnerId,
                              label: r.runnerId,
                              description: `Runner: ${r.runnerId}`
                            }))}
                            hasConnectedRunners={availableRunners.length > 0}
                          />
                        </div>
                      )}
                      </form>
                    </div>
                  </div>
                </motion.div>
              )}

            {/* Three-Panel Layout - Show immediately when mounted */}
            {(conversationMessages.length > 0 ||
              selectedProjectSlug ||
              isCreatingProject) &&
              isMounted && (
                <motion.div
                  key="chat-layout"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="flex-1 flex flex-col lg:flex-row gap-4 p-2 min-h-0 overflow-hidden"
                >
                  {/* Left Panel - Chat (resizable on desktop, full width on mobile) */}
                  <ResizablePanel
                    defaultWidth={chatPanelWidth}
                    minWidth={280}
                    maxWidth={600}
                    onResize={setChatPanelWidth}
                    className="flex flex-col min-h-0 h-[50vh] lg:h-full max-h-full w-full lg:w-auto"
                  >
                    <motion.div
                      initial={{ opacity: 0, x: -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5 }}
                      className="flex-1 flex flex-col min-h-0 max-h-full bg-black/20 backdrop-blur-md border border-white/10 rounded-xl shadow-xl overflow-hidden"
                    >
                      {/* Project Info Header with Tags */}
                      {currentProject && (
                        <div className="border-b border-white/10 px-4 py-3">
                          {/* Framework/Model tags - larger style with labels */}
                          {(generationState?.agentId || latestCompletedBuild?.agentId || currentProject.detectedFramework) && (
                            <div className="flex flex-wrap items-center gap-2">
                              {(generationState?.agentId || latestCompletedBuild?.agentId) && (() => {
                                const activeAgent = generationState?.agentId || latestCompletedBuild?.agentId;
                                const activeClaudeModel = generationState?.claudeModelId || latestCompletedBuild?.claudeModelId;
                                const activeDroidModel = (generationState as { droidModelId?: string })?.droidModelId || (latestCompletedBuild as { droidModelId?: string })?.droidModelId;
                                
                                // Determine model value and display name based on agent
                                let modelValue: string | undefined;
                                let displayName: string | undefined;
                                
                                if (activeAgent === 'openai-codex') {
                                  modelValue = 'gpt-5-codex';
                                  displayName = 'codex';
                                } else if (activeAgent === 'factory-droid') {
                                  modelValue = activeDroidModel;
                                  displayName = activeDroidModel?.replace('claude-', '').replace('gpt-', '').replace('glm-', '') || 'droid';
                                } else {
                                  modelValue = activeClaudeModel;
                                  displayName = activeClaudeModel?.replace('claude-', '');
                                }
                                
                                const modelLogo = modelValue ? getModelLogo(modelValue) : (activeAgent === 'factory-droid' ? '/factory.svg' : null);
                                return (
                                  <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted border border-border rounded text-sm font-mono">
                                    {modelLogo && (
                                      <img src={modelLogo} alt="model" className="w-4 h-4 object-contain" />
                                    )}
                                    <span className="text-muted-foreground">model:</span>
                                    <span className="text-foreground">
                                      {displayName || 'unknown'}
                                    </span>
                                  </div>
                                );
                              })()}
                              {currentProject.detectedFramework && (() => {
                                const frameworkLogo = getFrameworkLogo(currentProject.detectedFramework, theme === 'light' ? 'light' : 'dark');
                                return (
                                  <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted border border-border rounded text-sm font-mono">
                                    {frameworkLogo && (
                                      <img src={frameworkLogo} alt="framework" className="w-4 h-4 object-contain" />
                                    )}
                                    <span className="text-muted-foreground">framework:</span>
                                    <span className="text-foreground">{currentProject.detectedFramework}</span>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                          {/* Error message and retry button */}
                          {currentProject.status === "failed" && (
                            <div className="mt-2 p-2 bg-[#FF45A8]/10 border border-[#FF45A8]/30 rounded-lg">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <p className="text-xs font-medium text-[#FF45A8]">Generation Failed</p>
                                  {currentProject.errorMessage && (
                                    <p className="text-xs text-[#FF70BC]/80 mt-0.5">{currentProject.errorMessage}</p>
                                  )}
                                </div>
                                <button
                                  onClick={async () => {
                                    const promptToRetry = currentProject.originalPrompt || currentProject.description;
                                    if (promptToRetry) {
                                      await fetch(`/api/projects/${currentProject.id}`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ status: "pending", errorMessage: null }),
                                      });
                                      refetch();
                                      await startGeneration(currentProject.id, promptToRetry, { isRetry: true });
                                    }
                                  }}
                                  className="px-2 py-1 text-xs bg-[#FF45A8]/20 hover:bg-[#FF45A8]/30 text-[#FF45A8] border border-[#FF45A8]/30 rounded transition-colors"
                                >
                                  Retry
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Unified View Header - Simple status bar */}
                      <div
                        ref={scrollContainerRef}
                        className="flex-1 overflow-y-auto p-6 min-h-0"
                      >
                        <div className="space-y-4 p-4">
                            {(() => {
                              const userMessages = conversationMessages.filter(
                                (msg) => classifyMessage(msg) === 'user'
                              );
                              const allUserMessages = userMessages.length > 0 
                                ? userMessages 
                                : (displayedInitialMessage ? [displayedInitialMessage] : []);
                              
                              if (allUserMessages.length === 0) return null;

                              // Get the sorted build history (oldest first for display)
                              const sortedBuildHistory = [...buildHistory].reverse();
                              
                              return (
                                <div className="space-y-6 px-1">
                                  {allUserMessages.map((msg, idx) => {
                                    const correspondingBuild = sortedBuildHistory[idx];
                                    const isLastMessage = idx === allUserMessages.length - 1;
                                    const hasActiveBuild = isLastMessage && generationState?.isActive;

                                    return (
                                      <div key={msg.id || idx} className="space-y-3">
                                        {idx > 0 && <div className="border-t border-white/10 my-6" />}

                                        {/* User Request Section */}
                                        <div className="space-y-1">
                                          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                                            {idx === 0 ? 'Initial request' : `Follow-up ${idx}`}
                                          </p>
                                          <div className="text-sm text-gray-300 leading-relaxed prose prose-invert max-w-none [&_p]:my-0 [&_code]:text-xs [&_code]:text-theme-accent [&_code]:bg-theme-primary-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                              {getMessageContent(msg)}
                                            </ReactMarkdown>
                                          </div>
                                        </div>

                                        {/* Planning Phase - only show for current active build */}
                                        {isLastMessage && isThinking && currentProject && !generationState?.buildPlan && (
                                          <div className="space-y-3">
                                            <PlanningPhase
                                              activePlanningTool={generationState?.activePlanningTool}
                                              projectName={currentProject.name}
                                            />
                                            {/* Stop Build button - below the planning phase */}
                                            <button
                                              onClick={cancelBuild}
                                              disabled={isCancelling}
                                              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-red-400 transition-colors rounded-lg border border-white/10 hover:border-red-500/30 hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                              {isCancelling ? (
                                                <>
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                  <span>Cancelling...</span>
                                                </>
                                              ) : (
                                                <>
                                                  <Square className="w-4 h-4" />
                                                  <span>Stop Build</span>
                                                </>
                                              )}
                                            </button>
                                          </div>
                                        )}

                                        {/* Build Plan from active generation - Show after planning completes */}
                                        {isLastMessage && generationState?.buildPlan && (
                                          <div className="space-y-2">
                                            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                                              Build plan
                                            </p>
                                            <div className="prose prose-invert max-w-none text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-white [&_h1]:mb-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-gray-200 [&_h3]:mb-2 [&_p]:text-sm [&_p]:text-gray-300 [&_p]:my-2 [&_ul]:my-3 [&_ul]:space-y-1.5 [&_ol]:my-3 [&_ol]:space-y-1.5 [&_li]:text-sm [&_li]:text-gray-300 [&_li]:leading-relaxed [&_code]:text-xs [&_code]:text-theme-accent [&_code]:bg-theme-primary-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded">
                                              <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                rehypePlugins={[rehypeHighlight]}
                                              >
                                                {generationState.buildPlan}
                                              </ReactMarkdown>
                                            </div>
                                          </div>
                                        )}

                                        {/* Active Build Progress - Skip for auto-fix sessions which are rendered separately */}
                                        {hasActiveBuild && generationState.todos && generationState.todos.length > 0 && !generationState.isAutoFix && (
                                          <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                              <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                                                Build in progress
                                              </p>
                                              <div className="flex items-center gap-2">
                                                <div className="text-xs text-gray-400">
                                                  {generationState.todos.filter(t => t.status === 'completed').length} / {generationState.todos.length}
                                                </div>
                                                <div className="text-sm font-semibold text-theme-primary">
                                                  {Math.round((generationState.todos.filter(t => t.status === 'completed').length / generationState.todos.length) * 100)}%
                                                </div>
                                              </div>
                                            </div>
                                            <div className="h-1 overflow-hidden rounded-full bg-white/10">
                                              <motion.div
                                                initial={{ width: 0 }}
                                                animate={{
                                                  width: `${(generationState.todos.filter(t => t.status === 'completed').length / generationState.todos.length) * 100}%`,
                                                }}
                                                transition={{ duration: 0.5, ease: 'easeOut' }}
                                                className="h-full bg-gradient-to-r from-emerald-400 to-sky-400"
                                              />
                                            </div>
                                            <TodoList
                                              todos={generationState.todos}
                                              toolsByTodo={generationState.toolsByTodo}
                                              activeTodoIndex={generationState.activeTodoIndex}
                                              allTodosCompleted={generationState.todos.every(t => t.status === 'completed')}
                                              onViewFiles={() => {
                                                window.dispatchEvent(new CustomEvent("switch-to-editor"));
                                              }}
                                              onStartServer={startDevServer}
                                            />
                                            
                                            {/* Active agent note - shows most recent reasoning */}
                                            {generationState.textByTodo && Object.keys(generationState.textByTodo).length > 0 && (
                                              <ActiveAgentNote
                                                textByTodo={generationState.textByTodo}
                                                activeTodoIndex={generationState.activeTodoIndex}
                                              />
                                            )}

                                            {/* Stop Build button - below the task list */}
                                            <button
                                              onClick={cancelBuild}
                                              disabled={isCancelling}
                                              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-red-400 transition-colors rounded-lg border border-white/10 hover:border-red-500/30 hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                              {isCancelling ? (
                                                <>
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                  <span>Cancelling...</span>
                                                </>
                                              ) : (
                                                <>
                                                  <Square className="w-4 h-4" />
                                                  <span>Stop Build</span>
                                                </>
                                              )}
                                            </button>
                                          </div>
                                        )}

                                        {/* Completed Build - Show build plan, agent notes, todos, and summary */}
                                        {correspondingBuild && !correspondingBuild.isActive && !correspondingBuild.isAutoFix && (
                                          <>
                                            {/* Build Plan - from persisted generation state */}
                                            {correspondingBuild.buildPlan && (
                                              <div className="space-y-2">
                                                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                                                  Build plan
                                                </p>
                                                <div className="prose prose-invert max-w-none text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-white [&_h1]:mb-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-gray-200 [&_h3]:mb-2 [&_p]:text-sm [&_p]:text-gray-300 [&_p]:my-2 [&_ul]:my-3 [&_ul]:space-y-1.5 [&_ol]:my-3 [&_ol]:space-y-1.5 [&_li]:text-sm [&_li]:text-gray-300 [&_li]:leading-relaxed [&_code]:text-xs [&_code]:text-theme-accent [&_code]:bg-theme-primary-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded">
                                                  <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    rehypePlugins={[rehypeHighlight]}
                                                  >
                                                    {correspondingBuild.buildPlan}
                                                  </ReactMarkdown>
                                                </div>
                                              </div>
                                            )}

                                            {/* Agent notes - collapsed by default */}
                                            {correspondingBuild.textByTodo && Object.keys(correspondingBuild.textByTodo).length > 0 && (
                                              <AgentNotesSection textByTodo={correspondingBuild.textByTodo} />
                                            )}

                                            {/* Completed todos section - only show if there are todos */}
                                            {correspondingBuild.todos && correspondingBuild.todos.length > 0 && (
                                              <div className="space-y-2">
                                                <CompletedTodosSummary todos={correspondingBuild.todos} />
                                              </div>
                                            )}
                                            
                                            {/* Build summary section - show even without todos */}
                                            {correspondingBuild.buildSummary && (
                                              <div className="space-y-2">
                                                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                                                  Build summary
                                                </p>
                                                <div className="prose prose-invert max-w-none text-sm leading-relaxed [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mb-3 [&_h3]:mt-4 [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:uppercase [&_h4]:tracking-[0.2em] [&_h4]:text-gray-400 [&_h4]:mb-2 [&_h4]:mt-3 [&_p]:text-sm [&_p]:text-gray-300 [&_p]:my-1.5 [&_ul]:my-2 [&_ul]:space-y-1 [&_li]:text-sm [&_li]:text-gray-300 [&_li]:leading-relaxed [&_li]:pl-1 [&_strong]:text-white [&_strong]:font-medium [&_em]:text-gray-400 [&_em]:not-italic [&_em]:text-xs">
                                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {correspondingBuild.buildSummary}
                                                  </ReactMarkdown>
                                                </div>
                                              </div>
                                            )}
                                          </>
                                        )}

                                        {/* Auto-Fix Section - Show when corresponding build is an auto-fix */}
                                        {correspondingBuild && correspondingBuild.isAutoFix && (
                                          <ErrorDetectedSection
                                            errorMessage={correspondingBuild.autoFixError}
                                            todos={correspondingBuild.todos || []}
                                            buildSummary={correspondingBuild.buildSummary}
                                            isActive={correspondingBuild.isActive}
                                          />
                                        )}

                                        {/* Active Auto-Fix - Show when current generation state is an auto-fix */}
                                        {hasActiveBuild && generationState?.isAutoFix && (
                                          <ErrorDetectedSection
                                            errorMessage={generationState.autoFixError}
                                            todos={generationState.todos || []}
                                            buildSummary={generationState.buildSummary}
                                            isActive={true}
                                          />
                                        )}

                                        {/* Auto-Fix Starting - Show when autofix-started event received but session not yet created */}
                                        {autoFixState && !generationState?.isAutoFix && (
                                          <ErrorDetectedSection
                                            errorMessage={autoFixState.errorMessage}
                                            todos={[]}
                                            buildSummary={undefined}
                                            isActive={true}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}

                            {conversationMessages.length === 0 && !generationState && (
                              <div className="flex items-center justify-center min-h-[400px]">
                                <div className="text-center space-y-3 text-gray-400">
                                  <Sparkles className="w-12 h-12 mx-auto opacity-50" />
                                  <p className="text-lg">Start a conversation</p>
                                  <p className="text-sm">
                                    Enter a prompt below to begin building
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>

                        <div ref={messagesEndRef} />
                      </div>

                      {/* Fixed Bottom Input */}
                      <div className="border-t border-white/10 bg-background/50 backdrop-blur-sm p-4 flex-shrink-0">
                        <form onSubmit={handleSubmit}>
                          {/* Image attachments preview */}
                          {imageAttachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                              {imageAttachments.map((attachment, idx) => (
                                <ImageAttachment
                                  key={idx}
                                  fileName={attachment.fileName || 'image.png'}
                                  imageSrc={attachment.image || ''}
                                  showRemove
                                  onRemove={() => {
                                    setImageAttachments(prev => prev.filter((_, i) => i !== idx));
                                  }}
                                />
                              ))}
                            </div>
                          )}
                          <div className="relative input-theme border rounded-lg overflow-hidden hover:border-[var(--theme-input-border-focus)] transition-all duration-300">
                            <textarea
                              value={input}
                              onChange={(e) => setInput(e.target.value)}
                              onKeyDown={handleKeyDown}
                              onPaste={handlePaste}
                              placeholder="Continue the conversation..."
                              rows={2}
                              className="w-full px-6 py-4 pr-16 bg-transparent text-white placeholder-gray-500 focus:outline-none font-light resize-none"
                              disabled={isLoading}
                            />
                            <button
                              type="submit"
                              disabled={isLoading || (!input.trim() && imageAttachments.length === 0)}
                              className="absolute right-3 bottom-3 p-2 text-white hover:text-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-all duration-200"
                            >
                              <svg
                                className="w-6 h-6"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                strokeWidth="2"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                                />
                              </svg>
                            </button>
                          </div>
                        </form>
                      </div>
                    </motion.div>
                  </ResizablePanel>

                  {/* Right Panel - Tabbed Preview (fills remaining space) */}
                  <div className="flex-1 flex flex-col min-w-0 h-auto lg:h-full">
                    {/* Tabbed Preview Panel - Full height */}
                    <div className="flex-1 min-h-0 h-[70vh] lg:h-full">
                      <TabbedPreview
                        selectedProject={selectedProjectSlug}
                        projectId={currentProject?.id}
                        onStartServer={startDevServer}
                        onStopServer={stopDevServer}
                        onStartTunnel={startTunnel}
                        onStopTunnel={stopTunnel}
                        isStartingServer={isStartingServer}
                        isStoppingServer={isStoppingServer}
                        isStartingTunnel={isStartingTunnel}
                        isStoppingTunnel={isStoppingTunnel}
                        isBuildActive={isCreatingProject || generationState?.isActive || false}
                        devicePreset={devicePreset}
                        onDevicePresetChange={setDevicePreset}
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        isSelectionModeEnabled={isSelectionMode}
                        onSelectionModeChange={setIsSelectionMode}
                        onPortDetected={(port) => {
                          if (DEBUG_PAGE) console.log(
                            "Terminal detected port update:",
                            port
                          );
                        }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
          </AnimatePresence>
        </div>
      </SidebarInset>
    </SidebarProvider>
    </CommandPaletteProvider>
    </SDKModeProvider>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-muted-foreground">
          Loading workspace…
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
