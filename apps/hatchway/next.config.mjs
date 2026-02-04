import {withSentryConfig} from "@sentry/nextjs";
import {fileURLToPath} from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for containerized deployments (Railway, Docker)
  output: 'standalone',
  // Disable Turbopack - PGlite WASM files don't resolve correctly with Turbopack
  turbopack: false,
  // Allow deployment even when TypeScript or ESLint report errors
  typescript: {
    ignoreBuildErrors: true,
  },
  outputFileTracingRoot: path.resolve(__dirname, "..", ".."),
  transpilePackages: ['@hatchway/agent-core'],
  // Reduce noise from frequent API endpoint calls
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  // Expose environment variables to client
  env: {
    NEXT_PUBLIC_LOCAL_MODE: process.env.HATCHWAY_LOCAL_MODE || 'false',
    // SDK feature flags - control which SDKs are available in the UI
    // By default, only Agent SDK (Claude + Codex) is enabled
    NEXT_PUBLIC_ENABLE_OPENCODE_SDK: process.env.ENABLE_OPENCODE_SDK || 'false',
    NEXT_PUBLIC_ENABLE_FACTORY_SDK: process.env.ENABLE_FACTORY_SDK || 'false',
  },
  webpack: (config) => {
    // Ensure @/lib/* resolves to ./src/lib/* within this app
    config.resolve.alias = {
      ...config.resolve.alias,
      '@/lib': path.resolve(__dirname, 'src/lib'),
      '@/shared': path.resolve(__dirname, 'src/shared'),
    };
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "buildwithcode",

  project: "hatchwayprojects",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  // Webpack-specific options (new location for deprecated options)
  webpack: {
    // Automatically tree-shake Sentry logger statements to reduce bundle size
    treeshake: {
      removeDebugLogging: true,
    },
    // Enables automatic instrumentation of Vercel Cron Monitors
    automaticVercelMonitors: true,
  },
});
