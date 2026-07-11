import {fileURLToPath} from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for containerized deployments (Railway, Docker)
  output: 'standalone',
  // NOTE: This app builds with webpack (not Turbopack), selected via the
  // `--webpack` flag on next build/dev/start, because of the webpack() resolve
  // alias config below. Migrating those aliases to `turbopack.resolveAlias`
  // would let this run on Turbopack (the Next 16 default).
  outputFileTracingRoot: path.resolve(__dirname, "..", ".."),
  transpilePackages: ['@hatchway/agent-core'],
  // Keep the Railway SDK (and its tsx/esbuild IaC deps) out of the webpack
  // bundle — it's used only server-side (sandbox manager) and is required at
  // runtime from node_modules.
  serverExternalPackages: ['railway'],
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

export default nextConfig;
