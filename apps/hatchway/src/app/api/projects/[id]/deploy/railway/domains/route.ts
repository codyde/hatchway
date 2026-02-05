import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectOwnership, handleAuthError } from '@/lib/auth-helpers';
import { createRailwayClient } from '@/lib/railway';

/**
 * GET /api/projects/:id/deploy/railway/domains
 * Get all domains for the Railway service
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    const domains = await railway.getDomains(
      project.railwayProjectId,
      project.railwayEnvironmentId,
      project.railwayServiceId
    );

    return NextResponse.json({ domains });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Domains] Error fetching domains:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch domains' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/:id/deploy/railway/domains
 * Regenerate the Railway-provided domain (delete old, create new)
 * This generates a new random subdomain
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    
    // First get current domains to find the service domain ID
    const currentDomains = await railway.getDomains(
      project.railwayProjectId,
      project.railwayEnvironmentId,
      project.railwayServiceId
    );

    const serviceDomain = currentDomains.serviceDomains[0];
    if (!serviceDomain) {
      // No existing domain, create a new one
      const newDomain = await railway.createDomain(
        project.railwayServiceId,
        project.railwayEnvironmentId
      );

      // Update project with new domain
      await db.update(projects)
        .set({
          railwayDomain: newDomain.domain,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id));

      return NextResponse.json({ 
        domain: newDomain,
        message: 'Domain created successfully'
      });
    }

    // Delete and recreate to get a new random subdomain
    await railway.deleteServiceDomain(serviceDomain.id);
    const newDomain = await railway.createDomain(
      project.railwayServiceId,
      project.railwayEnvironmentId
    );

    // Update project with new domain
    await db.update(projects)
      .set({
        railwayDomain: newDomain.domain,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    return NextResponse.json({ 
      domain: newDomain,
      message: 'Domain regenerated successfully'
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Domains] Error regenerating domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to regenerate domain' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/projects/:id/deploy/railway/domains
 * Update the subdomain of the Railway-provided domain
 * Body: { subdomain: string }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    const body = await req.json() as { subdomain: string };
    
    if (!body.subdomain || typeof body.subdomain !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request body. Expected { subdomain: string }' },
        { status: 400 }
      );
    }

    // Validate subdomain format
    const subdomain = body.subdomain.toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(subdomain)) {
      return NextResponse.json(
        { error: 'Invalid subdomain. Use only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.' },
        { status: 400 }
      );
    }

    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    
    // Get current domain to find its ID
    const currentDomains = await railway.getDomains(
      project.railwayProjectId,
      project.railwayEnvironmentId,
      project.railwayServiceId
    );

    const serviceDomain = currentDomains.serviceDomains[0];
    if (!serviceDomain) {
      return NextResponse.json(
        { error: 'No service domain found to update' },
        { status: 404 }
      );
    }

    // Build the full domain string (subdomain + suffix)
    const domainSuffix = '.up.railway.app';
    const fullDomain = `${subdomain}${domainSuffix}`;

    // Update the domain
    try {
      await railway.updateServiceDomain(
        serviceDomain.id,           // serviceDomainId
        project.railwayServiceId,   // serviceId
        project.railwayEnvironmentId, // environmentId
        fullDomain                  // domain (full domain string)
      );
    } catch (updateError) {
      // Log the specific error from Railway API
      console.error('[Railway Domains] serviceDomainUpdate failed:', updateError);
      
      // Return the error to the client for debugging
      return NextResponse.json(
        { error: updateError instanceof Error ? updateError.message : 'Failed to update domain via Railway API' },
        { status: 500 }
      );
    }

    // Fetch the updated domain info
    const updatedDomains = await railway.getDomains(
      project.railwayProjectId,
      project.railwayEnvironmentId,
      project.railwayServiceId
    );
    const updatedDomain = updatedDomains.serviceDomains[0];

    // Update project with new domain
    if (updatedDomain) {
      await db.update(projects)
        .set({
          railwayDomain: updatedDomain.domain,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id));
    }

    return NextResponse.json({ 
      domain: updatedDomain,
      message: 'Domain updated successfully'
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Domains] Error updating domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update domain' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/:id/deploy/railway/domains
 * Delete a domain
 * Body: { domainId: string, type: 'service' | 'custom' }
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project, session } = await requireProjectOwnership(id);
    const userId = session.user.id;

    const body = await req.json() as { domainId: string; type: 'service' | 'custom' };
    
    if (!body.domainId || !body.type) {
      return NextResponse.json(
        { error: 'Invalid request body. Expected { domainId: string, type: "service" | "custom" }' },
        { status: 400 }
      );
    }

    if (!project.railwayProjectId || !project.railwayServiceId || !project.railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'Project is not deployed to Railway' },
        { status: 400 }
      );
    }

    const railway = createRailwayClient(userId);
    
    if (body.type === 'service') {
      await railway.deleteServiceDomain(body.domainId);
      
      // Clear domain from project
      await db.update(projects)
        .set({
          railwayDomain: null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id));
    } else {
      // For custom domains, we'd need a deleteCustomDomain method
      // Not implementing full custom domain support yet
      return NextResponse.json(
        { error: 'Custom domain deletion not yet supported' },
        { status: 501 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse) return authResponse;

    console.error('[Railway Domains] Error deleting domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete domain' },
      { status: 500 }
    );
  }
}
