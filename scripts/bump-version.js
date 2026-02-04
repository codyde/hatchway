#!/usr/bin/env node

/**
 * Version Bump Script
 * 
 * Updates version in all package.json files across the monorepo.
 * 
 * Usage:
 *   node scripts/bump-version.js [major|minor|patch]
 * 
 * Examples:
 *   node scripts/bump-version.js patch  # 0.27.1 → 0.27.2
 *   node scripts/bump-version.js minor  # 0.27.1 → 0.28.0
 *   node scripts/bump-version.js major  # 0.27.1 → 1.0.0
 */

const fs = require('fs');
const path = require('path');

const BUMP_TYPE = process.argv[2] || 'patch';

// All package.json files to update
const PACKAGE_FILES = [
  'package.json',
  'apps/runner/package.json',
  'apps/hatchway/package.json',
  'packages/agent-core/package.json',
];

/**
 * Bump a semantic version string
 * @param {string} version - Current version (e.g., "0.27.1")
 * @param {string} type - Bump type: "major", "minor", or "patch"
 * @returns {string} New version
 */
function bumpVersion(version, type) {
  const parts = version.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid version format: ${version}`);
  }
  
  const [major, minor, patch] = parts.map(Number);
  
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    throw new Error(`Invalid version numbers in: ${version}`);
  }
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

// Validate bump type
if (!['major', 'minor', 'patch'].includes(BUMP_TYPE)) {
  console.error(`❌ Invalid bump type: ${BUMP_TYPE}`);
  console.error('   Valid types: major, minor, patch');
  process.exit(1);
}

// Read current version from root package.json
const rootPkgPath = path.resolve(process.cwd(), 'package.json');
if (!fs.existsSync(rootPkgPath)) {
  console.error('❌ Root package.json not found');
  console.error('   Make sure you run this script from the repository root');
  process.exit(1);
}

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const currentVersion = rootPkg.version;

if (!currentVersion) {
  console.error('❌ No version field found in root package.json');
  process.exit(1);
}

const newVersion = bumpVersion(currentVersion, BUMP_TYPE);

console.log(`\n📦 Version Bump: ${BUMP_TYPE.toUpperCase()}`);
console.log(`   ${currentVersion} → ${newVersion}\n`);

// Update all package.json files
let updatedCount = 0;
let skippedCount = 0;

for (const file of PACKAGE_FILES) {
  const filePath = path.resolve(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`   ⚠️  Skipped: ${file} (not found)`);
    skippedCount++;
    continue;
  }
  
  try {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const oldVersion = pkg.version;
    pkg.version = newVersion;
    
    // Write with 2-space indentation and trailing newline
    fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
    
    console.log(`   ✓ ${file} (${oldVersion} → ${newVersion})`);
    updatedCount++;
  } catch (error) {
    console.error(`   ❌ Failed to update ${file}: ${error.message}`);
    process.exit(1);
  }
}

console.log(`\n✅ Updated ${updatedCount} file(s)`);
if (skippedCount > 0) {
  console.log(`⚠️  Skipped ${skippedCount} file(s)`);
}

console.log(`\n🏷️  New version: ${newVersion}\n`);
