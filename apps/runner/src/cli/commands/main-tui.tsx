/**
 * Main TUI entry point - shown when running `hatchway` without arguments
 * Implements a multi-screen flow: Mode Select -> Local/Runner Mode -> Config/Start
 */

import { useState } from 'react';
import { render } from 'ink';
import { userInfo } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ModeSelectScreen,
  LocalModeScreen,
  RunnerModeScreen,
  ConfigFormScreen,
  type ModeSelection,
  type LocalAction,
  type RunnerConfig,
  type InitFormConfig,
} from '../tui/screens/index.js';
import { configManager } from '../utils/config-manager.js';

/**
 * Screen state machine types
 */
type Screen =
  | { type: 'mode-select' }
  | { type: 'local-mode' }
  | { type: 'runner-mode' }
  | { type: 'config-form'; error?: string; lastBranch?: string };

interface AppState {
  screen: Screen;
  isInitialized: boolean;
  existingKey: string;
  existingRunnerId: string;
  existingWorkspace: string;
}

/**
 * Main TUI App component with screen navigation
 */
function App({ 
  initialState, 
  onExit, 
  onRunnerStart, 
  onLocalStart, 
  onInitStart,
}: {
  initialState: AppState;
  onExit: () => void;
  onRunnerStart: (config: RunnerConfig) => void;
  onLocalStart: () => void;
  onInitStart: (config: InitFormConfig) => void;
}) {
  const [state, setState] = useState<AppState>(initialState);

  // Screen navigation handlers
  const navigateTo = (screen: Screen) => {
    setState(prev => ({ ...prev, screen }));
  };
  
  // Navigate back to config form with error
  const navigateToConfigWithError = (error: string, lastBranch: string) => {
    setState(prev => ({ 
      ...prev, 
      screen: { type: 'config-form', error, lastBranch } 
    }));
  };

  // Mode Select handlers
  const handleModeSelect = (mode: ModeSelection) => {
    if (mode === 'local') {
      navigateTo({ type: 'local-mode' });
    } else {
      navigateTo({ type: 'runner-mode' });
    }
  };

  // Local Mode handlers
  const handleLocalAction = (action: LocalAction) => {
    if (action === 'init') {
      navigateTo({ type: 'config-form' });
    } else if (action === 'start') {
      onLocalStart();
    }
  };

  // Runner Mode handler
  const handleRunnerStart = (config: RunnerConfig) => {
    onRunnerStart(config);
  };

  // Config Form handler - validates branch before proceeding
  const handleConfigSubmit = async (config: InitFormConfig) => {
    // Skip validation if using main branch (always exists)
    if (config.branch === 'main') {
      onInitStart(config);
      return;
    }
    
    // Validate branch exists before proceeding
    const { execSync } = await import('child_process');
    try {
      execSync(
        `git ls-remote --exit-code --heads https://github.com/codyde/hatchway.git ${config.branch}`,
        { stdio: 'pipe' }
      );
      // Branch exists, proceed with init
      onInitStart(config);
    } catch {
      // Branch doesn't exist, show error
      navigateToConfigWithError(
        `Branch "${config.branch}" not found`,
        config.branch
      );
    }
  };

  // Render current screen
  switch (state.screen.type) {
    case 'mode-select':
      return (
        <ModeSelectScreen
          onSelect={handleModeSelect}
          onEscape={onExit}
        />
      );

    case 'local-mode':
      return (
        <LocalModeScreen
          isInitialized={state.isInitialized}
          onSelect={handleLocalAction}
          onEscape={() => navigateTo({ type: 'mode-select' })}
        />
      );

    case 'runner-mode':
      return (
        <RunnerModeScreen
          initialKey={state.existingKey}
          initialRunnerId={state.existingRunnerId}
          onStart={handleRunnerStart}
          onEscape={() => navigateTo({ type: 'mode-select' })}
        />
      );

    case 'config-form':
      return (
        <ConfigFormScreen
          initialConfig={{
            branch: state.screen.lastBranch || 'main',
            workspace: state.existingWorkspace || join(homedir(), 'hatchway-workspace'),
            useNeon: true,
          }}
          onSubmit={handleConfigSubmit}
          onEscape={() => navigateTo({ type: 'local-mode' })}
          error={state.screen.error}
        />
      );

    default:
      return null;
  }
}

/**
 * Get system username for default runner ID
 */
function getSystemUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || 'runner';
  }
}

/**
 * Run the main TUI menu
 */
export async function mainTUICommand(): Promise<void> {
  // Clear screen for fullscreen experience
  console.clear();

  const isInitialized = configManager.isInitialized();
  const existingKey = configManager.getSecret() || '';
  const config = configManager.get();
  // Use lastRunnerId if available, otherwise fall back to system username
  const existingRunnerId = config.runner?.lastRunnerId || getSystemUsername();
  const existingWorkspace = config.workspace || '';

  const initialState: AppState = {
    screen: { type: 'mode-select' },
    isInitialized,
    existingKey,
    existingRunnerId,
    existingWorkspace,
  };

  return new Promise((resolve, reject) => {
    let exitReason: 'exit' | 'runner-start' | 'local-start' | 'init-start' | null = null;
    let runnerConfig: RunnerConfig | null = null;
    let initConfig: InitFormConfig | null = null;

    const { unmount, waitUntilExit } = render(
      <App
        initialState={initialState}
        onExit={() => {
          exitReason = 'exit';
          unmount();
        }}
        onRunnerStart={(config) => {
          exitReason = 'runner-start';
          runnerConfig = config;
          unmount();
        }}
        onLocalStart={() => {
          exitReason = 'local-start';
          unmount();
        }}
        onInitStart={(config) => {
          exitReason = 'init-start';
          initConfig = config;
          unmount();
        }}
      />,
      {
        exitOnCtrlC: true,
      }
    );

    waitUntilExit().then(async () => {
      if (!exitReason) {
        // User pressed Ctrl+C
        console.clear();
        process.exit(0);
      }

      switch (exitReason) {
        case 'exit':
          console.clear();
          console.log('\n  Goodbye!\n');
          process.exit(0);
          break;

        case 'runner-start':
          if (runnerConfig) {
            console.clear();
            await startRunner(runnerConfig);
          }
          break;

        case 'local-start':
          console.clear();
          await startLocalMode();
          break;

        case 'init-start':
          if (initConfig) {
            // Clear screen with ANSI codes to ensure clean slate
            process.stdout.write('\x1b[2J\x1b[H');
            await runInitialization(initConfig);
          }
          break;
      }

      resolve();
    }).catch(reject);
  });
}

/**
 * Start runner mode (connects to remote server)
 */
async function startRunner(config: RunnerConfig): Promise<void> {
  // Save the key to config for future use
  if (config.key) {
    const serverConfig = configManager.get('server') || {};
    configManager.set('server', {
      ...serverConfig,
      secret: config.key,
    });
  }

  // Save the runner ID to config for future use
  if (config.runnerId) {
    const runnerConf = configManager.get('runner') || {};
    configManager.set('runner', {
      ...runnerConf,
      lastRunnerId: config.runnerId,
    });
  }

  console.log('\n  Starting Hatchway Runner...\n');
  console.log(`  Runner ID: ${config.runnerId}`);
  console.log('  Connecting to remote server...\n');

  const { runCommand } = await import('./run.js');
  await runCommand({
    secret: config.key,
    runnerId: config.runnerId,
  });
}

/**
 * Start local mode (full stack)
 */
async function startLocalMode(): Promise<void> {
  console.log('\n  Starting Hatchway in Local Mode...\n');

  const { startCommand } = await import('./start.js');
  await startCommand({});
}

/**
 * Run initialization with form config
 */
async function runInitialization(config: InitFormConfig): Promise<void> {
  // Expand ~ in workspace path
  const workspace = config.workspace.startsWith('~')
    ? config.workspace.replace('~', homedir())
    : config.workspace;

  const { initTUICommand } = await import('./init-tui.js');
  
  // Build options based on form input
  const options: {
    workspace: string;
    branch: string;
    database?: string | boolean;
    yes: boolean;
  } = {
    workspace,
    branch: config.branch,
    yes: true,
  };

  // Handle database option
  if (config.useNeon) {
    options.database = true; // Use Neon auto-setup
  } else if (config.databaseUrl) {
    options.database = config.databaseUrl; // Custom connection string
  }

  await initTUICommand(options);
}
