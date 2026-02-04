import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects, messages } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getSession, isLocalMode } from '@/lib/auth-helpers';
import { enrichProjectWithRunnerStatus } from '@/lib/runner-utils';

/**
 * Create a project from runner analysis results
 * 
 * This endpoint is called after the runner completes project analysis,
 * creating the project in the database with the runner-generated metadata.
 */
export async function POST(request: Request) {
  try {
    // Check authentication
    const session = await getSession();
    const userId = isLocalMode() ? null : (session?.user?.id ?? null);
    
    // In hosted mode, require authentication
    if (!isLocalMode() && !userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Support both direct fields and nested analysis object
    const analysis = body.analysis || body;
    const {
      slug,
      friendlyName,
      description,
      icon,
      template,
    } = analysis;

    // Get additional fields from body (not from analysis)
    const originalPrompt = body.prompt || body.originalPrompt;
    const tags = body.tags;
    const runnerId = body.runnerId;

    // Validate required fields
    if (!slug || !friendlyName || !originalPrompt) {
      return NextResponse.json(
        { error: 'slug, friendlyName, and prompt are required' },
        { status: 400 }
      );
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2 || slug.length > 100) {
      return NextResponse.json(
        { error: 'Invalid slug format' },
        { status: 400 }
      );
    }

    console.log('[create-from-analysis] Creating project with runner analysis results');
    console.log(`[create-from-analysis] Name: ${friendlyName} (${slug})`);
    console.log(`[create-from-analysis] Framework: ${template?.framework || 'unknown'}`);

    // Check for slug collision
    let finalSlug = slug;
    const existing = await db.select().from(projects).where(eq(projects.slug, finalSlug));

    if (existing.length > 0) {
      // Append timestamp to ensure uniqueness
      finalSlug = `${slug}-${Date.now()}`;
      console.log(`[create-from-analysis] Slug collision detected, using: ${finalSlug}`);
    }

    // Create the project
    const [project] = await db.insert(projects).values({
      name: friendlyName,
      slug: finalSlug,
      description: description || originalPrompt.substring(0, 150),
      icon: icon || 'Code',
      status: 'pending',
      originalPrompt,
      detectedFramework: template?.framework || null,
      tags: tags || null,
      userId: userId,
      runnerId: runnerId || null,
    }).returning();

    console.log(`[create-from-analysis] Project created: ${project.id}`);

    // Persist initial user prompt as first chat message
    try {
      await db.insert(messages).values({
        projectId: project.id,
        role: 'user',
        content: originalPrompt,
      });
    } catch (messageError) {
      console.error(`[create-from-analysis] Failed to persist initial prompt for project ${project.id}:`, messageError);
    }

    // Track project creation metric
    Sentry.metrics.count('project.created_from_analysis', 1, {
      attributes: {
        project_id: project.id,
        framework: template?.framework || 'unknown',
        has_template: String(!!template),
      }
    });

    // Enrich project with runner connection status before returning
    // This ensures the frontend knows the runner is connected from the start
    const enrichedProject = await enrichProjectWithRunnerStatus(project);

    return NextResponse.json({
      project: enrichedProject,
      template,
    });
  } catch (error) {
    console.error('[create-from-analysis] Failed to create project:', error);
    Sentry.captureException(error);
    return NextResponse.json(
      {
        error: 'Failed to create project',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
