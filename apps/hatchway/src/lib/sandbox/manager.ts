/**
 * Railway sandbox lifecycle for "Sandbox" execution mode (backend-owned).
 *
 * Model (pivot): the LOCAL runner + local Claude Code (the user's subscription)
 * do the building in a local workspace. The Railway sandbox is purely the
 * RUN/PREVIEW target: the runner ships the built workspace here, we install +
 * run the dev server inside the box, and expose it via railgate. The backend
 * owns the sandbox lifecycle with the platform token (token never leaves the
 * server):
 *   - provision from the project's checkpoint (or the base checkpoint), or
 *     reuse the still-running sandbox;
 *   - sync a workspace tarball in, install, (re)start the dev server + railgate;
 *   - checkpoint after each completed build; destroy on stop/idle.
 *
 * Server env required:
 *   - RAILWAY_API_TOKEN, RAILWAY_ENVIRONMENT_ID   create/connect/checkpoint/destroy
 *   - SANDBOX_BASE_CHECKPOINT                      baked base (runtime + railgate + tmux)
 *   - RAILGATE_RELAY_URL, RAILGATE_TOKEN           railgate the in-sandbox client dials out to
 *   - RAILGATE_BASE_DOMAIN                         e.g. portal.hatchway.sh (forms the preview URL)
 */
import { Sandbox } from 'railway';
import { randomBytes } from 'node:crypto';
import { db } from '@hatchway/agent-core/lib/db/client';
import { projects } from '@hatchway/agent-core/lib/db/schema';
import { SELECTION_SCRIPT } from '@hatchway/agent-core/lib/selection/injector';
import { eq } from 'drizzle-orm';
import {
  INJECT_PROXY_PORT,
  INJECT_PROXY_PATH,
  INJECT_PROXY_SOURCE,
  SELECTION_SCRIPT_PATH,
} from './inject-proxy-source';

const WORKSPACE = '/workspace';
const IDLE_TIMEOUT_MINUTES = 30;

export type SandboxProject = {
  id: string;
  sandboxId: string | null;
  sandboxCheckpoint: string | null;
  sandboxSubdomain: string | null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Sandbox execution mode but is not set`);
  return value;
}

function railwayOpts() {
  return { token: requireEnv('RAILWAY_API_TOKEN'), environmentId: requireEnv('RAILWAY_ENVIRONMENT_ID') };
}

function projectCheckpointName(projectId: string): string {
  return `proj-${projectId}`;
}

/** Stable per-project railgate subdomain (12 hex), minted + persisted once. */
async function ensureSubdomain(project: SandboxProject): Promise<string> {
  if (project.sandboxSubdomain) return project.sandboxSubdomain;
  const subdomain = randomBytes(6).toString('hex');
  await db.update(projects).set({ sandboxSubdomain: subdomain }).where(eq(projects.id, project.id));
  project.sandboxSubdomain = subdomain;
  return subdomain;
}

async function setSandbox(
  projectId: string,
  fields: { sandboxId?: string | null; sandboxStatus?: string },
): Promise<void> {
  await db.update(projects).set({ ...fields, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

/** Single-quote a string for safe use as one shell argument (POSIX). */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function execOk(sb: Sandbox, cmd: string, timeoutSec: number): Promise<string> {
  const r = await sb.exec(cmd, { timeoutSec });
  if (r.exitCode !== 0) {
    // Prefer the tail of stderr/stdout — npm prints long warning headers first and
    // the actual failure reason (ERESOLVE, missing binary, next bind error) last.
    // exitCode null usually means the sandbox exec timed out / was killed.
    const combined = `${r.stderr || ''}\n${r.stdout || ''}`.trim();
    const tail = combined.length > 800 ? combined.slice(-800) : combined;
    const codeLabel = r.exitCode == null ? 'timeout/killed' : String(r.exitCode);
    throw new Error(`sandbox exec failed (exit ${codeLabel}): ${tail || 'no output'}`);
  }
  return r.stdout ?? '';
}

/**
 * Ensure g++/make/python3 exist for native module rebuilds (better-sqlite3, etc.).
 * Runs as its own exec so apt can take its own timeout budget and cannot starve
 * the later install/dev-server steps. No-op when the base checkpoint already
 * has the toolchain baked in.
 */
async function ensureNativeBuildToolchain(sb: Sandbox): Promise<void> {
  const check = await sb.exec(
    `bash -lc 'command -v g++ >/dev/null && command -v make >/dev/null && command -v python3 >/dev/null && echo READY || echo MISSING'`,
    { timeoutSec: 30 },
  );
  if ((check.stdout || '').includes('READY')) return;

  console.log('[sandbox] native build toolchain missing; installing build-essential/python3');
  // Separate from extract/install so apt has its own timeout budget and clearer
  // errors. Keep under the sandbox/sync route maxDuration headroom.
  // Acquire::Retries helps flaky package mirrors.
  await execOk(
    sb,
    `bash -lc ${shQuote(
      [
        'set -e',
        'export DEBIAN_FRONTEND=noninteractive',
        'apt-get -o Acquire::Retries=3 update -qq',
        'apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends build-essential python3 pkg-config',
        'command -v g++ >/dev/null',
        'command -v make >/dev/null',
        'command -v python3 >/dev/null',
        'echo "[sandbox] native build toolchain ready"',
      ].join('\n'),
    )}`,
    300,
  );
}

/**
 * Ensure a running sandbox for this project and return the connected handle.
 * Reuses a still-running sandbox; otherwise restores from the project's saved
 * checkpoint (or the base checkpoint for a never-built project).
 */
export async function ensureSandbox(project: SandboxProject): Promise<Sandbox> {
  const opts = railwayOpts();

  // Warm path: reuse a still-running sandbox.
  if (project.sandboxId) {
    try {
      const existing = await Sandbox.connect(project.sandboxId, opts);
      const status = String(existing.status || '').toUpperCase();
      if (status === 'RUNNING' || status === 'STARTING' || status === '') {
        return existing;
      }
    } catch {
      // Sandbox is gone — fall through and recreate from checkpoint.
    }
  }

  const bootCheckpoint = project.sandboxCheckpoint ?? requireEnv('SANDBOX_BASE_CHECKPOINT');
  await setSandbox(project.id, { sandboxStatus: 'provisioning' });

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(bootCheckpoint, { ...opts, idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES });
  } catch (err) {
    await setSandbox(project.id, { sandboxStatus: 'failed' });
    throw err;
  }

  await setSandbox(project.id, { sandboxId: sandbox.id, sandboxStatus: 'running' });
  return sandbox;
}

export interface SyncAndRunOptions {
  /** gzipped tarball of the workspace (node_modules/.git excluded), base64-encoded */
  tarballBase64: string;
  /** dev-server port to expose via railgate */
  port: number;
  /** install command (default: npm install) */
  installCommand?: string;
  /** dev-server command (default: npm run dev) */
  runCommand?: string;
}

export interface SyncAndRunResult {
  sandboxId: string;
  previewUrl: string;
}

/**
 * Ship a built workspace into the sandbox, install deps, (re)start the dev
 * server + railgate tunnel, and return the public preview URL.
 */
export async function syncAndRun(project: SandboxProject, options: SyncAndRunOptions): Promise<SyncAndRunResult> {
  const sandbox = await ensureSandbox(project);
  const subdomain = await ensureSubdomain(project);
  const installCommand = options.installCommand || 'npm install';
  const runCommand = options.runCommand || 'npm run dev';
  // railgate's client appends the control path itself (`relayUrl + /_tunnel/connect`),
  // so RAILGATE_RELAY_URL must be the BASE relay URL. Strip a trailing control
  // path if someone set the full URL, otherwise it doubles and the relay 502s.
  const relay = requireEnv('RAILGATE_RELAY_URL').replace(/\/_tunnel\/connect\/?$/, '');
  const token = requireEnv('RAILGATE_TOKEN');
  const port = options.port;

  // Ensure native build deps BEFORE shipping the tarball so apt never shares a
  // timeout budget with extract + npm install + dev server boot. Base
  // checkpoints that already include the toolchain make this a ~1s no-op.
  await ensureNativeBuildToolchain(sandbox);

  // Land the tarball (base64 text → decoded; avoids binary-transfer issues).
  await sandbox.files.write('/tmp/workspace.tgz.b64', options.tarballBase64);

  // Land the element-selection injection proxy + the raw selection script it
  // serves. railgate points at this proxy (not the dev server directly) so the
  // previewed HTML carries the selection script — same shape as the local
  // runner's tunnel→injection-proxy→dev-server chain.
  await sandbox.files.write(INJECT_PROXY_PATH, INJECT_PROXY_SOURCE);
  await sandbox.files.write(SELECTION_SCRIPT_PATH, SELECTION_SCRIPT);

  // One script, run via a LOGIN shell (`bash -lc`) so the sandbox's mise setup
  // is sourced and node/npm/pnpm/railgate are on PATH (a non-interactive exec
  // shell doesn't get them).
  //
  // Follow-up syncs reuse the same running sandbox: we restart ONLY the dev
  // server and leave the injection proxy + railgate sessions running. railgate
  // points at the (stable) injection-proxy port, so its tunnel — and the
  // preview URL — stays connected while the dev server reloads the new code
  // behind it. The proxy/railgate are (re)started only when not already up
  // (first run, or after a checkpoint restore where no processes survive).
  const script = [
    'set -e',
    // Clear stale source (so deleted files don't linger on follow-ups) but KEEP
    // node_modules so re-install is near-instant. The tarball excludes
    // node_modules, so extracting over it only refreshes source.
    `mkdir -p ${WORKSPACE}`,
    `find ${WORKSPACE} -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + 2>/dev/null || true`,
    // macOS-created tarballs may still carry unknown pax/xattr headers
    // (LIBARCHIVE.xattr.*). GNU tar treats some as fatal; ignore them.
    `base64 -d /tmp/workspace.tgz.b64 | tar xz --no-same-owner --warning=no-unknown-keyword -C ${WORKSPACE} 2>/tmp/tar-extract.err || { ` +
      `ec=$?; ` +
      // Retry without --warning if the sandbox tar is busybox/old and rejects the flag.
      `if grep -qiE 'unrecognized|invalid option|not supported|unknown option' /tmp/tar-extract.err 2>/dev/null; then ` +
        `base64 -d /tmp/workspace.tgz.b64 | tar xz --no-same-owner -C ${WORKSPACE}; ` +
      `else ` +
        // If the only "errors" are unknown extended headers, treat as success when files landed.
        `if [ "$ec" -ne 0 ] && grep -qE "Ignoring unknown extended header|LIBARCHIVE\\.xattr" /tmp/tar-extract.err 2>/dev/null && [ -n "$(ls -A ${WORKSPACE} 2>/dev/null)" ]; then ` +
          `echo "[sandbox] tar reported xattr warnings but extract landed files; continuing"; ` +
        `else ` +
          `cat /tmp/tar-extract.err >&2; exit "$ec"; ` +
        `fi; ` +
      `fi; }`,
    'rm -f /tmp/workspace.tgz.b64',
    `cd ${WORKSPACE}`,
    // Template .npmrc may contain pnpm-only keys (enable-modules-dir, shamefully-hoist).
    // npm treats unknown project config as hard errors on newer versions, so strip those
    // keys before install when using npm. Keep the file for pnpm/yarn installs.
    `if echo ${shQuote(installCommand)} | grep -Eq '(^|[[:space:]])npm([[:space:]]|$)'; then ` +
      `if [ -f .npmrc ]; then ` +
        `grep -Ev '^(enable-modules-dir|shamefully-hoist|auto-install-peers|node-linker|public-hoist-pattern)=' .npmrc > .npmrc.hatchway 2>/dev/null || true; ` +
        `mv .npmrc.hatchway .npmrc; ` +
      `fi; ` +
    `fi`,
    // Prefer prebuilt binaries when available; fall back to node-gyp with toolchain above.
    'export npm_config_build_from_source=false',
    'export npm_config_python="$(command -v python3 || echo python3)"',
    // Surface install failures with a log tail rather than only npm warning noise.
    `{ ${installCommand}; } > /tmp/sandbox-install.log 2>&1 || { echo "[sandbox] install failed: ${installCommand}"; tail -n 120 /tmp/sandbox-install.log; exit 1; }`,
    'tail -n 20 /tmp/sandbox-install.log 2>/dev/null || true',
    // Restart only the dev server with the freshly-synced code.
    'tmux kill-session -t dev 2>/dev/null || true',
    // Vite/Astro IGNORE the PORT env var (they only honor --port), so pass the
    // port + host as CLI args forwarded through the npm script (`-- …`). Keeping
    // PORT/HOST env too is harmless and helps frameworks that do read them
    // (e.g. Next). Without --port a non-default port silently breaks: the dev
    // server binds its own default and nothing can reach it.
    `tmux new-session -d -s dev 'cd ${WORKSPACE} && PORT=${port} HOST=0.0.0.0 ${runCommand} -- --host 0.0.0.0 --port ${port} > /tmp/dev.log 2>&1'`,
    // Wait for the dev server to actually listen before reporting ready, so the
    // first request through the tunnel doesn't hit a not-yet-ready server.
    `for i in $(seq 1 90); do (echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null && break; sleep 1; done`,
    // Fail loudly (with the dev log) if it never bound — otherwise the sync
    // "succeeds" but the preview only ever serves proxy errors.
    `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null || { echo "[sandbox] dev server never bound to port ${port} within 90s — dev.log tail:"; tail -n 80 /tmp/dev.log 2>/dev/null; exit 1; }`,
    // Injection proxy (dev server → +selection script). Survives follow-ups;
    // railgate points at it, not the dev server, so the "select element" tool
    // works and the tunnel target port never changes.
    `tmux has-session -t inject 2>/dev/null || tmux new-session -d -s inject 'TARGET_PORT=${port} PROXY_PORT=${INJECT_PROXY_PORT} node ${INJECT_PROXY_PATH} > /tmp/inject.log 2>&1'`,
    `for i in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/${INJECT_PROXY_PORT}) 2>/dev/null && break; sleep 1; done`,
    // railgate: start only if not already running, so follow-up syncs keep the
    // existing tunnel/URL connected instead of tearing it down and reconnecting.
    `tmux has-session -t railgate 2>/dev/null || tmux new-session -d -s railgate 'railgate http ${INJECT_PROXY_PORT} -r ${relay} -t ${token} --subdomain ${subdomain} --force > /tmp/railgate.log 2>&1'`,
    // Wait for railgate to register the tunnel with the relay before we report
    // ready (already-present 'tunnel active' from a prior run matches at once).
    `for i in $(seq 1 30); do grep -q 'tunnel active' /tmp/railgate.log 2>/dev/null && break; sleep 1; done`,
    // Surface the railgate log if the tunnel never came up (non-fatal — the
    // preview URL is still returned, but this tells us why it isn't reachable).
    `grep -q 'tunnel active' /tmp/railgate.log 2>/dev/null || { echo "[sandbox] railgate never reported 'tunnel active' within 30s — railgate.log tail:"; tail -n 40 /tmp/railgate.log 2>/dev/null; }`,
  ].join('\n');

  await execOk(sandbox, `bash -lc ${shQuote(script)}`, 900);

  const baseDomain = process.env.RAILGATE_BASE_DOMAIN || 'portal.hatchway.sh';
  await setSandbox(project.id, { sandboxStatus: 'running' });
  return { sandboxId: sandbox.id, previewUrl: `https://${subdomain}.${baseDomain}` };
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
