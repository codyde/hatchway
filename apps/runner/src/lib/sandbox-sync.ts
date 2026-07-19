/**
 * Sandbox sync (Sandbox execution mode).
 *
 * In sandbox mode the runner builds locally as usual, then — instead of starting
 * a local dev server + tunnel — ships the built workspace to the backend, which
 * runs it inside a Railway sandbox and exposes it via railgate. The Railway
 * token stays server-side; the runner only uploads a tarball over its existing
 * authenticated HTTP channel.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * gzip the workspace (excluding heavy/derived dirs) and base64-encode it.
 *
 * macOS tar embeds Apple xattrs (LIBARCHIVE.xattr.com.apple.provenance, etc.)
 * that make Linux tar in the sandbox exit non-zero on extract. Disable copyfile
 * xattrs and omit extended attributes when the local tar supports it.
 */
export function tarWorkspaceBase64(dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const args = [
      '-czf', '-',
      // Prefer portable archives: no macOS resource forks / xattrs when supported.
      '--no-xattrs',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=.next',
      '--exclude=dist',
      '--exclude=.turbo',
      '--exclude=.DS_Store',
      '--exclude=**/.DS_Store',
      '-C', dir,
      '.',
    ];

    const trySpawn = (tarArgs: string[], env: NodeJS.ProcessEnv) => {
      const tar = spawn('tar', tarArgs, {
        env: {
          ...env,
          // macOS: stop packing ._ resource forks / copyfile xattrs into ustar headers.
          COPYFILE_DISABLE: '1',
          TAR_OPTIONS: [env.TAR_OPTIONS, '--no-xattrs'].filter(Boolean).join(' ').trim() || undefined,
        },
      });
      tar.stdout.on('data', (c: Buffer) => chunks.push(c));
      tar.stderr.on('data', (c: Buffer) => errChunks.push(c));
      tar.on('error', reject);
      tar.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks).toString('base64'));
          return;
        }
        const errText = Buffer.concat(errChunks).toString();
        // Older/busybox tar may not support --no-xattrs; retry without it but keep COPYFILE_DISABLE.
        if (tarArgs.includes('--no-xattrs') && /unrecognized|invalid option|not supported|unknown option/i.test(errText)) {
          chunks.length = 0;
          errChunks.length = 0;
          trySpawn(tarArgs.filter((a) => a !== '--no-xattrs'), env);
          return;
        }
        reject(new Error(`tar exited ${code}: ${errText.slice(0, 300)}`));
      });
    };

    trySpawn(args, process.env);
  });
}

/** Pick the install command from whichever lockfile the workspace ships. */
export function detectInstallCommand(dir: string): string {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm install';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn install';
  if (existsSync(join(dir, 'bun.lockb'))) return 'bun install';
  return 'npm install';
}

export interface SyncToSandboxOptions {
  apiBaseUrl: string;
  sharedSecret: string;
  projectId: string;
  dir: string;
  port: number;
  runCommand: string;
  installCommand?: string;
}

export async function syncToSandbox(opts: SyncToSandboxOptions): Promise<{ previewUrl: string; sandboxId: string }> {
  const tarballBase64 = await tarWorkspaceBase64(opts.dir);
  const installCommand = opts.installCommand || detectInstallCommand(opts.dir);

  const res = await fetch(`${opts.apiBaseUrl}/api/projects/${opts.projectId}/sandbox/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.sharedSecret}`,
    },
    body: JSON.stringify({
      tarballBase64,
      port: opts.port,
      installCommand,
      runCommand: opts.runCommand,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`sandbox sync failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as { previewUrl: string; sandboxId: string };
}
