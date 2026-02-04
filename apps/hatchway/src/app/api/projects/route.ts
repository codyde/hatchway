import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects, messages } from '@hatchway/agent-core/lib/db/schema';
import { eq, or, isNull } from 'drizzle-orm';
import type { AgentId } from '@hatchway/agent-core/types/agent';
import { getSession, isLocalMode, getUserId } from '@/lib/auth-helpers';
import { enrichProjectsWithRunnerStatus } from '@/lib/runner-utils';

/**
 * NOTE: This endpoint now uses FALLBACK naming only (no AI calls).
 * 
 * The primary project creation path is:
 * 1. Frontend sends analyze-project to runner
 * 2. Runner does AI analysis and returns metadata
 * 3. Frontend calls POST /api/projects/create-from-analysis
 * 
 * This legacy POST endpoint is kept for:
 * - Backwards compatibility
 * - Fallback when runner analysis fails
 * - Direct API usage without runner
 */

export async function GET() {
  try {
    // In local mode, return all projects (no user filtering)
    if (isLocalMode()) {
      const allProjects = await db.select().from(projects).orderBy(projects.createdAt);
      // Enrich projects with runner connection status
      const enrichedProjects = await enrichProjectsWithRunnerStatus(allProjects);
      return NextResponse.json({ projects: enrichedProjects });
    }

    // In hosted mode, filter by user
    const userId = await getUserId();
    
    if (!userId) {
      // Not authenticated - return empty list
      return NextResponse.json({ projects: [] });
    }

    // Return projects owned by user OR projects with no owner (legacy)
    const userProjects = await db
      .select()
      .from(projects)
      .where(
        or(
          eq(projects.userId, userId),
          isNull(projects.userId)
        )
      )
      .orderBy(projects.createdAt);
    
    // Enrich projects with runner connection status
    const enrichedProjects = await enrichProjectsWithRunnerStatus(userProjects);
    return NextResponse.json({ projects: enrichedProjects });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

/**
 * Generate fallback metadata from prompt without AI
 * Extracts meaningful words and generates slug/name
 */
function generateFallbackMetadata(prompt: string): {
  slug: string;
  friendlyName: string;
  description: string;
  icon: string;
} {
  // Extract key words, filtering out common filler words
  const fillerWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'is', 'it', 'that', 'this', 'i', 'want', 'would', 'like',
    'please', 'can', 'you', 'me', 'my', 'make', 'create', 'build', 'need',
    'help', 'using', 'should', 'could', 'give', 'some', 'new'
  ]);
  
  const words = prompt
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !fillerWords.has(w))
    .slice(0, 4); // Take first 4 meaningful words
  
  // Generate short slug (max 30 chars)
  const slug = words
    .join('-')
    .replace(/[^a-z0-9-]+/g, '')
    .substring(0, 30) || `project-${Date.now()}`;

  // Generate friendly name (max 4 words, title case)
  const friendlyName = words.length > 0
    ? words.slice(0, 4).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : 'New Project';

  return {
    slug,
    friendlyName,
    description: prompt.substring(0, 150) || 'A new project',
    icon: 'Code',
  };
}

export async function POST(request: Request) {
  try {
    // Check authentication (required for creating projects in hosted mode)
    // In local mode, we don't associate projects with users (userId = null)
    // This avoids foreign key violations since LOCAL_USER doesn't exist in the DB
    const session = await getSession();
    const userId = isLocalMode() ? null : (session?.user?.id ?? null);
    
    // In hosted mode, require authentication
    if (!isLocalMode() && !userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Extract User-Agent for browser tracking
    const userAgent = request.headers.get('user-agent') || 'unknown';
    
    // Simple browser detection from User-Agent
    const getBrowserType = (ua: string): string => {
      const uaLower = ua.toLowerCase();
      if (uaLower.includes('edg/')) return 'edge';
      if (uaLower.includes('chrome/') && !uaLower.includes('edg/')) return 'chrome';
      if (uaLower.includes('firefox/')) return 'firefox';
      if (uaLower.includes('safari/') && !uaLower.includes('chrome/')) return 'safari';
      if (uaLower.includes('opera/') || uaLower.includes('opr/')) return 'opera';
      return 'other';
    };
    
    const browserType = getBrowserType(userAgent);

    const { prompt, agent = 'claude-code', tags } = (await request.json()) as { prompt: string; agent?: AgentId; tags?: { key: string; value: string }[] };

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    console.log('Selected tags:', tags);

    Sentry.logger.info(
      Sentry.logger.fmt`Creating project from prompt (fallback path) ${{
        prompt,
        promptPreview: prompt.substring(0, 100),
        agent,
        operation: 'project_creation_fallback',
      }}`
    );

    // NOTE: This endpoint now uses FALLBACK naming only (no AI calls).
    // The primary path uses runner analysis + create-from-analysis endpoint.
    console.log('📝 Using fallback metadata generation (no AI)');
    const metadata = generateFallbackMetadata(prompt);
    console.log('📝 Fallback metadata generated:', { slug: metadata.slug, friendlyName: metadata.friendlyName });

    // Check for slug collision
    let finalSlug = metadata.slug;
    const existing = await db.select().from(projects).where(eq(projects.slug, finalSlug));

    if (existing.length > 0) {
      // Append timestamp to ensure uniqueness
      finalSlug = `${metadata.slug}-${Date.now()}`;
      console.log(`⚠️  Slug collision detected, using: ${finalSlug}`);
    }

    // Create the project
    const [project] = await db.insert(projects).values({
      name: metadata.friendlyName,
      slug: finalSlug,
      description: metadata.description,
      icon: metadata.icon,
      status: 'pending',
      originalPrompt: prompt,
      tags: tags || null, // Store tags if provided
      userId: userId, // Associate with authenticated user (null in local mode)
    }).returning();

    console.log(`✅ Project created: ${project.id}`);

    // Persist initial user prompt as first chat message
    try {
      await db.insert(messages).values({
        projectId: project.id,
        role: 'user',
        content: prompt,
      });
    } catch (messageError) {
      console.error(`[projects POST] Failed to persist initial prompt for project ${project.id}:`, messageError);
    }

    // Track project submission with key tags
    const submissionAttributes: Record<string, string> = {
      project_id: project.id,
      browser: browserType,
    };
    
    // Extract the 4 key tags we care about
    if (tags && Array.isArray(tags)) {
      tags.forEach((tag: { key: string; value: string }) => {
        if (tag.key === 'model' || tag.key === 'framework' || tag.key === 'runner' || tag.key === 'brand') {
          submissionAttributes[tag.key] = tag.value;
        }
      });
    }
    
    // Track project submission
    console.log('[DEBUG] About to send project.submitted metric with attributes:', submissionAttributes);
    Sentry.metrics.count('project.submitted', 1, {
      attributes: submissionAttributes
      // e.g., { project_id: '123', browser: 'chrome', model: 'claude-sonnet-4-5', framework: 'next', brand: 'sentry', runner: 'abc-123' }
    });
    console.log('[DEBUG] Metric call completed');

    return NextResponse.json({
      project,
    });
  } catch (error) {
    console.error('Failed to create project:', error);
    return NextResponse.json(
      {
        error: 'Failed to create project',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
