import { rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { prompts } from '../utils/prompts.js';
import { configManager } from '../utils/config-manager.js';
import { spinner } from '../utils/spinner.js';

interface CleanupOptions {
  project?: string;
  all?: boolean;
  tunnels?: boolean;
  processes?: boolean;
}

export async function cleanupCommand(options: CleanupOptions) {
  const config = configManager.get();
  const workspace = config.workspace;

  if (!workspace || !existsSync(workspace)) {
    logger.error('Workspace not found');
    logger.info(`Expected: ${workspace}`);
    return;
  }

  // Handle specific cleanup actions
  if (options.project) {
    await cleanupProject(workspace, options.project);
    return;
  }

  if (options.all) {
    await cleanupAllProjects(workspace);
    return;
  }

  if (options.tunnels) {
    logger.warn('Tunnel cleanup requires the runner to be running');
    logger.info('Tunnels are managed by the active runner process');
    return;
  }

  if (options.processes) {
    logger.warn('Process cleanup requires the runner to be running');
    logger.info('Dev servers are managed by the active runner process');
    return;
  }

  // No specific action - show help
  logger.info('Cleanup options:');
  logger.log(`  ${chalk.cyan('--project <slug>')}  Delete specific project`);
  logger.log(`  ${chalk.cyan('--all')}             Delete all projects`);
  logger.log(`  ${chalk.cyan('--tunnels')}         Close all tunnels (requires running runner)`);
  logger.log(`  ${chalk.cyan('--processes')}       Kill all dev servers (requires running runner)`);
  logger.log('');
  logger.info('Examples:');
  logger.log(`  hatchway cleanup --project my-project`);
  logger.log(`  hatchway cleanup --all`);
}

async function cleanupProject(workspace: string, slug: string) {
  const projectPath = join(workspace, slug);

  if (!existsSync(projectPath)) {
    logger.error(`Project not found: ${slug}`);
    return;
  }

  // Get project size
  let size = 'unknown';
  try {
    const stats = await stat(projectPath);
    if (stats.isDirectory()) {
      // Estimate size (this is approximate)
      size = `${Math.round(stats.size / 1024)}KB+`;
    }
  } catch {
    // Ignore size calculation errors
  }

  logger.warn(`This will permanently delete project: ${chalk.cyan(slug)}`);
  logger.log(`Path: ${projectPath}`);
  logger.log(`Size: ${size}`);
  logger.log('');

  const confirmed = await prompts.confirm('Are you sure?', false);

  if (!confirmed) {
    logger.info('Cleanup cancelled');
    return;
  }

  spinner.start(`Deleting project: ${slug}`);

  try {
    await rm(projectPath, { recursive: true, force: true, maxRetries: 3 });
    spinner.succeed(`Deleted project: ${chalk.cyan(slug)}`);
  } catch (error) {
    spinner.fail('Failed to delete project');
    logger.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function cleanupAllProjects(workspace: string) {
  logger.warn(`This will permanently delete ALL projects in workspace`);
  logger.log(`Workspace: ${workspace}`);
  logger.log('');

  // List projects
  const entries = await readdir(workspace);
  const projects = [];

  for (const entry of entries) {
    const entryPath = join(workspace, entry);
    const stats = await stat(entryPath);
    if (stats.isDirectory()) {
      projects.push(entry);
    }
  }

  if (projects.length === 0) {
    logger.info('No projects found to delete');
    return;
  }

  logger.log(`Found ${projects.length} project(s):`);
  projects.forEach(p => logger.log(`  - ${p}`));
  logger.log('');

  const confirmed = await prompts.confirm(
    `Delete all ${projects.length} projects?`,
    false
  );

  if (!confirmed) {
    logger.info('Cleanup cancelled');
    return;
  }

  spinner.start(`Deleting ${projects.length} projects...`);

  let deleted = 0;
  const errors: string[] = [];

  for (const project of projects) {
    try {
      await rm(join(workspace, project), { recursive: true, force: true, maxRetries: 3 });
      deleted++;
    } catch (error) {
      errors.push(`${project}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  if (errors.length === 0) {
    spinner.succeed(`Deleted ${deleted} projects`);
  } else {
    spinner.warn(`Deleted ${deleted}/${projects.length} projects`);
    logger.log('');
    logger.error('Errors:');
    errors.forEach(err => logger.error(`  ${err}`));
  }
}
