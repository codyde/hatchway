/**
 * Railway sandbox lifecycle for "Sandbox" execution mode (checkpoint-backed).
 *
 * Model (ported from ~/projects/railbot src/sandbox/runTask.ts):
 *  - Boot from a baked BASE checkpoint (Node + @hatchway/cli + railgate) — or,
 *    once a project has been built, from that project's saved workspace
 *    checkpoint, so the generated app + node_modules are restored instantly.
 *  - The runner (`hatchway runner`, baked into the checkpoint) starts as a
 *    detached process and dials back to /ws/runner; it also opens a railgate
 *    tunnel to the dev server so the preview is reachable at
 *    https://<subdomain>.<RAILGATE_BASE_DOMAIN>.
 *  - Warm-reuse a still-RUNNING sandbox; otherwise create from checkpoint.
 *  - Checkpoint after each build (durable restore point) and on teardown;
 *    destroy on stop/idle so we don't leak compute.
 *
 * Server env required (set on the deployed Hatchway):
 *  - RAILWAY_API_TOKEN, RAILWAY_ENVIRONMENT_ID   create/connect/checkpoint/destroy in the Hatchway env
 *  - SANDBOX_BASE_CHECKPOINT                      name of the baked base checkpoint (see scripts/bake-sandbox-checkpoint.ts)
 *  - ANTHROPIC_API_KEY                            injected so Claude Code authenticates in the sandbox
 *  - RUNNER_SHARED_SECRET                         injected so the in-sandbox runner authenticates back
 *  - SANDBOX_RUNNER_WS_URL                        public wss://…/ws/runner (falls back to BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL)
 *  - RAILGATE_RELAY_URL, RAILGATE_TOKEN           railgate relay the in-sandbox client dials out to
 *  - RAILGATE_BASE_DOMAIN                         e.g. portal.hatchway.sh (used to form the public preview URL)
 */
import { Sandbox } from 'railway';
import { randomBytes } from 'node:crypto';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isRunnerConnected } from '@hatchway/agent-core/lib/runner/broker-state';

const RUNNER_WORKSPACE = '/workspace';
const PROVISION_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_500;
const IDLE_TIMEOUT_MINUTES = 15;

export function sandboxRunnerId(projectId: string): string {
  return `sandbox-${projectId}`;
}

function projectCheckpointName(projectId: string): string {
  return `proj-${projectId}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Sandbox execution mode but is not set`);
  }
  return value;
}

function railwayOpts() {
  return { token: requireEnv('RAILWAY_API_TOKEN'), environmentId: requireEnv('RAILWAY_ENVIRONMENT_ID') };
}

/** Public wss URL the in-sandbox runner dials back to. */
function getRunnerWsUrl(): string {
  const explicit = process.env.SANDBOX_RUNNER_WS_URL || process.env.RUNNER_WS_URL;
  if (explicit) return explicit;
  const base = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (base) {
    const url = new URL(base);
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws/runner`;
  }
  throw new Error('No public Hatchway URL for the sandbox runner. Set SANDBOX_RUNNER_WS_URL.');
}

type SandboxProject = {
  id: string;
  sandboxId: string | null;
  sandboxCheckpoint: string | null;
  sandboxSubdomain: string | null;
};

/** Stable per-project railgate subdomain (12 hex), minted + persisted once. */
async function ensureSubdomain(project: SandboxProject): Promise<string> {
  if (project.sandboxSubdomain) return project.sandboxSubdomain;
  const subdomain = randomBytes(6).toString('hex');
  await db.update(projects).set({ sandboxSubdomain: subdomain }).where(eq(projects.id, project.id));
  project.sandboxSubdomain = subdomain;
  return subdomain;
}

/**
 * Ensure a sandbox runner is running and connected for this project, returning
 * the runnerId to dispatch build commands to. Warm-reuses a still-running
 * sandbox; otherwise restores from the project's saved checkpoint (or the base
 * checkpoint for a never-built project) and waits for the runner to connect.
 */
export async function ensureSandboxRunner(project: SandboxProject): Promise<{ runnerId: string }> {
  const runnerId = sandboxRunnerId(project.id);

  // Warm path: reuse a still-running sandbox whose runner is connected.
  if (project.sandboxId && (await isRunnerConnected(runnerId))) {
    return { runnerId };
  }

  const opts = railwayOpts();
  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const runnerSharedSecret = requireEnv('RUNNER_SHARED_SECRET');
  const baseCheckpoint = requireEnv('SANDBOX_BASE_CHECKPOINT');
  const runnerWsUrl = getRunnerWsUrl();
  const subdomain = await ensureSubdomain(project);

  // railgate ingress is optional: when the relay env is present, the in-sandbox
  // runner exposes the dev server via railgate; otherwise it falls back to the
  // WS HTTP-proxy. Inject only what's configured so the core sandbox+checkpoint
  // loop is testable before the relay exists.
  const railgateEnv: Record<string, string> = {};
  if (process.env.RAILGATE_RELAY_URL) {
    railgateEnv.RAILGATE_RELAY_URL = process.env.RAILGATE_RELAY_URL;
    railgateEnv.RAILGATE_SUBDOMAIN = subdomain;
    if (process.env.RAILGATE_TOKEN) railgateEnv.RAILGATE_TOKEN = process.env.RAILGATE_TOKEN;
    if (process.env.RAILGATE_BASE_DOMAIN) railgateEnv.RAILGATE_BASE_DOMAIN = process.env.RAILGATE_BASE_DOMAIN;
  }

  // Restore the project's saved workspace if it has one; else clean base image.
  const bootCheckpoint = project.sandboxCheckpoint ?? baseCheckpoint;

  await setSandbox(project.id, { sandboxStatus: 'provisioning' });

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(bootCheckpoint, {
      ...opts,
      idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
      env: {
        ANTHROPIC_API_KEY: anthropicApiKey,
        RUNNER_WS_URL: runnerWsUrl,
        RUNNER_SHARED_SECRET: runnerSharedSecret,
        RUNNER_ID: runnerId,
        WORKSPACE_ROOT: RUNNER_WORKSPACE,
        NODE_ENV: 'production',
        // railgate ingress (optional) — the runner's tunnel backend reads these to expose the dev server
        ...railgateEnv,
      },
    });
  } catch (err) {
    await setSandbox(project.id, { sandboxStatus: 'failed' });
    throw err;
  }

  await setSandbox(project.id, { sandboxId: sandbox.id, sandboxStatus: 'provisioning' });

  // Start the long-lived runner (baked global bin) as a detached session.
  try {
    const handle = sandbox.exec(`mkdir -p ${RUNNER_WORKSPACE} && hatchway runner`);
    await handle.detach();
  } catch (err) {
    await setSandbox(project.id, { sandboxStatus: 'failed' });
    throw err;
  }

  // Wait for the in-sandbox runner to connect back over the WS bridge.
  const deadline = Date.now() + PROVISION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isRunnerConnected(runnerId)) {
      await setSandbox(project.id, { sandboxStatus: 'running', runnerId });
      return { runnerId };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  await setSandbox(project.id, { sandboxStatus: 'failed' });
  throw new Error(`Sandbox runner ${runnerId} did not connect within ${PROVISION_TIMEOUT_MS / 1000}s`);
}

/**
 * Snapshot the project's workspace into its checkpoint (durable restore point).
 * Replaces any prior checkpoint so each project keeps exactly one snapshot.
 * Call after a build completes.
 */
export async function checkpointProject(project: SandboxProject): Promise<string | null> {
  if (!project.sandboxId) return null;
  const opts = railwayOpts();
  const name = projectCheckpointName(project.id);
  try {
    const sandbox = await Sandbox.connect(project.sandboxId, opts);
    // Delete the prior checkpoint so the name is free, then re-snapshot.
    if (project.sandboxCheckpoint) {
      await deleteCheckpointByKey(project.sandboxCheckpoint, opts);
    }
    const cp = await sandbox.checkpoint(name);
    await db.update(projects).set({ sandboxCheckpoint: cp.key, updatedAt: new Date() }).where(eq(projects.id, project.id));
    return cp.key;
  } catch (err) {
    console.error(`[sandbox] checkpoint failed for project ${project.id} (non-fatal):`, err);
    return null;
  }
}

/**
 * Tear down a project's sandbox (on stop or idle). Takes a final checkpoint
 * first (unless skipped) so the workspace survives, then destroys the VM.
 */
export async function destroySandbox(
  project: SandboxProject,
  options: { checkpoint?: boolean } = { checkpoint: true },
): Promise<void> {
  if (!project.sandboxId) return;
  if (options.checkpoint) {
    await checkpointProject(project);
  }
  try {
    const sandbox = await Sandbox.connect(project.sandboxId, railwayOpts());
    await sandbox.destroy();
  } catch (err) {
    console.error(`[sandbox] destroy failed for ${project.sandboxId} (continuing):`, err);
  } finally {
    await setSandbox(project.id, { sandboxId: null, sandboxStatus: 'stopped' });
  }
}

async function deleteCheckpointByKey(key: string, opts: { token: string; environmentId: string }): Promise<void> {
  try {
    const checkpoints = await Sandbox.checkpoints(opts);
    const match = checkpoints.find((c) => c.key === key);
    if (match) await Sandbox.deleteCheckpoint(match.id, opts);
  } catch (err) {
    console.error(`[sandbox] failed to delete checkpoint ${key}:`, err);
  }
}

async function setSandbox(
  projectId: string,
  fields: { sandboxId?: string | null; sandboxStatus?: string; runnerId?: string },
): Promise<void> {
  await db.update(projects).set({ ...fields, updatedAt: new Date() }).where(eq(projects.id, projectId));
}
