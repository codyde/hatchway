import { NextResponse } from 'next/server';
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
    const messageId = body.messageId as string | undefined;
    const messageParts = Array.isArray(body.messageParts) ? body.messageParts : undefined;

    // Validate required fields
    if (!slug || !friendlyName || !originalPrompt) {
      return NextResponse.json(
        { error: 'slug, friendlyName, and prompt are required' },
        { status: 400 }
      );
    }

    if (messageId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
      return NextResponse.json({ error: 'messageId must be a UUID' }, { status: 400 });
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

    // Create the project and its initial request atomically so the build can
    // safely reference the caller-provided message ID immediately.
    const { project, initialMessage } = await db.transaction(async (tx) => {
      const [createdProject] = await tx.insert(projects).values({
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
        executionMode: body.executionMode === 'local' ? 'local' : 'sandbox',
      }).returning();

      const initialContent = messageParts && messageParts.length > 0
        ? JSON.stringify(messageParts)
        : originalPrompt;
      const [createdMessage] = await tx.insert(messages).values({
        ...(messageId ? { id: messageId } : {}),
        projectId: createdProject.id,
        role: 'user',
        content: initialContent,
      }).returning();

      return { project: createdProject, initialMessage: createdMessage };
    });

    console.log(`[create-from-analysis] Project created: ${project.id}`);

    // Extract browser type from User-Agent
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const uaLower = userAgent.toLowerCase();
    const browserType = uaLower.includes('edg/') ? 'edge'
      : uaLower.includes('chrome/') && !uaLower.includes('edg/') ? 'chrome'
      : uaLower.includes('firefox/') ? 'firefox'
      : uaLower.includes('safari/') && !uaLower.includes('chrome/') ? 'safari'
      : 'other';

    // Enrich project with runner connection status before returning
    // This ensures the frontend knows the runner is connected from the start
    const enrichedProject = await enrichProjectWithRunnerStatus(project);

    return NextResponse.json({
      project: enrichedProject,
      requestMessageId: initialMessage.id,
      template,
    });
  } catch (error) {
    console.error('[create-from-analysis] Failed to create project:', error);
    return NextResponse.json(
      {
        error: 'Failed to create project',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
