import { pgTable, text, integer, timestamp, uuid, jsonb, index, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================================
// Better-Auth Tables
// ============================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  hasCompletedOnboarding: boolean('has_completed_onboarding').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('sessions_user_id_idx').on(table.userId),
  tokenIdx: index('sessions_token_idx').on(table.token),
}));

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(), // 'credential', 'google', etc.
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  idToken: text('id_token'), // ID token from OAuth providers
  password: text('password'), // Hashed password for credential provider
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('accounts_user_id_idx').on(table.userId),
  providerAccountIdx: uniqueIndex('accounts_provider_account_idx').on(table.providerId, table.accountId),
}));

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(), // email or other identifier
  value: text('value').notNull(), // verification token
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  identifierIdx: index('verifications_identifier_idx').on(table.identifier),
}));

// ============================================================================
// Runner Keys - User-scoped runner authentication
// ============================================================================

export const runnerKeys = pgTable('runner_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // User-friendly name like "My MacBook"
  keyHash: text('key_hash').notNull(), // SHA-256 hash of the full key
  keyPrefix: text('key_prefix').notNull(), // First 8 chars for display: "sv_abc123..."
  source: text('source').default('web'), // 'web' | 'cli' - how the key was created
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'), // Soft delete - null means active
}, (table) => ({
  userIdIdx: index('runner_keys_user_id_idx').on(table.userId),
  keyHashIdx: uniqueIndex('runner_keys_key_hash_idx').on(table.keyHash),
}));

// CLI authentication sessions - temporary tokens for OAuth flow
export const cliAuthSessions = pgTable('cli_auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(), // Random token for session identification
  callbackPort: integer('callback_port').notNull(), // Port the CLI is listening on
  callbackHost: text('callback_host').default('localhost'), // Host for callback
  state: text('state').notNull().default('pending'), // 'pending' | 'authenticated' | 'completed' | 'expired'
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // Set after auth
  runnerKeyId: uuid('runner_key_id').references(() => runnerKeys.id, { onDelete: 'cascade' }), // Created key
  deviceName: text('device_name'), // Auto-detected device name
  expiresAt: timestamp('expires_at').notNull(), // Session expiration (short-lived)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  authenticatedAt: timestamp('authenticated_at'), // When user completed OAuth
}, (table) => ({
  tokenIdx: uniqueIndex('cli_auth_sessions_token_idx').on(table.token),
  expiresAtIdx: index('cli_auth_sessions_expires_at_idx').on(table.expiresAt),
}));

export type CliAuthSession = typeof cliAuthSessions.$inferSelect;
export type NewCliAuthSession = typeof cliAuthSessions.$inferInsert;

// ============================================================================
// Application Tables
// ============================================================================

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // Owner of the project (nullable for migration/local mode)
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  originalPrompt: text('original_prompt'),
  icon: text('icon').default('Folder'),
  status: text('status').notNull().default('pending'),
  projectType: text('project_type'),
  detectedFramework: text('detected_framework'), // Auto-detected framework (astro, next, vite, etc.)
  path: text('path'), // Nullable - deprecated, path should be calculated from slug
  runCommand: text('run_command'),
  port: integer('port'),
  devServerPid: integer('dev_server_pid'),
  devServerPort: integer('dev_server_port'),
  devServerStatus: text('dev_server_status').default('stopped'),
  devServerStatusUpdatedAt: timestamp('dev_server_status_updated_at').defaultNow(),
  tunnelUrl: text('tunnel_url'),
  runnerId: text('runner_id'), // Runner that created/manages this project
  generationState: text('generation_state'),
  designPreferences: jsonb('design_preferences'), // User-specified design constraints (deprecated - use tags)
  tags: jsonb('tags'), // Tag-based configuration system
  lastActivityAt: timestamp('last_activity_at').defaultNow(),
  errorMessage: text('error_message'),
  // GitHub integration fields
  githubRepo: text('github_repo'), // e.g., "owner/repo-name"
  githubUrl: text('github_url'), // Full repository URL
  githubBranch: text('github_branch'), // Default branch (e.g., "main")
  githubLastPushedAt: timestamp('github_last_pushed_at'), // Last push timestamp
  githubAutoPush: boolean('github_auto_push').default(false), // Auto-push after builds
  githubLastSyncAt: timestamp('github_last_sync_at'), // Last time we synced repo info
  githubMeta: jsonb('github_meta'), // Additional metadata (issues count, recent commits, etc.)
  // NeonDB integration fields
  neondbConnectionString: text('neondb_connection_string'), // DATABASE_URL (encrypted/partial)
  neondbClaimUrl: text('neondb_claim_url'), // URL to claim the database
  neondbHost: text('neondb_host'), // Database host endpoint
  neondbDatabase: text('neondb_database'), // Database name
  neondbCreatedAt: timestamp('neondb_created_at'), // When database was provisioned
  neondbExpiresAt: timestamp('neondb_expires_at'), // When unclaimed DB expires (72 hours)
  // Railway integration fields
  railwayProjectId: text('railway_project_id'), // Railway project ID
  railwayServiceId: text('railway_service_id'), // Railway service ID
  railwayEnvironmentId: text('railway_environment_id'), // Railway environment ID (production)
  railwayDomain: text('railway_domain'), // e.g., "myapp-production.up.railway.app"
  railwayDeploymentStatus: text('railway_deployment_status'), // 'deploying' | 'success' | 'failed' | 'crashed'
  railwayLastDeployedAt: timestamp('railway_last_deployed_at'), // Last successful deployment
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  // Indexes for performance
  userIdIdx: index('projects_user_id_idx').on(table.userId),
  runnerIdIdx: index('projects_runner_id_idx').on(table.runnerId),
  statusIdx: index('projects_status_idx').on(table.status),
  lastActivityIdx: index('projects_last_activity_idx').on(table.lastActivityAt),
}));

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const portAllocations = pgTable('port_allocations', {
  port: integer('port').primaryKey(),
  framework: text('framework').notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  reservedAt: timestamp('reserved_at').defaultNow(),
});

export const runningProcesses = pgTable('running_processes', {
  projectId: uuid('project_id').primaryKey().notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pid: integer('pid').notNull(),
  port: integer('port'),
  command: text('command'),
  runnerId: text('runner_id'), // Runner that manages this process
  startedAt: timestamp('started_at').notNull().defaultNow(),
  lastHealthCheck: timestamp('last_health_check'),
  healthCheckFailCount: integer('health_check_fail_count').notNull().default(0),
}, (table) => ({
  // Index for filtering by runner
  runnerIdIdx: index('running_processes_runner_id_idx').on(table.runnerId),
}));

export const generationSessions = pgTable('generation_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  buildId: text('build_id').notNull(),
  operationType: text('operation_type'),
  status: text('status').notNull().default('active'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  summary: text('summary'),
  rawState: jsonb('raw_state'),
  isAutoFix: boolean('is_auto_fix').default(false), // Flag for auto-fix sessions triggered by startup errors
  autoFixError: text('auto_fix_error'), // The error message that triggered the auto-fix
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index('generation_sessions_project_id_idx').on(table.projectId),
  buildIdUnique: uniqueIndex('generation_sessions_build_id_unique').on(table.buildId),
}));

export const generationTodos = pgTable('generation_todos', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => generationSessions.id, { onDelete: 'cascade' }),
  todoIndex: integer('todo_index').notNull(),
  content: text('content').notNull(),
  activeForm: text('active_form'),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index('generation_todos_session_id_idx').on(table.sessionId),
  sessionIndexUnique: uniqueIndex('generation_todos_session_index_unique').on(table.sessionId, table.todoIndex),
}));

export const generationToolCalls = pgTable('generation_tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => generationSessions.id, { onDelete: 'cascade' }),
  todoIndex: integer('todo_index').notNull(),
  toolCallId: text('tool_call_id').notNull(),
  name: text('name').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  state: text('state').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index('generation_tool_calls_session_id_idx').on(table.sessionId),
  toolCallUnique: uniqueIndex('generation_tool_calls_call_id_unique')
    .on(table.sessionId, table.toolCallId),
}));

export const generationNotes = pgTable('generation_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => generationSessions.id, { onDelete: 'cascade' }),
  todoIndex: integer('todo_index').notNull(),
  textId: text('text_id'),
  kind: text('kind').notNull().default('text'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index('generation_notes_session_id_idx').on(table.sessionId),
  textIdUnique: uniqueIndex('generation_notes_text_id_unique')
    .on(table.sessionId, table.textId)
    .where(sql`${table.textId} is not null`),
}));

// ============================================================================
// Railway Integration Tables
// ============================================================================

// Railway OAuth connections - stores user's Railway OAuth tokens
export const railwayConnections = pgTable('railway_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Encrypted OAuth tokens
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  
  // Railway user info (from OAuth)
  railwayUserId: text('railway_user_id').notNull(), // "sub" claim from OIDC
  railwayEmail: text('railway_email'),
  railwayName: text('railway_name'),
  
  // Selected workspaces from OAuth consent
  defaultWorkspaceId: text('default_workspace_id'),
  defaultWorkspaceName: text('default_workspace_name'),
  grantedWorkspaces: jsonb('granted_workspaces').$type<Array<{ id: string; name: string }>>(),
  
  // Connection status
  status: text('status').notNull().default('active'), // 'active' | 'disconnected' | 'expired'
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdUnique: uniqueIndex('railway_connections_user_id_unique').on(table.userId),
  railwayUserIdIdx: index('railway_connections_railway_user_id_idx').on(table.railwayUserId),
}));

// Railway deployments history - tracks deployments to Railway
export const railwayDeployments = pgTable('railway_deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  
  // Railway resource IDs
  railwayProjectId: text('railway_project_id').notNull(),
  railwayServiceId: text('railway_service_id').notNull(),
  railwayDeploymentId: text('railway_deployment_id').notNull(),
  railwayEnvironmentId: text('railway_environment_id'),
  
  // Deployment info
  status: text('status').notNull(), // Railway deployment status
  url: text('url'), // Deployment URL
  commitSha: text('commit_sha'), // Git commit deployed
  
  // Timestamps
  deployedAt: timestamp('deployed_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index('railway_deployments_project_id_idx').on(table.projectId),
  railwayDeploymentIdIdx: index('railway_deployments_railway_deployment_id_idx').on(table.railwayDeploymentId),
}));

// ============================================================================
// GitHub Integration Tables
// ============================================================================

// GitHub OAuth connections - stores user's GitHub OAuth tokens for repo operations
export const githubConnections = pgTable('github_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Encrypted OAuth tokens
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  
  // GitHub user info (from OAuth)
  githubUserId: text('github_user_id').notNull(), // GitHub user ID
  githubUsername: text('github_username').notNull(), // GitHub username/login
  githubEmail: text('github_email'),
  githubAvatarUrl: text('github_avatar_url'),
  
  // OAuth scopes granted
  scopes: text('scopes'), // Comma-separated list of scopes
  
  // Connection status
  status: text('status').notNull().default('active'), // 'active' | 'disconnected' | 'expired'
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  userIdUnique: uniqueIndex('github_connections_user_id_unique').on(table.userId),
  githubUserIdIdx: index('github_connections_github_user_id_idx').on(table.githubUserId),
}));

// ============================================================================
// Server Operations
// ============================================================================

// Server operations tracking table for reliable status management
export const serverOperations = pgTable('server_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  operation: text('operation').notNull(), // 'start', 'stop', 'restart'
  status: text('status').notNull().default('pending'), // 'pending', 'sent', 'ack', 'completed', 'failed', 'timeout'
  runnerId: text('runner_id'),
  port: integer('port'),
  pid: integer('pid'),
  error: text('error'),
  failureReason: text('failure_reason'), // 'port_in_use', 'health_check_timeout', 'immediate_crash', etc.
  retryCount: integer('retry_count').notNull().default(0),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  sentAt: timestamp('sent_at'),
  ackAt: timestamp('ack_at'),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  projectIdIdx: index('server_operations_project_id_idx').on(table.projectId),
  statusIdx: index('server_operations_status_idx').on(table.status),
  createdAtIdx: index('server_operations_created_at_idx').on(table.createdAt),
}));

// Auth types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type RunnerKey = typeof runnerKeys.$inferSelect;
export type NewRunnerKey = typeof runnerKeys.$inferInsert;

// Application types
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type PortAllocation = typeof portAllocations.$inferSelect;
export type ServerOperation = typeof serverOperations.$inferSelect;
export type NewServerOperation = typeof serverOperations.$inferInsert;
export type GenerationSession = typeof generationSessions.$inferSelect;
export type GenerationTodo = typeof generationTodos.$inferSelect;
export type GenerationToolCall = typeof generationToolCalls.$inferSelect;
export type GenerationNote = typeof generationNotes.$inferSelect;

// Railway integration types
export type RailwayConnection = typeof railwayConnections.$inferSelect;
export type NewRailwayConnection = typeof railwayConnections.$inferInsert;
export type RailwayDeployment = typeof railwayDeployments.$inferSelect;
export type NewRailwayDeployment = typeof railwayDeployments.$inferInsert;

// GitHub integration types
export type GitHubConnection = typeof githubConnections.$inferSelect;
export type NewGitHubConnection = typeof githubConnections.$inferInsert;
