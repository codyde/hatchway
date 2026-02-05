import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects, railwayConnections, railwayDeployments } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import { createRailwayClient } from '@/lib/railway';
import type { RailwayDeploymentStatus, RailwayDeploymentInfo } from '@/lib/railway/types';

/**
 * POST /api/projects/:id/deploy/railway
 * Deploy a project to Railway
 * 
 * Requirements:
 * - User must have Railway connected
 * - Project must have GitHub repo connected
 * 
 * Flow:
 * 1. Create Railway project (or use existing)
 * 2. Create service from GitHub repo
 * 3. Create domain
 * 4. Store Railway info on project
 * 5. Deployment triggers automatically when service is created from repo
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Parse request body for optional GitHub override
    const body = await req.json().catch(() => ({}));
    const { githubRepo: overrideGithubRepo, githubBranch: overrideGithubBranch } = body;
    
    // Verify user owns this project
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    // Check if user has Railway connected
    const connection = await db.query.railwayConnections.findFirst({
      where: eq(railwayConnections.userId, userId),
    });

    if (!connection || connection.status !== 'active') {
      return NextResponse.json(
        { error: 'Railway not connected. Please connect your Railway account first.' },
        { status: 400 }
      );
    }

    // Use override GitHub repo/branch or fall back to project's connected repo
    const githubRepo = overrideGithubRepo || project.githubRepo;
    const githubBranch = overrideGithubBranch || project.githubBranch || 'main';

    // Check if project has GitHub connected (either via integration or override)
    // Railway deployment requires a GitHub repo to create a service
    if (!githubRepo) {
      return NextResponse.json(
        { error: 'GitHub repository required. Please push your project to GitHub first, then deploy to Railway.' },
        { status: 400 }
      );
    }

    // Get workspace to use
    const workspaceId = connection.defaultWorkspaceId || connection.grantedWorkspaces?.[0]?.id;
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'No Railway workspace available. Please reconnect your Railway account.' },
        { status: 400 }
      );
    }

    // Create Railway client
    const railway = createRailwayClient(userId);

    let railwayProjectId = project.railwayProjectId;
    let railwayServiceId = project.railwayServiceId;
    let railwayEnvironmentId = project.railwayEnvironmentId;
    let railwayDomain = project.railwayDomain;

    // Step 1: Create Railway project if needed
    if (!railwayProjectId) {
      const railwayProject = await railway.createProject(
        project.name || project.slug || 'Hatchway App',
        workspaceId
      );
      railwayProjectId = railwayProject.id;

      // Get the production environment
      const projectDetails = await railway.getProject(railwayProjectId);
      const prodEnv = projectDetails.environments.find(e => e.name === 'production');
      railwayEnvironmentId = prodEnv?.id || projectDetails.environments[0]?.id;
    }

    if (!railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Failed to get Railway environment.' },
        { status: 500 }
      );
    }

    // Step 2: Create service from GitHub repo if needed
    if (!railwayServiceId) {
      const service = await railway.createServiceFromGitHub(
        railwayProjectId,
        project.name || project.slug || 'app',
        githubRepo,
        githubBranch,
        railwayEnvironmentId // Pass environmentId to trigger deployment
      );
      railwayServiceId = service.id;
    }

    // Step 3: Create domain if needed
    if (!railwayDomain) {
      const domain = await railway.createDomain(railwayServiceId, railwayEnvironmentId);
      railwayDomain = domain.domain;
    }

    // Step 4: Update project with Railway info
    const [updatedProject] = await db.update(projects)
      .set({
        railwayProjectId,
        railwayServiceId,
        railwayEnvironmentId,
        railwayDomain,
        railwayDeploymentStatus: 'deploying',
        railwayLastDeployedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    // Step 5: Record deployment
    // Note: Railway deployment ID is not available until the deployment starts
    // We'll use a placeholder and update it via webhook when available
    const [deployment] = await db.insert(railwayDeployments)
      .values({
        projectId: id,
        railwayProjectId: railwayProjectId!,
        railwayServiceId: railwayServiceId!,
        railwayEnvironmentId,
        railwayDeploymentId: `pending-${Date.now()}`, // Temporary ID until webhook updates it
        status: 'deploying',
      })
      .returning();

    // Service creation from GitHub triggers automatic deployment
    // We'll poll for status or use webhooks to track progress

    return NextResponse.json({
      success: true,
      deployment: {
        id: deployment.id,
        status: deployment.status,
        domain: railwayDomain,
        url: `https://${railwayDomain}`,
      },
      project: {
        railwayProjectId,
        railwayServiceId,
        railwayEnvironmentId,
        railwayDomain,
      },
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error deploying to Railway:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to deploy to Railway' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects/:id/deploy/railway
 * Get Railway deployment status for a project
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this project
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    // Check if project has Railway deployment
    if (!project.railwayProjectId) {
      return NextResponse.json({
        isDeployed: false,
        status: null,
      });
    }

    // Get latest deployment info from Railway
    let latestDeployment: RailwayDeploymentInfo | null = null;
    if (project.railwayServiceId && project.railwayEnvironmentId) {
      try {
        const railway = createRailwayClient(userId);
        const deployments = await railway.getDeployments(
          project.railwayProjectId,
          project.railwayServiceId,
          project.railwayEnvironmentId,
          1
        );
        
        if (deployments.length > 0) {
          latestDeployment = deployments[0];
          
          // Update project status if changed
          const newStatus = mapRailwayStatus(latestDeployment.status);
          if (newStatus !== project.railwayDeploymentStatus) {
            await db.update(projects)
              .set({
                railwayDeploymentStatus: newStatus,
                updatedAt: new Date(),
              })
              .where(eq(projects.id, id));
          }
        }
      } catch (error) {
        console.warn('Failed to fetch Railway deployment status:', error);
      }
    }

    return NextResponse.json({
      isDeployed: true,
      railwayProjectId: project.railwayProjectId,
      railwayServiceId: project.railwayServiceId,
      railwayEnvironmentId: project.railwayEnvironmentId,
      domain: project.railwayDomain,
      url: project.railwayDomain ? `https://${project.railwayDomain}` : null,
      status: project.railwayDeploymentStatus,
      lastDeployedAt: project.railwayLastDeployedAt,
      latestDeployment,
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error fetching Railway status:', error);
    return NextResponse.json({ error: 'Failed to fetch Railway status' }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/:id/deploy/railway
 * Disconnect Railway deployment (optionally delete Railway project)
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { deleteRailwayProject = false } = await req.json().catch(() => ({}));
    
    // Verify user owns this project
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    // Optionally delete the Railway project
    if (deleteRailwayProject && project.railwayProjectId) {
      try {
        const railway = createRailwayClient(userId);
        await railway.deleteProject(project.railwayProjectId);
      } catch (error) {
        console.warn('Failed to delete Railway project:', error);
        // Continue anyway - we still want to clear the local reference
      }
    }

    // Clear Railway info from project
    await db.update(projects)
      .set({
        railwayProjectId: null,
        railwayServiceId: null,
        railwayEnvironmentId: null,
        railwayDomain: null,
        railwayDeploymentStatus: null,
        railwayLastDeployedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    return NextResponse.json({
      success: true,
      message: deleteRailwayProject 
        ? 'Railway project deleted and disconnected'
        : 'Railway deployment disconnected',
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;
    
    console.error('Error disconnecting Railway:', error);
    return NextResponse.json({ error: 'Failed to disconnect Railway' }, { status: 500 });
  }
}

/**
 * Map Railway deployment status to our simplified status
 */
function mapRailwayStatus(status: RailwayDeploymentStatus): string {
  switch (status) {
    case 'BUILDING':
    case 'DEPLOYING':
    case 'WAITING':
    case 'QUEUED':
      return 'deploying';
    case 'SUCCESS':
      return 'deployed';
    case 'FAILED':
    case 'CRASHED':
      return 'failed';
    case 'REMOVED':
    case 'SKIPPED':
      return 'cancelled';
    case 'SLEEPING':
      return 'sleeping';
    default:
      return 'unknown';
  }
}
