/**
 * GitHub Integration Types
 * 
 * Types for managing GitHub repository connections for projects.
 * Repository creation is handled via the GitHub API using OAuth tokens.
 * Code pushing is handled via the github-setup skill using git commands.
 */

/**
 * GitHub commit information
 */
export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

/**
 * GitHub repository metadata stored in githubMeta JSONB field
 */
export interface GitHubMeta {
  /** Number of open issues */
  openIssuesCount?: number;
  /** Number of open pull requests */
  openPrsCount?: number;
  /** Recent commits (last 5) */
  recentCommits?: GitHubCommit[];
  /** Repository visibility */
  visibility?: 'public' | 'private';
  /** Repository description */
  description?: string;
  /** Default branch name */
  defaultBranch?: string;
  /** Stars count */
  starsCount?: number;
  /** Forks count */
  forksCount?: number;
  /** Last error message if sync failed */
  lastSyncError?: string;
}

/**
 * GitHub connection status for a project
 */
export interface GitHubStatus {
  /** Whether GitHub is connected */
  isConnected: boolean;
  /** Repository name (owner/repo) */
  repo: string | null;
  /** Full repository URL */
  url: string | null;
  /** Default branch */
  branch: string | null;
  /** Last push timestamp */
  lastPushedAt: Date | null;
  /** Auto-push enabled */
  autoPush: boolean;
  /** Last sync timestamp */
  lastSyncAt: Date | null;
  /** Additional metadata */
  meta: GitHubMeta | null;
}

/**
 * Request to update GitHub settings
 */
export interface UpdateGitHubSettingsRequest {
  /** Enable/disable auto-push */
  autoPush?: boolean;
}

/**
 * Response from GitHub setup via skill
 */
export interface GitHubSetupResult {
  /** Whether setup was successful */
  success: boolean;
  /** Repository name (owner/repo) */
  repo?: string;
  /** Full repository URL */
  url?: string;
  /** Default branch */
  branch?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Response from GitHub push operation
 */
export interface GitHubPushResult {
  /** Whether push was successful */
  success: boolean;
  /** Commit SHA if successful */
  commitSha?: string;
  /** Number of files changed */
  filesChanged?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Response from GitHub sync operation (fetching latest repo info)
 */
export interface GitHubSyncResult {
  /** Whether sync was successful */
  success: boolean;
  /** Updated metadata */
  meta?: GitHubMeta;
  /** Error message if failed */
  error?: string;
}

/**
 * GitHub CLI auth status (legacy - for backwards compatibility)
 */
export interface GitHubAuthStatus {
  /** Whether gh CLI is authenticated */
  isAuthenticated: boolean;
  /** Authenticated username */
  username?: string;
  /** Auth scopes */
  scopes?: string[];
  /** Error message if not authenticated */
  error?: string;
}

/**
 * GitHub OAuth connection status for a user
 * Used to check if a user can create repositories
 */
export interface GitHubConnection {
  /** Whether GitHub OAuth is connected */
  connected: boolean;
  /** GitHub username */
  username?: string;
  /** User's avatar URL */
  avatarUrl?: string;
  /** Whether the token has repo scope */
  hasRepoScope?: boolean;
  /** Whether re-authentication is needed (token expired or missing scopes) */
  needsReauth?: boolean;
}

/**
 * Request to create a GitHub repository via API
 */
export interface CreateGitHubRepoRequest {
  /** Repository visibility */
  visibility: 'public' | 'private';
  /** Custom repository name (defaults to project slug) */
  name?: string;
  /** Repository description */
  description?: string;
}

/**
 * Response from creating a GitHub repository via API
 */
export interface CreateGitHubRepoResponse {
  /** Whether creation was successful */
  success: boolean;
  /** Repository name (owner/repo) */
  repo?: string;
  /** Full repository URL */
  url?: string;
  /** Git clone URL */
  cloneUrl?: string;
  /** Default branch */
  branch?: string;
  /** Error message if failed */
  error?: string;
  /** Whether re-authentication is needed */
  needsReauth?: boolean;
}

/**
 * Chat message types for GitHub operations
 * Note: Repository creation is now handled via API, not chat messages
 */
export const GITHUB_CHAT_MESSAGES = {
  /** Push code to an existing repository (repo URL will be in context) */
  PUSH_CODE: 'Push code to GitHub repository using the github-setup skill.',
  /** Sync changes to existing repository */
  SYNC: 'Stage all current changes, commit, and push to the remote repository.',
  /** Legacy - kept for backwards compatibility */
  SETUP: 'Set up GitHub repository for this project. Create a new public repository and push the code.',
  PUSH: 'Push the latest changes to GitHub.',
  CHECK_AUTH: 'Check if GitHub CLI is authenticated.',
} as const;

export type GitHubChatMessageType = keyof typeof GITHUB_CHAT_MESSAGES;
