import * as Sentry from "@sentry/node";

// Debug logging for instrumentation (enabled via DEBUG_SENTRY=1)
const debugSentry = process.env.DEBUG_SENTRY === '1';
const log = (msg: string) => debugSentry && console.log(`[sentry-instrument] ${msg}`);

// Build integrations array
const integrations: unknown[] = [];

// Add http integration for request tracing
if (typeof Sentry.httpIntegration === "function") {
  integrations.push(Sentry.httpIntegration());
  log('Added httpIntegration');
}

log(`Total integrations configured: ${integrations.length}`);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  integrations: integrations as any[],
  tracesSampleRate: 1.0,
  debug: false,
  sendDefaultPii: false,
  // Configure trace propagation (Runner → Broker communication)
  tracePropagationTargets: [
    // Local development
    "localhost",
    "localhost:3000",
    "localhost:4000",
    /^https?:\/\/localhost:\d+$/,

    // Production domains
    "hatchway.sh",
    "hatchway.app",
    "hatchway.up.railway.app",
    "broker.hatchway.sh",
    "broker.hatchway.app",
    "broker.up.railway.app",

    // Wildcard patterns for Railway
    /^https?:\/\/.*\.railway\.app/, // Railway deployments
    /^https?:\/\/.*\.up\.railway\.app/, // Railway preview deployments
    /^https?:\/\/.*\.hatchway\.app/, // Custom domain subdomains
  ],
});
