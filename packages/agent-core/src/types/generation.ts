import type { AgentId } from './agent';
import type { ClaudeModelId } from '../shared/runner/messages';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export type BuildPhase = 'template' | 'build';

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'error';
  startTime?: Date;
  endTime?: Date;
}

export interface TextMessage {
  id: string;
  text: string;
  timestamp: Date;
}

export type BuildOperationType =
  | 'initial-build'
  | 'enhancement'
  | 'focused-edit'
  | 'continuation'
  | 'autofix';

export type CodexPhaseId =
  | 'prompt-analysis'
  | 'template-selection'
  | 'template-clone'
  | 'workspace-verification'
  | 'task-synthesis'
  | 'execution';

export type CodexPhaseStatus = 'pending' | 'active' | 'completed' | 'blocked';

export interface CodexPhase {
  id: CodexPhaseId;
  title: string;
  description: string;
  status: CodexPhaseStatus;
  startedAt?: Date;
  completedAt?: Date;
  spotlight?: string;
}

export interface CodexTemplateDecision {
  templateId: string;
  templateName: string;
  repository?: string;
  branch?: string;
  confidence?: number;
  rationale?: string;
  decidedAt?: Date;
}

export interface CodexWorkspaceVerification {
  directory: string;
  exists: boolean;
  discoveredEntries?: string[];
  verifiedAt?: Date;
  notes?: string;
}

export interface CodexTaskSummary {
  headline: string;
  bullets: string[];
  capturedAt: Date;
}

export interface CodexExecutionInsight {
  id: string;
  text: string;
  timestamp: Date;
  tone?: 'info' | 'success' | 'warning' | 'error';
}

export interface CodexSessionState {
  threadId?: string; // Codex thread ID for resumption
  phases: CodexPhase[];
  templateDecision?: CodexTemplateDecision;
  workspaceVerification?: CodexWorkspaceVerification;
  taskSummary?: CodexTaskSummary;
  executionInsights?: CodexExecutionInsight[];
  lastUpdatedAt?: Date;
}

export interface GenerationState {
  id: string; // Unique ID for this generation session
  projectId: string;
  projectName: string;
  operationType?: BuildOperationType; // Type of build operation
  agentId?: AgentId;
  claudeModelId?: ClaudeModelId;
  droidModelId?: string; // Model ID for factory-droid agent
  todos: TodoItem[];
  toolsByTodo: Record<number, ToolCall[]>; // Tools nested under each todo index
  textByTodo: Record<number, TextMessage[]>; // Text messages nested under each todo
  activeTodoIndex: number; // Which todo is currently in progress
  isActive: boolean;
  startTime: Date;
  endTime?: Date;
  codex?: CodexSessionState;
  stateVersion?: number; // Monotonic version counter for reconnect reconciliation
  buildSummary?: string; // Final build summary text
  source?: 'local' | 'database'; // Track where this state came from to prevent duplicates
  // Planning phase tracking - tool calls before first TodoWrite
  planningTools?: ToolCall[];
  activePlanningTool?: ToolCall; // Currently executing planning tool (for shimmer display)
  buildPlan?: string; // The implementation plan from ExitPlanMode
  // Auto-fix tracking - for sessions triggered by startup/runtime errors
  isAutoFix?: boolean; // Flag indicating this is an auto-fix session
  autoFixError?: string; // The error message that triggered the auto-fix
  // Two-phase task tracking - separates template setup from build tasks
  currentPhase?: BuildPhase; // Current active phase
  templateTodos?: TodoItem[]; // Phase 1: Template configuration tasks
  activeTemplateTodoIndex?: number; // Active todo index for template phase
}

export type GenerationEvent =
  | { type: 'todo-update'; todos: TodoItem[] }
  | { type: 'tool-start'; todoIndex: number; tool: ToolCall }
  | { type: 'tool-update'; todoIndex: number; toolId: string; output: unknown; state: ToolCall['state'] }
  | { type: 'complete' };
