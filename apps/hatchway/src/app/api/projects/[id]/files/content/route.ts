import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { addRunnerEventSubscriber } from '@hatchway/agent-core/lib/runner/event-stream';
import { getProjectRunnerId } from '@/lib/runner-utils';
import type { ReadFileCommand, WriteFileCommand, RunnerEvent } from '@/shared/runner/messages';
import { randomUUID } from 'crypto';

const MAX_FILE_SIZE = 500 * 1024; // 500KB limit
const TIMEOUT_MS = 10000; // 10 seconds timeout

// GET /api/projects/:id/files/content?path=src/App.tsx
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const filePath = url.searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
    }

    // Get project from database
    const projectRows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!projectRows.length) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectRows[0];
    if (!project.slug) {
      return NextResponse.json({ error: 'Project slug not found' }, { status: 400 });
    }

    const commandId = randomUUID();

    // Try to use project's saved runner, fallback to any available runner
    const runnerId = await getProjectRunnerId(project.runnerId);

    if (!runnerId) {
      return NextResponse.json(
        { error: 'No runners connected' },
        { status: 503 }
      );
    }

    // Create a promise that will resolve when we get the file content
    const fileContentPromise = new Promise<{ content: string; size: number }>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('File read timeout'));
      }, TIMEOUT_MS);

      const unsubscribe = addRunnerEventSubscriber(commandId, (event: RunnerEvent) => {
        clearTimeout(timeoutId);

        if (event.type === 'file-content') {
          unsubscribe();
          resolve({ content: event.content, size: event.size });
        } else if (event.type === 'error') {
          unsubscribe();
          reject(new Error(event.error || 'Failed to read file'));
        }
      });
    });

    // Send read-file command to runner
    const command: ReadFileCommand = {
      id: commandId,
      type: 'read-file',
      projectId: id,
      timestamp: new Date().toISOString(),
      payload: {
        slug: project.slug,
        filePath,
      },
    };

    await sendCommandToRunner(runnerId, command);

    // Wait for the file content
    const result = await fileContentPromise;

    return NextResponse.json({
      content: result.content,
      size: result.size,
    });
  } catch (error) {
    console.error('Failed to read file:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to read file',
    }, { status: 500 });
  }
}

// PUT /api/projects/:id/files/content - Save file content
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { path: filePath, content } = body;

    if (!filePath) {
      return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
    }

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
    }

    if (content.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large' }, { status: 413 });
    }

    // Get project from database
    const projectRows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!projectRows.length) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectRows[0];
    if (!project.slug) {
      return NextResponse.json({ error: 'Project slug not found' }, { status: 400 });
    }

    const commandId = randomUUID();

    // Try to use project's saved runner, fallback to any available runner
    const runnerId = await getProjectRunnerId(project.runnerId);

    if (!runnerId) {
      return NextResponse.json(
        { error: 'No runners connected' },
        { status: 503 }
      );
    }

    // Create a promise that will resolve when the file is written
    const fileWrittenPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('File write timeout'));
      }, TIMEOUT_MS);

      const unsubscribe = addRunnerEventSubscriber(commandId, (event: RunnerEvent) => {
        clearTimeout(timeoutId);

        if (event.type === 'file-written') {
          unsubscribe();
          resolve();
        } else if (event.type === 'error') {
          unsubscribe();
          reject(new Error(event.error || 'Failed to write file'));
        }
      });
    });

    // Send write-file command to runner
    const command: WriteFileCommand = {
      id: commandId,
      type: 'write-file',
      projectId: id,
      timestamp: new Date().toISOString(),
      payload: {
        slug: project.slug,
        filePath,
        content,
      },
    };

    await sendCommandToRunner(runnerId, command);

    // Wait for confirmation
    await fileWrittenPromise;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to write file:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to write file',
    }, { status: 500 });
  }
}
