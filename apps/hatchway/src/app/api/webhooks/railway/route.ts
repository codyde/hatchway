import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects, railwayDeployments } from '@hatchway/agent-core/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RailwayWebhookPayload, RailwayDeploymentStatus } from '@/lib/railway/types';

/**
 * Verify Railway webhook signature using HMAC-SHA256
 * Railway signs webhooks with the secret configured in the webhook settings
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  try {
    // Compute expected signature
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    // Both signatures need to be the same length for timingSafeEqual
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error('[Railway Webhook] Signature verification error:', error);
    return false;
  }
}

/**
 * POST /api/webhooks/railway
 * Webhook endpoint for Railway deployment status updates
 * 
 * Railway sends webhooks for various events including:
 * - Deployment.started
 * - Deployment.building
 * - Deployment.deploying
 * - Deployment.success
 * - Deployment.failed
 * - Deployment.crashed
 * 
 * Webhook Configuration:
 * Set this URL in your Railway project settings under Webhooks
 */
export async function POST(req: Request) {
  try {
    // Read raw body for signature verification
    const rawBody = await req.text();
    
    // Verify webhook signature if configured
    const webhookSecret = process.env.RAILWAY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = req.headers.get('x-railway-signature');
      
      if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        console.warn('[Railway Webhook] Invalid or missing signature');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      
      console.log('[Railway Webhook] Signature verified successfully');
    } else {
      console.warn('[Railway Webhook] RAILWAY_WEBHOOK_SECRET not configured - skipping signature verification');
    }

    // Parse the payload after signature verification
    const payload: RailwayWebhookPayload = JSON.parse(rawBody);
    
    console.log('[Railway Webhook]', payload.type, {
      projectId: payload.resource.project.id,
      serviceId: payload.resource.service.id,
      deploymentId: payload.resource.deployment.id,
      status: payload.details.status,
    });

    // Extract Railway IDs from the webhook
    const {
      project: railwayProject,
      service: railwayService,
      environment: railwayEnvironment,
      deployment: railwayDeployment,
    } = payload.resource;

    // Map webhook type to our status
    const status = mapWebhookTypeToStatus(payload.type, payload.details.status);
    
    // Find our project by Railway project ID
    const project = await db.query.projects.findFirst({
      where: eq(projects.railwayProjectId, railwayProject.id),
    });

    if (!project) {
      // Not our project - might be a webhook for a manually created Railway project
      console.log('[Railway Webhook] Project not found for Railway project:', railwayProject.id);
      return NextResponse.json({ received: true, matched: false });
    }

    // Update project deployment status
    await db.update(projects)
      .set({
        railwayDeploymentStatus: status,
        railwayLastDeployedAt: status === 'deployed' ? new Date() : project.railwayLastDeployedAt,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    // Find and update the deployment record
    const existingDeployment = await db.query.railwayDeployments.findFirst({
      where: and(
        eq(railwayDeployments.projectId, project.id),
        eq(railwayDeployments.railwayServiceId, railwayService.id),
      ),
      orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
    });

    if (existingDeployment) {
      await db.update(railwayDeployments)
        .set({
          railwayDeploymentId: railwayDeployment.id,
          status,
          commitSha: payload.details.commitHash,
          completedAt: isTerminalStatus(status) ? new Date() : null,
        })
        .where(eq(railwayDeployments.id, existingDeployment.id));
    } else {
      // Create a new deployment record if we don't have one
      // This can happen if deployment was triggered outside our app
      await db.insert(railwayDeployments)
        .values({
          projectId: project.id,
          railwayProjectId: railwayProject.id,
          railwayServiceId: railwayService.id,
          railwayEnvironmentId: railwayEnvironment.id,
          railwayDeploymentId: railwayDeployment.id,
          status,
          commitSha: payload.details.commitHash,
          completedAt: isTerminalStatus(status) ? new Date() : null,
        });
    }

    return NextResponse.json({ 
      received: true, 
      matched: true,
      projectId: project.id,
      status,
    });
  } catch (error) {
    console.error('[Railway Webhook] Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Map Railway webhook type and status to our simplified status
 */
function mapWebhookTypeToStatus(type: string, rawStatus: string): string {
  // Type-based mapping
  if (type.includes('success') || type.includes('Success')) {
    return 'deployed';
  }
  if (type.includes('failed') || type.includes('Failed')) {
    return 'failed';
  }
  if (type.includes('crashed') || type.includes('Crashed')) {
    return 'failed';
  }
  if (type.includes('building') || type.includes('Building')) {
    return 'deploying';
  }
  if (type.includes('deploying') || type.includes('Deploying')) {
    return 'deploying';
  }
  if (type.includes('started') || type.includes('Started')) {
    return 'deploying';
  }

  // Fallback to status-based mapping
  const status = rawStatus.toUpperCase() as RailwayDeploymentStatus;
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

/**
 * Check if status is terminal (deployment is complete)
 */
function isTerminalStatus(status: string): boolean {
  return ['deployed', 'failed', 'cancelled', 'sleeping'].includes(status);
}

/**
 * GET /api/webhooks/railway
 * Health check endpoint - Railway may ping this
 */
export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    service: 'Hatchway Railway Webhook',
    timestamp: new Date().toISOString(),
  });
}
