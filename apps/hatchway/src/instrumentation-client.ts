// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Add optional integrations for additional features
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      maskAllInputs: false,
    }),
  ],

  // Sample all traces
  tracesSampleRate: 1.0,
  
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Replay sampling
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,

  // Debug mode for testing
  debug: false,

  tracePropagationTargets: [
    'localhost',
    /^\/api\//,
    /^https?:\/\/localhost:\d+$/,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

// Log client-side Sentry initialization
console.log('✅ [Sentry Client] Initialized');
console.log('   DSN:', Sentry.getClient()?.getDsn()?.toString());
console.log('   Metrics API available:', typeof Sentry.metrics !== 'undefined');
console.log('   Client exists:', !!Sentry.getClient());


