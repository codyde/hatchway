import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Main entry points
    'index': 'src/index.ts',
    'client': 'src/client.ts',
    'server': 'src/server.ts',
    
    // Lib exports (for deep imports like @hatchway/agent-core/lib/agents)
    'lib/agents/index': 'src/lib/agents/index.ts',
    'lib/agents/codex/events': 'src/lib/agents/codex/events.ts',
    'lib/runner/broker-state': 'src/lib/runner/broker-state.ts',
    'lib/runner/event-stream': 'src/lib/runner/event-stream.ts',
    'lib/runner/log-store': 'src/lib/runner/log-store.ts',
    'lib/runner/persistent-event-processor': 'src/lib/runner/persistent-event-processor.ts',
    'lib/logging/build-logger': 'src/lib/logging/build-logger.ts',
    'lib/db/client': 'src/lib/db/client.ts',
    'lib/db/schema': 'src/lib/db/schema.ts',
    'lib/db/migrate': 'src/lib/db/migrate.ts',
    'lib/port-allocator': 'src/lib/port-allocator.ts',
    'lib/process-manager': 'src/lib/process-manager.ts',
    'lib/workspace': 'src/lib/workspace.ts',
    'lib/websocket/index': 'src/lib/websocket/index.ts',
    'lib/websocket/server': 'src/lib/websocket/server.ts',
    'lib/websocket/http-proxy-manager': 'src/lib/websocket/http-proxy-manager.ts',
    'lib/templates/config': 'src/lib/templates/config.ts',
    'lib/templates/config.server': 'src/lib/templates/config.server.ts',
    'lib/templates/downloader': 'src/lib/templates/downloader.ts',
    'lib/build/engine': 'src/lib/build/engine.ts',
    'lib/reconciliation': 'src/lib/reconciliation.ts',
    'lib/claude/tools': 'src/lib/claude/tools.ts',
    'lib/prompts': 'src/lib/prompts.ts',
    'lib/stale-projects': 'src/lib/stale-projects.ts',
    'lib/startup-cleanup': 'src/lib/startup-cleanup.ts',
    'lib/icon-mapper': 'src/lib/icon-mapper.ts',
    'lib/build-helpers': 'src/lib/build-helpers.ts',
    'lib/selection/injector': 'src/lib/selection/injector.ts',
    'lib/generation-persistence': 'src/lib/generation-persistence.ts',
    'lib/utils': 'src/lib/utils.ts',
    'lib/tags/resolver': 'src/lib/tags/resolver.ts',
    'lib/tags/model-parser': 'src/lib/tags/model-parser.ts',
    'lib/tags/serialization': 'src/lib/tags/serialization.ts',
    
    // Shared exports
    'shared/runner/messages': 'src/shared/runner/messages.ts',
    
    // Type exports
    'types/agent': 'src/types/agent.ts',
    'types/build': 'src/types/build.ts',
    'types/design': 'src/types/design.ts',
    'types/generation': 'src/types/generation.ts',
    'types/project': 'src/types/project.ts',
    'types/tags': 'src/types/tags.ts',
    
    // Config exports
    'config/tags': 'src/config/tags.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false, // Keep each entry as a separate file for cleaner imports
  
  // All dependencies are external - they'll be resolved at runtime
  external: [
    // Node.js built-ins (with node: prefix for ESM)
    /^node:/,
    
    // NPM dependencies
    '@anthropic-ai/claude-agent-sdk',
    '@sentry/node',
    'ai',
    'better-auth',
    'clsx',
    'drizzle-orm',
    'lucide-react',
    'pg',
    'server-only',
    'tailwind-merge',
    'ws',
    'zod',
  ],
  
  // Ensure we're outputting proper ESM
  esbuildOptions(options) {
    options.mainFields = ['module', 'main'];
  },
});
