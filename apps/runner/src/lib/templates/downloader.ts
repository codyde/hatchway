import { existsSync } from 'node:fs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import type { Template } from './config.js';
import { join } from 'node:path';
import { getWorkspaceRoot } from '../workspace.js';
import { simpleGit } from 'simple-git';

/**
 * Download template from GitHub using degit
 * degit is faster than git clone (no history, just files)
 */
export async function downloadTemplate(
  template: Template,
  targetPath: string
): Promise<string> {
  if (process.env.DEBUG_BUILD === '1') console.log(`📥 Downloading template: ${template.name}`);
  if (process.env.DEBUG_BUILD === '1') console.log(`   Repository: ${template.repository}`);
  if (process.env.DEBUG_BUILD === '1') console.log(`   Branch: ${template.branch}`);
  if (process.env.DEBUG_BUILD === '1') console.log(`   Target: ${targetPath}`);

  // Check if target already exists and add random suffix if needed
  let finalTargetPath = targetPath;
  if (existsSync(targetPath)) {
    // Generate a unique 4-character suffix
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    finalTargetPath = `${targetPath}-${randomSuffix}`;
    
    console.log(`[downloader] ⚠️  Directory already exists: ${targetPath}`);
    console.log(`[downloader] 📁 Using unique path: ${finalTargetPath}`);
  }

  // Use degit to download template
  // Format: github:username/repo#branch
  const repoUrl = template.branch !== 'main'
    ? `${template.repository}#${template.branch}`
    : template.repository;

  // Use simple-git directly (no spawn issues)
  return await downloadTemplateWithGit(template, finalTargetPath);
}

/**
 * Alternative: Use git clone (fallback if degit unavailable)
 */
export async function downloadTemplateWithGit(
  template: Template,
  targetPath: string
): Promise<string> {

  if (process.env.DEBUG_BUILD === '1') console.log(`📥 Cloning template with simple-git: ${template.name}`);

  // Parse GitHub URL
  // "github:username/repo" → "https://github.com/username/repo.git"
  const repoUrl = template.repository.replace('github:', 'https://github.com/') + '.git';

  if (process.env.DEBUG_BUILD === '1') console.log(`   Repository: ${repoUrl}`);
  if (process.env.DEBUG_BUILD === '1') console.log(`   Branch: ${template.branch}`);
  if (process.env.DEBUG_BUILD === '1') console.log(`   Target: ${targetPath}`);

  try {
    const git = simpleGit();

    // Clone with depth 1 (shallow clone)
    await git.clone(repoUrl, targetPath, [
      '--depth', '1',
      '--branch', template.branch,
      '--single-branch'
    ]);

    if (process.env.DEBUG_BUILD === '1') console.log(`✅ Template cloned successfully`);

    // Verify files were actually downloaded
    const { readdir } = await import('node:fs/promises');
    const downloadedFiles = await readdir(targetPath);
    if (process.env.DEBUG_BUILD === '1') console.log(`   Downloaded ${downloadedFiles.length} files/directories`);
    if (process.env.DEBUG_BUILD === '1') console.log(`   Files: ${downloadedFiles.slice(0, 10).join(', ')}${downloadedFiles.length > 10 ? '...' : ''}`);

    if (downloadedFiles.length === 0) {
      throw new Error('Template clone succeeded but directory is empty!');
    }

    // Remove .git directory (we don't need version history)
    try {
      await rm(join(targetPath, '.git'), { recursive: true, force: true });
      if (process.env.DEBUG_BUILD === '1') console.log(`   Cleaned .git directory`);
    } catch (error) {
      console.warn(`   Failed to remove .git:`, error);
    }

    // Create .npmrc to isolate from monorepo workspace
    await createNpmrc(targetPath);

    // Extract project name from path
    const projectName = targetPath.split('/').pop() || 'project';

    // Update package.json name(s)
    await updatePackageName(targetPath, projectName);

    // Remove hardcoded ports from dev scripts to allow dynamic port allocation
    await removeHardcodedPorts(targetPath);

    // Ensure vite.config has PORT env var support for Vite-based projects
    await ensureVitePortConfig(targetPath);

    // Handle multi-package projects with client/server subdirectories
    const clientPkgPath = join(targetPath, 'client', 'package.json');
    const serverPkgPath = join(targetPath, 'server', 'package.json');

    if (existsSync(clientPkgPath)) {
      await updatePackageName(join(targetPath, 'client'), `${projectName}-client`);
      await removeHardcodedPorts(join(targetPath, 'client'));
      await ensureVitePortConfig(join(targetPath, 'client'));
    }
    if (existsSync(serverPkgPath)) {
      await updatePackageName(join(targetPath, 'server'), `${projectName}-server`);
      await removeHardcodedPorts(join(targetPath, 'server'));
      await ensureVitePortConfig(join(targetPath, 'server'));
    }

    return targetPath;

  } catch (error) {
    console.error(`❌ Failed to clone template:`, error);
    throw new Error(`Template download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create .npmrc to isolate project from monorepo workspace
 */
async function createNpmrc(projectPath: string): Promise<void> {
  const npmrcPath = join(projectPath, '.npmrc');
  const npmrcContent = `# Disable workspace mode - treat as standalone project
enable-modules-dir=true
shamefully-hoist=false
`;

  try {
    await writeFile(npmrcPath, npmrcContent);
    if (process.env.DEBUG_BUILD === '1') console.log(`   Created .npmrc to isolate from workspace`);
  } catch (error) {
    console.warn(`   Failed to create .npmrc:`, error);
  }
}

/**
 * Update package.json name field
 */
async function updatePackageName(projectPath: string, newName: string): Promise<void> {
  const pkgPath = join(projectPath, 'package.json');

  if (!existsSync(pkgPath)) {
    if (process.env.DEBUG_BUILD === '1') console.log(`   No package.json found in ${projectPath}, skipping name update`);
    return;
  }

  try {
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    pkg.name = newName;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));

    if (process.env.DEBUG_BUILD === '1') console.log(`   Updated package.json name to: ${newName}`);
  } catch (error) {
    console.warn(`   Failed to update package.json:`, error);
  }
}

/**
 * Remove hardcoded ports from dev scripts to allow dynamic port allocation
 * This ensures projects respect PORT environment variable instead of hardcoded values
 */
async function removeHardcodedPorts(projectPath: string): Promise<void> {
  const pkgPath = join(projectPath, 'package.json');

  if (!existsSync(pkgPath)) {
    return;
  }

  try {
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    if (!pkg.scripts) return;

    let modified = false;
    const scriptsToFix = ['dev', 'start', 'serve', 'preview'];

    for (const scriptName of scriptsToFix) {
      if (pkg.scripts[scriptName]) {
        const original = pkg.scripts[scriptName];
        // Remove hardcoded port patterns like --port 3000, -p 3000, --port=3000
        const fixed = original
          .replace(/\s+--port[=\s]+\d+/g, '')
          .replace(/\s+-p[=\s]+\d+/g, '')
          .replace(/\s+--host\s+[\d.]+/g, '')
          .replace(/\s+--strictPort/g, '')
          .trim();

        if (fixed !== original) {
          pkg.scripts[scriptName] = fixed;
          modified = true;
          if (process.env.DEBUG_BUILD === '1') {
            console.log(`   Removed hardcoded port from ${scriptName}: "${original}" → "${fixed}"`);
          }
        }
      }
    }

    if (modified) {
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      if (process.env.DEBUG_BUILD === '1') {
        console.log(`   ✅ Fixed hardcoded ports in package.json scripts`);
      }
    }
  } catch (error) {
    console.warn(`   Failed to fix hardcoded ports:`, error);
  }
}

/**
 * Ensure vite.config.ts/js has server config that respects PORT environment variable
 * This is needed for Vite-based frameworks (including TanStack Start) to use dynamic ports
 */
async function ensureVitePortConfig(projectPath: string): Promise<void> {
  const viteConfigTs = join(projectPath, 'vite.config.ts');
  const viteConfigJs = join(projectPath, 'vite.config.js');
  const viteConfigMts = join(projectPath, 'vite.config.mts');

  let configPath: string | null = null;
  if (existsSync(viteConfigTs)) configPath = viteConfigTs;
  else if (existsSync(viteConfigMts)) configPath = viteConfigMts;
  else if (existsSync(viteConfigJs)) configPath = viteConfigJs;

  if (!configPath) return;

  try {
    let content = await readFile(configPath, 'utf-8');

    // Check if server config already has port configuration
    if (content.includes('process.env.PORT') || content.includes('server:') && content.includes('port:')) {
      if (process.env.DEBUG_BUILD === '1') {
        console.log(`   vite.config already has port configuration, skipping`);
      }
      return;
    }

    // Look for existing server config and add port if missing
    const serverConfigRegex = /server:\s*\{([^}]*)\}/s;
    const match = content.match(serverConfigRegex);

    // Use port 3200 as fallback (end of our defined range 3101-3200)
    // This avoids conflicts with hatchway (3000) and is within our allocated range
    const fallbackPort = '3200';

    if (match) {
      // Server config exists, add port to it
      const existingConfig = match[1];
      const newServerConfig = `server: {
    port: parseInt(process.env.PORT || '${fallbackPort}'),
    host: '0.0.0.0',${existingConfig}
  }`;
      content = content.replace(serverConfigRegex, newServerConfig);
    } else {
      // No server config, add it before the closing of defineConfig
      // Look for the last } before export default or the end
      const defineConfigMatch = content.match(/(defineConfig\s*\(\s*\{)([\s\S]*?)(\}\s*\))/);
      if (defineConfigMatch) {
        const [fullMatch, start, middle, end] = defineConfigMatch;
        const serverConfig = `
  server: {
    port: parseInt(process.env.PORT || '${fallbackPort}'),
    host: '0.0.0.0',
  },`;
        // Add server config at the beginning of the config object
        content = content.replace(fullMatch, `${start}${serverConfig}${middle}${end}`);
      }
    }

    await writeFile(configPath, content);
    if (process.env.DEBUG_BUILD === '1') {
      console.log(`   ✅ Updated ${configPath.split('/').pop()} with PORT env var support`);
    }
  } catch (error) {
    console.warn(`   Failed to update vite config for PORT support:`, error);
  }
}

/**
 * Get project file tree (for AI context)
 * Shows directory structure to help AI understand what's included
 */
export async function getProjectFileTree(projectPath: string): Promise<string> {
  // Simplified version - just return the path
  // TODO: Implement tree generation without execAsync
  return `Project path: ${projectPath}`;
}

/**
 * Get summary of key files in template (for AI context)
 */
export async function getTemplateFileSummary(projectPath: string): Promise<string> {
  const keyFiles = [
    'package.json',
    'tsconfig.json',
    'README.md',
    'next.config.ts',
    'next.config.js',
    'vite.config.ts',
    'astro.config.mjs',
  ];

  const summary: string[] = [];

  for (const file of keyFiles) {
    const filePath = join(projectPath, file);
    if (existsSync(filePath)) {
      summary.push(file);
    }
  }

  // Check for key directories
  const keyDirs = ['app', 'src', 'components', 'pages', 'client', 'server'];
  for (const dir of keyDirs) {
    const dirPath = join(projectPath, dir);
    if (existsSync(dirPath)) {
      summary.push(`${dir}/`);
    }
  }

  return summary.join(', ');
}
