/**
 * Bake the base sandbox checkpoint for Sandbox execution mode.
 *
 * Boots a clean Railway sandbox, installs Node + the Hatchway CLI (the runner)
 * + the railgate tunnel client, then snapshots it as a reusable checkpoint.
 * Every per-project sandbox is created from this checkpoint (or a project's own
 * checkpoint forked off it), so boots are fast and the runner is preinstalled —
 * no `npx`/`npm install` at runtime.
 *
 * Run once (and again whenever you publish a new CLI/railgate version):
 *   RAILWAY_API_TOKEN=… RAILWAY_ENVIRONMENT_ID=… \
 *   SANDBOX_CLI_PACKAGE=@hatchway/cli@next SANDBOX_RAILGATE_PACKAGE=railgate@0.6.0 \
 *   pnpm --filter hatchway exec tsx scripts/bake-sandbox-checkpoint.ts
 *
 * Then set SANDBOX_BASE_CHECKPOINT to the printed name on the Hatchway service.
 *
 * IMPORTANT: the baked railgate client and the deployed relay must share the
 * same protocol version — pin SANDBOX_RAILGATE_PACKAGE to the version the
 * *.portal.hatchway.sh relay runs.
 */
import { Sandbox } from 'railway';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

const token = requireEnv('RAILWAY_API_TOKEN');
const environmentId = requireEnv('RAILWAY_ENVIRONMENT_ID');
const railgatePackage = process.env.SANDBOX_RAILGATE_PACKAGE || 'railgate@latest';
const checkpointName = process.env.SANDBOX_BASE_CHECKPOINT || 'hatchway-base';

const opts = { token, environmentId };

async function step(sb: Sandbox, label: string, command: string, timeoutSec: number) {
  console.log(`\n▶ ${label}`);
  const r = await sb.exec(command, { timeoutSec, onStdout: (c) => process.stdout.write(c) });
  if (r.exitCode !== 0) {
    throw new Error(`Step failed (${label}) exit=${r.exitCode}: ${r.stderr.slice(0, 500)}`);
  }
}

async function main() {
  console.log('Creating clean base sandbox...');
  const sb = await Sandbox.create({ ...opts, idleTimeoutMinutes: 30 });
  console.log(`Sandbox ${sb.id} (${sb.status})`);

  try {
    // Railway's base image ships Node via mise. The sandbox is the RUN target,
    // so it needs: railgate (preview tunnel), tmux (keep the dev server + tunnel
    // alive across exec sessions), pnpm (most templates), and a native build
    // toolchain for modules like better-sqlite3 that rebuild via node-gyp.
    // No @hatchway/cli — the runner + Claude Code run on the user's machine.
    await step(
      sb,
      'Install tmux + native build toolchain',
      `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux build-essential python3 python3-pip pkg-config`,
      600,
    );
    await step(
      sb,
      `Install ${railgatePackage} + pnpm`,
      `npm i -g ${railgatePackage} && (corepack enable || npm i -g pnpm)`,
      600,
    );
    await step(
      sb,
      'Verify tools',
      `node --version && railgate --version && tmux -V && pnpm --version && g++ --version | head -1 && make --version | head -1 && python3 --version`,
      60,
    );

    console.log(`\nCheckpointing as "${checkpointName}"...`);
    const cp = await sb.checkpoint(checkpointName);
    console.log(`✓ Checkpoint created: key=${cp.key} id=${cp.id}`);
    console.log(`\nNow set on the Hatchway service:  SANDBOX_BASE_CHECKPOINT=${cp.key}`);
  } finally {
    console.log('Destroying temporary bake sandbox...');
    await sb.destroy().catch((err) => console.error('destroy failed (ignore):', err));
  }
}

main().catch((err) => {
  console.error('Bake failed:', err);
  process.exit(1);
});
