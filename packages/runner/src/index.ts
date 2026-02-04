/**
 * @hatchway/runner - Lightweight runner package
 *
 * This package bundles the runner functionality from @hatchway/cli
 * for a smaller package size when you only need the runner.
 */

// Re-export the startRunner function and types from the CLI source
// These imports are resolved by the alias plugin at build time
export { startRunner } from '@hatchway/cli/index';
export type { RunnerOptions } from '@hatchway/cli/index';

// Re-export runner command for CLI usage
export { runCommand } from '@hatchway/cli/cli/commands/run';

// Re-export TUI components
export { RunnerDashboard } from '@hatchway/cli/cli/tui/screens/RunnerDashboard';

// Re-export auth utilities
export {
  performOAuthLogin,
  hasStoredToken,
  getStoredToken,
  storeToken,
  clearToken,
  validateToken,
} from '@hatchway/cli/cli/utils/cli-auth';

// Re-export config manager
export {
  configManager,
  type RunnerConfig,
} from '@hatchway/cli/cli/utils/config-manager';
