#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths relative to this bin script
const instrumentPath = resolve(__dirname, '../dist/instrument.js');
const cliPath = resolve(__dirname, '../dist/cli/index.js');

// Spawn node with --import flag for proper ESM instrumentation
const child = spawn(
  process.execPath, // Use the same Node.js binary
  ['--import', instrumentPath, cliPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: process.env,
  }
);

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to start CLI:', err);
  process.exit(1);
});
