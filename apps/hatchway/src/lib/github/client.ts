/**
 * GitHub API Client
 * 
 * Wrapper around the GitHub REST API for repository operations.
 */

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  html_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string; // owner/repo
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
  };
}

export interface CreateRepoOptions {
  name: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
}

export class GitHubAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

export class GitHubClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      
      const message = typeof errorBody === 'object' && errorBody !== null && 'message' in errorBody
        ? (errorBody as { message: string }).message
        : `GitHub API error: ${response.status}`;
      
      throw new GitHubAPIError(message, response.status, errorBody);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get the authenticated user's profile
   */
  async getUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>('/user');
  }

  /**
   * Check if the token has the required scopes
   * GitHub returns scopes in the X-OAuth-Scopes header
   */
  async checkScopes(): Promise<string[]> {
    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const scopes = response.headers.get('X-OAuth-Scopes') || '';
    return scopes.split(',').map(s => s.trim()).filter(Boolean);
  }

  /**
   * Check if the token has repo scope (required for creating repos)
   */
  async hasRepoScope(): Promise<boolean> {
    const scopes = await this.checkScopes();
    return scopes.includes('repo') || scopes.includes('public_repo');
  }

  /**
   * Create a new repository for the authenticated user
   */
  async createRepo(options: CreateRepoOptions): Promise<GitHubRepo> {
    return this.request<GitHubRepo>('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: options.name,
        description: options.description || `Created with Hatchway`,
        private: options.private ?? false,
        auto_init: options.autoInit ?? false, // Don't auto-init, we'll push existing code
      }),
    });
  }

  /**
   * Get a repository by owner and name
   */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${owner}/${repo}`);
  }

  /**
   * Check if a repository exists
   */
  async repoExists(owner: string, repo: string): Promise<boolean> {
    try {
      await this.getRepo(owner, repo);
      return true;
    } catch (error) {
      if (error instanceof GitHubAPIError && error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete a repository (use with caution!)
   */
  async deleteRepo(owner: string, repo: string): Promise<void> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok && response.status !== 204) {
      throw new GitHubAPIError(
        `Failed to delete repository: ${response.status}`,
        response.status
      );
    }
  }
}
