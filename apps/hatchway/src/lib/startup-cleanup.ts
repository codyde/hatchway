import { markStaleProjectsAsFailed } from '@hatchway/agent-core/lib/stale-projects';

/**
 * Run cleanup tasks when the server starts
 */
export async function cleanupOrphanedProcesses() {
  try {
    console.log('🧹 Running startup cleanup...');
    const count = await markStaleProjectsAsFailed();
    console.log(`✅ Marked ${count} stale project(s) as failed on startup`);
  } catch (error) {
    console.error('❌ Startup cleanup failed:', error);
    // Don't throw - we don't want to prevent server startup
  }
}
