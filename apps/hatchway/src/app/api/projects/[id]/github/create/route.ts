import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectOwnership, requireAuth, handleAuthError } from '@/lib/auth-helpers';
import { 
  getGitHubClient, 
  getGitHubConnectionStatus,
  generateUniqueRepoName,
  GitHubAPIError 
} from '@/lib/github';

export interface CreateGitHubRepoRequest {
  visibility: 'public' | 'private';
  name?: string; // Optional custom name, defaults to project slug
  description?: string;
}

export interface CreateGitHubRepoResponse {
  success: boolean;
  repo?: string;      // "owner/repo"
  url?: string;       // "https://github.com/owner/repo"
  cloneUrl?: string;  // "https://github.com/owner/repo.git"
  branch?: string;    // "main"
  error?: string;
  needsReauth?: boolean;
}

/**
 * POST /api/projects/:id/github/create
 * Create a new GitHub repository for a project using the user's GitHub OAuth token
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<CreateGitHubRepoResponse>> {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    const { project, session } = await requireProjectOwnership(id);
    
    // Check if project already has a GitHub repo
    if (project.githubRepo) {
      return NextResponse.json({
        success: false,
        error: 'Project already has a GitHub repository connected',
        repo: project.githubRepo ?? undefined,
        url: project.githubUrl ?? undefined,
      }, { status: 400 });
    }

    // Parse request body
    const body: CreateGitHubRepoRequest = await req.json();
    
    if (!body.visibility || !['public', 'private'].includes(body.visibility)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid visibility. Must be "public" or "private"',
      }, { status: 400 });
    }

    // Check GitHub connection status
    const connectionStatus = await getGitHubConnectionStatus(session.user.id);
    
    if (!connectionStatus.connected) {
      return NextResponse.json({
        success: false,
        error: 'GitHub account not connected. Please log in with GitHub.',
        needsReauth: true,
      }, { status: 401 });
    }

    if (connectionStatus.needsReauth || !connectionStatus.hasRepoScope) {
      return NextResponse.json({
        success: false,
        error: 'Additional GitHub permissions required. Please re-authenticate with GitHub to grant repository access.',
        needsReauth: true,
      }, { status: 403 });
    }

    // Get GitHub client
    const client = await getGitHubClient(session.user.id);
    if (!client) {
      return NextResponse.json({
        success: false,
        error: 'Failed to initialize GitHub client',
      }, { status: 500 });
    }

    // Determine repo name (use project slug or custom name)
    const baseRepoName = body.name || project.slug;
    
    // Get the GitHub username
    const user = await client.getUser();
    
    // Generate a unique repo name if needed
    const repoName = await generateUniqueRepoName(client, user.login, baseRepoName);

    // Create the repository
    const repo = await client.createRepo({
      name: repoName,
      description: body.description || `${project.name} - Created with Hatchway`,
      private: body.visibility === 'private',
      autoInit: false, // We'll push existing code
    });

    // Update project with GitHub info
    const [updated] = await db.update(projects)
      .set({
        githubRepo: repo.full_name,
        githubUrl: repo.html_url,
        githubBranch: repo.default_branch || 'main',
        githubMeta: {
          visibility: body.visibility,
          createdAt: new Date().toISOString(),
          description: repo.description,
        },
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      // Repo was created but DB update failed - this is bad
      // We should probably delete the repo, but for now just log it
      console.error('Created GitHub repo but failed to update project:', repo.full_name);
      return NextResponse.json({
        success: true,
        repo: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        branch: repo.default_branch || 'main',
        error: 'Repository created but failed to update project record',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      repo: repo.full_name,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      branch: repo.default_branch || 'main',
    });

  } catch (error) {
    // Handle auth errors
    const authResponse = handleAuthError(error);
    if (authResponse) {
      return authResponse as NextResponse<CreateGitHubRepoResponse>;
    }

    // Handle GitHub API errors
    if (error instanceof GitHubAPIError) {
      console.error('GitHub API error:', error.message, error.status, error.response);
      
      if (error.status === 401) {
        return NextResponse.json({
          success: false,
          error: 'GitHub authentication failed. Please re-authenticate with GitHub.',
          needsReauth: true,
        }, { status: 401 });
      }
      
      if (error.status === 422) {
        // Validation failed - likely repo name already exists or invalid
        return NextResponse.json({
          success: false,
          error: `GitHub repository creation failed: ${error.message}`,
        }, { status: 400 });
      }

      return NextResponse.json({
        success: false,
        error: `GitHub API error: ${error.message}`,
      }, { status: error.status >= 500 ? 502 : error.status });
    }

    console.error('Error creating GitHub repository:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to create GitHub repository',
    }, { status: 500 });
  }
}
