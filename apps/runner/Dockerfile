# Railway-optimized Dockerfile for Hatchway CLI
FROM node:20-slim

# Install pnpm and Claude Code CLI globally
RUN npm install -g pnpm@9.15.0 @anthropic-ai/claude-code@latest

# Initialize Claude Code CLI (create config directory)
RUN mkdir -p /root/.claude && \
    echo '{"telemetry": false}' > /root/.claude/config.json

# Install system dependencies: git (for template cloning) and cloudflared (for tunnels)
RUN apt-get update && apt-get install -y \
    git \
    wget \
    ca-certificates \
    && wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    && dpkg -i cloudflared-linux-amd64.deb \
    && rm cloudflared-linux-amd64.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and base tsconfig
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all package.json and tsconfig files
COPY apps/runner/package.json apps/runner/tsconfig.json ./apps/runner/
COPY packages/agent-core/package.json packages/agent-core/tsconfig.json ./packages/agent-core/

# Copy vendor files (required by package.json file: dependencies)
COPY apps/runner/vendor ./apps/runner/vendor
COPY apps/hatchway/vendor ./apps/hatchway/vendor

# Copy source code (needed before install due to prepare scripts)
COPY apps/runner/src ./apps/runner/src
COPY apps/runner/templates.json ./apps/runner/
COPY apps/runner/scripts ./apps/runner/scripts
COPY packages/agent-core/src ./packages/agent-core/src

# Install dependencies (will run prepare scripts that build agent-core)
RUN pnpm install --frozen-lockfile

# Build runner (agent-core already built by prepare script)
RUN pnpm --filter @hatchway/cli build

# Create workspace directory (will be mounted as volume in Railway)
RUN mkdir -p /data/workspace

# Expose health check port
EXPOSE 8080

# Set environment defaults
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/data/workspace
ENV HEALTH_PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start runner in service mode
CMD ["node", "apps/runner/dist/index.js", "runner"]
