#!/usr/bin/env node
/**
 * Prepare package.json for publishing
 *
 * This script:
 * 1. REMOVES @hatchway/agent-core from dependencies (it's bundled by rollup)
 * 2. Removes bundled React ecosystem packages to prevent duplicate React instances
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../package.json');

console.log('Preparing package.json for release...');
console.log('');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

let modified = false;

// REMOVE workspace dependencies - they're bundled into dist/ by rollup
// This eliminates npm 404 errors since these packages don't exist on npm
const workspaceDeps = ['@hatchway/agent-core', '@hatchway/opencode-client'];
for (const dep of workspaceDeps) {
  if (packageJson.dependencies[dep]) {
    console.log(`  Removing ${dep} (bundled by rollup)`);
    delete packageJson.dependencies[dep];
    modified = true;
  }
}

// REMOVE react and ink ecosystem - they're bundled by rollup to prevent multiple React instances
// When these are both bundled AND listed as dependencies, multiple React instances get loaded
// causing "Cannot read properties of null (reading 'useState')" errors
const bundledReactEcosystem = ['react', 'ink', 'ink-select-input', 'ink-spinner', 'ink-text-input'];
for (const dep of bundledReactEcosystem) {
  if (packageJson.dependencies[dep]) {
    console.log(`  Removing ${dep} (bundled by rollup to prevent multiple React instances)`);
    delete packageJson.dependencies[dep];
    modified = true;
  }
}

// Remove bundledDependencies if it exists (no longer needed)
if (packageJson.bundledDependencies) {
  console.log(`  Removing bundledDependencies (agent-core is inlined, not bundled)`);
  delete packageJson.bundledDependencies;
  modified = true;
}

if (modified) {
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
  console.log('');
  console.log('✓ package.json updated for release');
  console.log('');
  console.log('Note: This modifies package.json. After publishing, run:');
  console.log('  git checkout apps/runner/package.json');
  console.log('  to restore workspace:* dependency for local development');
} else {
  console.log('✓ package.json already prepared for release');
}
