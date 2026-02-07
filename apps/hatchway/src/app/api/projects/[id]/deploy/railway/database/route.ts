import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import { createRailwayClient } from '@/lib/railway';

/**
 * POST /api/projects/:id/deploy/railway/database
 * Provision a PostgreSQL database for a Railway-deployed project
 * 
 * Uses Railway's official Postgres template via templateDeployV2 to create:
 * - SSL-enabled Postgres service (ghcr.io/railwayapp-templates/postgres-ssl)
 * - Persistent volume at /var/lib/postgresql/data
 * - TCP proxy for external connections
 * - Environment variables: DATABASE_URL, PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 * 
 * After provisioning, wires DATABASE_URL into the app service using
 * Railway's variable reference syntax: ${{Postgres.DATABASE_URL}}
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify user owns this project
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    // Ensure project is deployed to Railway
    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project must be deployed to Railway first.' },
        { status: 400 }
      );
    }

    // Check if database is already provisioned
    if (project.railwayDatabaseServiceId) {
      return NextResponse.json(
        { error: 'A database has already been provisioned for this project.' },
        { status: 409 }
      );
    }

    const railway = createRailwayClient(userId);

    console.log('[Railway Database] Provisioning PostgreSQL database...');

    // Step 1: Deploy the Postgres template into the same Railway project
    await railway.deployPostgresDatabase(
      project.railwayProjectId,
      project.railwayEnvironmentId,
    );

    // Step 2: Wait briefly for Railway to create the service
    // The template deploy is async — Railway creates the service quickly
    // even though the full deployment takes longer
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 3: Discover the newly-created Postgres service
    const postgresService = await railway.findPostgresService(
      project.railwayProjectId,
      project.railwayServiceId,
    );

    if (!postgresService) {
      return NextResponse.json(
        { error: 'Database template deployed but service could not be found. It may still be initializing — try checking Railway Settings in a moment.' },
        { status: 202 }
      );
    }

    console.log('[Railway Database] Postgres service created:', postgresService.id, 'name:', postgresService.name);

    // Step 4: Wire DATABASE_URL from Postgres service into the app service
    // Uses environmentStageChanges (the same mutation the Railway dashboard uses)
    // to create a proper reference variable that shows as connected on the canvas.
    // The service name comes from the template (typically "Postgres").
    const serviceName = postgresService.name;
    const databaseUrlRef = '$' + `{{${serviceName}.DATABASE_URL}}`;
    await railway.stageVariableReferences(
      project.railwayEnvironmentId,
      project.railwayServiceId,
      {
        DATABASE_URL: databaseUrlRef,
      },
    );
    console.log(`[Railway Database] Staged DATABASE_URL reference to ${serviceName}`);

    // Commit the staged changes to trigger a redeployment
    await railway.commitStagedChanges(project.railwayEnvironmentId);
    console.log('[Railway Database] Committed staged changes, redeployment triggered');

    // Step 5: Store the database service ID on the project
    await db.update(projects)
      .set({
        railwayDatabaseServiceId: postgresService.id,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    return NextResponse.json({
      success: true,
      database: {
        serviceId: postgresService.id,
        serviceName: postgresService.name,
        status: 'provisioning',
      },
      message: 'PostgreSQL database provisioned and DATABASE_URL wired to your app service. The database will be ready in a few moments.',
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('Error provisioning Railway database:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to provision database' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects/:id/deploy/railway/database
 * Get the database status for a Railway-deployed project
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    if (!project.railwayDatabaseServiceId) {
      return NextResponse.json({
        hasDatabase: false,
        database: null,
      });
    }

    // Fetch database service variables to check status and get public connection URL
    let status = 'unknown';
    let publicUrl: string | null = null;

    if (project.railwayProjectId && project.railwayEnvironmentId) {
      try {
        const railway = createRailwayClient(userId);
        const dbVars = await railway.getVariables(
          project.railwayProjectId,
          project.railwayEnvironmentId,
          project.railwayDatabaseServiceId,
        );

        if (dbVars.PGHOST) {
          status = 'ready';
          publicUrl = dbVars.DATABASE_PUBLIC_URL || null;
        } else {
          status = 'provisioning';
        }
      } catch {
        status = 'unknown';
      }
    }

    return NextResponse.json({
      hasDatabase: true,
      database: {
        serviceId: project.railwayDatabaseServiceId,
        status,
        publicUrl,
      },
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('Error fetching Railway database status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch database status' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/:id/deploy/railway/database
 * Remove the database service from a Railway-deployed project
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    if (!project.railwayDatabaseServiceId) {
      return NextResponse.json(
        { error: 'No database to remove.' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);

    // Delete the database service from Railway
    try {
      await railway.deleteService(project.railwayDatabaseServiceId);
    } catch (error) {
      console.warn('Failed to delete Railway database service:', error);
    }

    // Remove DATABASE_URL from the app service
    if (project.railwayProjectId && project.railwayEnvironmentId && project.railwayServiceId) {
      try {
        await railway.deleteVariable(
          project.railwayProjectId,
          project.railwayEnvironmentId,
          project.railwayServiceId,
          'DATABASE_URL',
        );
      } catch (error) {
        console.warn('Failed to remove DATABASE_URL from app service:', error);
      }
    }

    // Clear the database service ID
    await db.update(projects)
      .set({
        railwayDatabaseServiceId: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    return NextResponse.json({
      success: true,
      message: 'Database service removed.',
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('Error removing Railway database:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove database' },
      { status: 500 }
    );
  }
}
