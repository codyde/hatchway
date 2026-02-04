/**
 * Rollup configuration for @hatchway/runner (lightweight runner package)
 *
 * This config bundles the runner functionality from @hatchway/cli at build time,
 * so the published package is self-contained and doesn't require @hatchway/cli at runtime.
 */
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths to workspace packages
const CLI_SRC = path.resolve(__dirname, '../../apps/runner/src');
const AGENT_CORE_SRC = path.resolve(__dirname, '../agent-core/src');

// External dependencies - these won't be bundled
const external = [
  // Node.js built-ins
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
  // Also match without node: prefix
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

  // NPM dependencies that are external
  '@sentry/node',
  '@anthropic-ai/claude-agent-sdk',
  '@openai/codex-sdk',
  'chalk',
  'commander',
  'conf',
  'dotenv',
  'express',
  // Bundle ink ecosystem with React
  // 'ink',
  // 'ink-select-input',
  // 'ink-spinner',
  // 'ink-text-input',
  'picocolors',
  // 'react',
  'ws',
  'zod',
  'zod-to-json-schema',
];

// Check if a module should be external
function isExternal(id) {
  // Never externalize workspace packages - we bundle them
  if (id.startsWith('@hatchway/')) return false;

  // Exact matches
  if (external.includes(id)) return true;

  // Match subpaths
  for (const ext of external) {
    if (id.startsWith(ext + '/')) return true;
  }

  return false;
}

// Try to resolve a path with different extensions
function resolveWithExtensions(basePath, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  // Also try index files
  for (const ext of extensions) {
    const indexPath = path.join(basePath, 'index' + ext);
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }
  // Return .ts as default (will error if not found, which is expected)
  return basePath + '.ts';
}

// Custom plugin to resolve @hatchway/* imports to source files
function workspaceAliasPlugin() {
  return {
    name: 'workspace-alias',
    resolveId(source, importer) {
      // Handle @hatchway/cli imports
      if (source === '@hatchway/cli/index' || source === '@hatchway/cli') {
        return { id: resolveWithExtensions(path.join(CLI_SRC, 'index')), external: false };
      }
      if (source.startsWith('@hatchway/cli/')) {
        const subpath = source.replace('@hatchway/cli/', '');
        return { id: resolveWithExtensions(path.join(CLI_SRC, subpath)), external: false };
      }

      // Handle @hatchway/agent-core imports
      if (source === '@hatchway/agent-core/index' || source === '@hatchway/agent-core') {
        return { id: resolveWithExtensions(path.join(AGENT_CORE_SRC, 'index')), external: false };
      }
      if (source.startsWith('@hatchway/agent-core/')) {
        const subpath = source.replace('@hatchway/agent-core/', '');
        return { id: resolveWithExtensions(path.join(AGENT_CORE_SRC, subpath)), external: false };
      }

      return null;
    },
  };
}

const commonPlugins = [
  workspaceAliasPlugin(),
  nodeResolve({
    preferBuiltins: true,
    exportConditions: ['node', 'import', 'default'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  }),
  commonjs({
    transformMixedEsModules: true,
  }),
  typescript({
    tsconfig: './tsconfig.json',
    outputToFilesystem: true,
  }),
  json(),
];

// Banner for CJS compatibility shim
const cjsShimBanner = `// Hatchway Runner - Built with Rollup
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
`;

const defaultBanner = '// Hatchway Runner - Built with Rollup';

export default {
  input: {
    'index': 'src/index.ts',
    'cli': 'src/cli.ts',
    'instrument': 'src/instrument.ts',
  },
  output: {
    dir: 'dist',
    format: 'esm',
    sourcemap: false, // No sourcemaps for smaller package size
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    banner: (chunk) => chunk.name === 'instrument' ? cjsShimBanner : defaultBanner,
  },
  external: isExternal,
  plugins: commonPlugins,
  onwarn(warning, warn) {
    // Ignore "this is undefined" warnings from @opentelemetry
    if (warning.code === 'THIS_IS_UNDEFINED' &&
        warning.id?.includes('@opentelemetry')) {
      return;
    }
    warn(warning);
  },
};
