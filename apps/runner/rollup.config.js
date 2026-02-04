/**
 * Rollup configuration for @hatchway/cli
 * Bundles the CLI with React included to prevent multiple instances issue with ink
 */
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';

// External dependencies - these won't be bundled
const external = [
  // Node.js built-ins (rollup handles node: protocol automatically)
  'node:child_process',
  'node:crypto',
  'node:events',
  'node:fs',
  'node:fs/promises',
  'node:http',
  'node:https',
  'node:module',
  'node:net',
  'node:os',
  'node:path',
  'node:readline',
  'node:stream',
  'node:url',
  'node:util',
  // Also match without node: prefix (rollup normalizes these)
  'child_process',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'readline',
  'stream',
  'url',
  'util',
  
  // NPM dependencies
  '@sentry/node',
  '@anthropic-ai/claude-agent-sdk',
  '@clack/prompts',
  '@openai/codex-sdk',
  'better-auth',
  'chalk',
  'clsx',
  'commander',
  'conf',
  'dotenv',
  'drizzle-orm',
  'drizzle-orm/node-postgres',
  'drizzle-orm/node-postgres/migrator',
  'express',
  'http-proxy',
  // Bundle ink ecosystem with React to prevent multiple React instances
  // 'ink',
  // 'ink-select-input',
  // 'ink-spinner',
  // 'ink-text-input',
  'inquirer',
  'jsonc-parser',
  'lucide-react',
  'ora',
  'pg',
  'picocolors',
  // 'react',  // Bundle React to avoid multiple instances issue with ink
  'server-only',
  'simple-git',
  'tailwind-merge',
  'ws',
  'zod',
  'zod-to-json-schema',
];

// Check if a module should be external
function isExternal(id) {
  // Exact matches
  if (external.includes(id)) return true;
  
  // Match subpaths (e.g., drizzle-orm/pg-core)
  for (const ext of external) {
    if (id.startsWith(ext + '/')) return true;
  }
  
  // Never externalize @hatchway/agent-core - we bundle it
  if (id.startsWith('@hatchway/agent-core')) return false;
  
  return false;
}

const commonPlugins = [
  nodeResolve({
    preferBuiltins: true,
    exportConditions: ['node', 'import', 'default'],
  }),
  commonjs({
    // Convert CJS dependencies to ESM
    transformMixedEsModules: true,
  }),
  typescript({
    tsconfig: './tsconfig.json',
    outputToFilesystem: true,
  }),
  json(),
];

// Banner to inject CJS compatibility shim for OpenTelemetry/Sentry instrumentation
// The Sentry SDK uses require-in-the-middle which needs `require` and `require.cache`
const cjsShimBanner = `// Hatchway CLI - Built with Rollup
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
`;

const defaultBanner = '// Hatchway CLI - Built with Rollup';

export default {
  input: {
    'index': 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'instrument': 'src/instrument.ts',
  },
  output: {
    dir: 'dist',
    format: 'esm',
    sourcemap: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    // Use CJS shim for instrument.js (Sentry SDK), default banner for others
    banner: (chunk) => chunk.name === 'instrument' ? cjsShimBanner : defaultBanner,
  },
  external: isExternal,
  plugins: commonPlugins,
  // Suppress known harmless warnings
  onwarn(warning, warn) {
    // Ignore "this is undefined" warnings from @opentelemetry
    // These are caused by TypeScript-generated helpers in their ESM build
    // that use `this` at module scope, which is undefined in ES modules.
    // The code still works correctly - it just falls back to inline helpers.
    if (warning.code === 'THIS_IS_UNDEFINED' && 
        warning.id?.includes('@opentelemetry')) {
      return;
    }
    warn(warning);
  },
};
