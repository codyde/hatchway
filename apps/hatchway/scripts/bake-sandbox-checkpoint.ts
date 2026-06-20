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
const cliPackage = process.env.SANDBOX_CLI_PACKAGE || '@hatchway/cli@latest';
const railgatePackage = process.env.SANDBOX_RAILGATE_PACKAGE || 'railgate@latest';
const checkpointName = process.env.SANDBOX_BASE_CHECKPOINT || 'hatchway-base';
const NODE_MAJOR = process.env.SANDBOX_NODE_MAJOR || '22';

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
    await step(
      sb,
      `Install Node ${NODE_MAJOR} + curl`,
      `apt-get update -qq && apt-get install -y -qq curl ca-certificates && ` +
        `curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && ` +
        `apt-get install -y -qq nodejs`,
      600,
    );
    await step(sb, `Install ${cliPackage} + ${railgatePackage}`, `npm i -g ${cliPackage} ${railgatePackage}`, 600);
    await step(
      sb,
      'Verify tools',
      `node --version && hatchway --version && railgate --version`,
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
