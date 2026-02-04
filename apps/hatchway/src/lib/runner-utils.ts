import { listRunnerConnections, isRunnerConnected } from '@hatchway/agent-core/lib/runner/broker-state';

/**
 * Check if a specific runner is connected
 * @param runnerId - The runner ID to check
 * @returns true if connected, false otherwise
 */
export async function checkRunnerConnected(runnerId: string | null): Promise<boolean> {
  if (!runnerId) return false;
  return await isRunnerConnected(runnerId);
}

/**
 * Enrich a project with runner connection status
 * Adds `runnerConnected` field to the project
 */
export async function enrichProjectWithRunnerStatus<T extends { runnerId: string | null }>(
  project: T
): Promise<T & { runnerConnected: boolean }> {
  const runnerConnected = await checkRunnerConnected(project.runnerId);
  console.log(`[enrichProjectWithRunnerStatus] Project runnerId: '${project.runnerId}', connected: ${runnerConnected}`);
  return { ...project, runnerConnected };
}

/**
 * Enrich multiple projects with runner connection status
 * More efficient than calling enrichProjectWithRunnerStatus for each project
 */
export async function enrichProjectsWithRunnerStatus<T extends { runnerId: string | null }>(
  projectsList: T[]
): Promise<(T & { runnerConnected: boolean })[]> {
  // Get all connected runners once
  const connections = await listRunnerConnections();
  const connectedRunnerIds = new Set(connections.map(c => c.runnerId));
  
  // Enrich each project
  return projectsList.map(project => ({
    ...project,
    runnerConnected: project.runnerId ? connectedRunnerIds.has(project.runnerId) : false,
  }));
}

/**
 * Get the runner ID for a project - NO FALLBACK.
 * If the project has a saved runnerId, that specific runner must be connected.
 * If the project has no runnerId (new project), uses the first available runner.
 *
 * @param preferredRunnerId - The project's saved runner ID (from project.runnerId)
 * @returns The runner ID if available, or null if the required runner is not connected
 */
export async function getProjectRunnerId(preferredRunnerId: string | null): Promise<string | null> {
  const connections = await listRunnerConnections();

  console.log('🔍 [getProjectRunnerId] Connections:', connections);
  console.log('🔍 [getProjectRunnerId] Project runner:', preferredRunnerId);

  if (connections.length === 0) {
    console.warn('⚠️  [getProjectRunnerId] No runners connected');
    return null;
  }

  // If project has a saved runnerId, that specific runner MUST be connected
  // No fallback - the project is tied to its runner
  if (preferredRunnerId) {
    const projectRunner = connections.find(conn => conn.runnerId === preferredRunnerId);
    if (projectRunner) {
      console.log(`✅ [getProjectRunnerId] Project runner connected: ${projectRunner.runnerId}`);
      return projectRunner.runnerId;
    }
    // Project's runner is not connected - return null (no fallback)
    console.warn(`⚠️  [getProjectRunnerId] Project runner '${preferredRunnerId}' is not connected`);
    return null;
  }

  // No saved runnerId (new project) - use first available runner
  console.log(`✅ [getProjectRunnerId] New project, using runner: ${connections[0].runnerId}`);
  return connections[0].runnerId;
}
