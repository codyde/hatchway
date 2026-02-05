// This file is used for Next.js instrumentation
// It runs once when the server starts
import * as Sentry from '@sentry/nextjs';
import { cleanupOrphanedProcesses } from './src/lib/startup-cleanup';

export async function register() {
  // Disable AI SDK warnings globally
  process.env.AI_SDK_LOG_WARNINGS = 'false';

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Load Sentry FIRST before any other initialization
    await import('./sentry.server.config');
    console.log('[instrumentation] ✅ Sentry server initialized');
    
    // Initialize database BEFORE any database-dependent code
    try {
      const { initializeDatabase } = await import('@hatchway/agent-core');
      await initializeDatabase();
      console.log('[instrumentation] ✅ Database initialized');
      
      // In local mode, ensure the local user exists for foreign key constraints
      if (process.env.HATCHWAY_LOCAL_MODE === 'true') {
        const { ensureLocalUserExists } = await import('./src/lib/auth-helpers');
        await ensureLocalUserExists();
        console.log('[instrumentation] ✅ Local user ensured');
      }
    } catch (error) {
      console.error('[instrumentation] ❌ Failed to initialize database:', error);
      throw error; // Fail fast - database is required
    }
    
    // Run cleanup on server startup
    await cleanupOrphanedProcesses();
    
    // Clean up abandoned port allocations on server startup
    try {
      const { cleanupAbandonedPorts } = await import('@hatchway/agent-core/lib/port-allocator');
      await cleanupAbandonedPorts();
      console.log('[instrumentation] ✅ Cleaned up abandoned port allocations');
    } catch (error) {
      console.error('[instrumentation] Failed to cleanup abandoned ports:', error);
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
  
  // Client-side Sentry is loaded automatically by Next.js from sentry.client.config.ts
}

export const onRequestError = Sentry.captureRequestError;
