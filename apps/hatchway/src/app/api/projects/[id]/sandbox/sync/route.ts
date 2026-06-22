/**
 * Sandbox sync endpoint (Sandbox execution mode).
 *
 * Called by the connected local runner after it builds a project locally: it
 * ships the built workspace (gzipped tarball, base64) here, and the backend —
 * which holds the Railway platform token — provisions/reuses the project's
 * sandbox, installs deps, (re)starts the dev server + railgate tunnel, and
 * returns the public preview URL. The Railway token never leaves the server.
 */
import { NextResponse } from 'next/server';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { authenticateRunnerRequest, isLocalMode } from '@/lib/auth-helpers';
import { syncAndRun, checkpointProject } from '@/lib/sandbox/manager';

// Installing deps inside the box can take a while.
export const maxDuration = 300;

interface SyncBody {
  tarballBase64: string;
  port: number;
  installCommand?: string;
  runCommand?: string;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isLocalMode() && !(await authenticateRunnerRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  let body: SyncBody;
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.tarballBase64 || !body.port) {
    return NextResponse.json({ error: 'Missing required fields: tarballBase64, port' }, { status: 400 });
  }

  try {
    const result = await syncAndRun(
      {
        id: project.id,
        sandboxId: project.sandboxId,
        sandboxCheckpoint: project.sandboxCheckpoint,
        sandboxSubdomain: project.sandboxSubdomain,
      },
      {
        tarballBase64: body.tarballBase64,
        port: body.port,
        installCommand: body.installCommand,
        runCommand: body.runCommand,
      },
    );

    // Surface the preview through the same fields the UI already reads.
    await db
      .update(projects)
      .set({
        tunnelUrl: result.previewUrl,
        devServerPort: body.port,
        devServerStatus: 'running',
        devServerStatusUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    console.log(`[sandbox/sync] project ${id} live at ${result.previewUrl} (sandbox ${result.sandboxId})`);

    // Checkpoint after each build so the workspace + node_modules survive and a
    // future cold start restores fast. Fire-and-forget — the snapshot can take a
    // while and the preview is already live; the long-lived server finishes it.
    checkpointProject({
      id: project.id,
      sandboxId: result.sandboxId,
      sandboxCheckpoint: project.sandboxCheckpoint,
      sandboxSubdomain: project.sandboxSubdomain,
    }).catch((err) => console.error('[sandbox/sync] checkpoint failed (non-fatal):', err));

    return NextResponse.json({ previewUrl: result.previewUrl, sandboxId: result.sandboxId });
  } catch (err) {
    console.error('[sandbox/sync] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sandbox sync failed' },
      { status: 502 },
    );
  }
}
