# Hatchway CLI

The Hatchway CLI connects your local machine to [Hatchway](https://hatchway.sh) to build AI-powered applications. It handles code generation, dev servers, and live previews - all running on your machine.

## Quick Start

```bash
# Run directly with npx (no install needed)
npx @hatchway/cli runner

# Or install globally
npm install -g @hatchway/cli
hatchway runner
```

That's it! The CLI will:
1. Open your browser to authenticate (GitHub or Sentry SSO)
2. Automatically generate and store your runner token
3. Connect to hatchway.sh and start listening for builds

## Installation Options

### npx (Recommended)
No installation needed - always uses the latest version:
```bash
npx @hatchway/cli runner
```

### Global Install
```bash
npm install -g @hatchway/cli
hatchway runner
```

### Curl Install Script
```bash
curl -fsSL https://hatchway.sh/install | bash
hatchway runner
```

## Usage

### Connect to Hatchway SaaS

```bash
# Start the runner (auto-authenticates via browser)
npx @hatchway/cli runner

# Or if installed globally
hatchway runner
```

On first run, your browser will open for authentication. After logging in, the CLI automatically:
- Creates a secure runner token
- Stores it locally for future sessions
- Connects to hatchway.sh

### Interactive TUI Mode

```bash
npx @hatchway/cli
# or
hatchway
```

This opens an interactive menu where you can:
- **Runner Mode** - Connect to hatchway.sh (SaaS)
- **Local Mode** - Run everything locally (self-hosted)

### Local Mode (Self-Hosted)

Run the entire Hatchway stack locally:

```bash
hatchway run
```

This starts:
- Web App on `http://localhost:3000`
- Runner connected to local web app

## Keyboard Shortcuts

When the runner is connected, use these shortcuts:

| Key | Action |
|-----|--------|
| `b` | Open Hatchway in browser |
| `r` | Restart runner connection |
| `q` | Quit the runner |

## Configuration

Configuration is stored at:
- **macOS**: `~/Library/Application Support/hatchway/config.json`
- **Linux**: `~/.config/hatchway/config.json`

### View Configuration

```bash
hatchway status
hatchway config list
```

### Change Workspace

Projects are stored in `~/hatchway-projects/` by default:

```bash
hatchway config set workspace ~/my-projects
```

### CLI Options

Override settings via command-line:

```bash
hatchway runner \
  --workspace ~/custom-projects \
  --runner-id my-macbook
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `hatchway` | Launch interactive TUI |
| `hatchway runner` | Connect to hatchway.sh |
| `hatchway run` | Start local mode (self-hosted) |
| `hatchway login` | Authenticate with hatchway.sh |
| `hatchway logout` | Clear stored credentials |
| `hatchway status` | Show runner status |
| `hatchway config list` | View all settings |
| `hatchway config set <key> <value>` | Update a setting |
| `hatchway config reset` | Reset to defaults |
| `hatchway cleanup --all` | Remove all projects |
| `hatchway upgrade` | Upgrade to latest version |

## How It Works

```
┌─────────────────────┐         ┌─────────────────┐
│   hatchway.sh     │◀──────▶│   Runner CLI    │
│   (Web Interface)   │  WSS   │ (Your Machine)  │
└─────────────────────┘         └────────┬────────┘
                                         │
                                         ▼
                                ┌─────────────────┐
                                │   AI Backend    │
                                │ (Claude Code)   │
                                └─────────────────┘
```

1. You create a project at hatchway.sh
2. The web app sends build commands to your runner via WebSocket
3. Your runner executes the AI agent (Claude Code) locally
4. Generated code is saved to your workspace
5. Runner starts dev server and creates a Cloudflare tunnel for preview

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Claude CLI** - For AI code generation
  ```bash
  # Install Claude CLI
  npm install -g @anthropic-ai/claude-cli
  claude auth login
  ```

## Troubleshooting

### "Runner not authenticated"

The OAuth flow didn't complete. Try:
```bash
hatchway login
```

### "Cannot connect to server"

Check your internet connection and runner status:
```bash
hatchway status
```

### Browser doesn't open for auth

Manually visit the URL shown in the terminal, or:
```bash
hatchway login
```

### Projects not appearing

Ensure you're connected to the same account:
```bash
hatchway status  # Shows connected account
```

### Reset everything

```bash
hatchway logout
hatchway config reset
hatchway cleanup --all
hatchway runner  # Re-authenticate
```

## FAQ

**Q: Do I need an API key?**
A: No! Authentication is handled via OAuth (GitHub or Sentry SSO). The CLI automatically manages tokens.

**Q: Where are my projects stored?**
A: In `~/hatchway-projects/` by default. Check with `hatchway config get workspace`.

**Q: Can I run multiple runners?**
A: Yes! Each runner gets a unique ID. Run on different machines or use `--runner-id`:
```bash
hatchway runner --runner-id work-laptop
hatchway runner --runner-id home-desktop
```

**Q: Does the runner need to stay running?**
A: Yes, while you're using hatchway.sh. It executes builds and serves previews.

**Q: Can I use a different AI model?**
A: Yes! Select your preferred Claude model using the `@model` tag in the web UI:
- `claude-haiku-4-5` (fast)
- `claude-sonnet-4-5` (balanced)
- `claude-opus-4-5` (most capable)

**Q: How do I update the CLI?**
A:
```bash
# If using npx, it auto-updates
npx @hatchway/cli runner

# If installed globally
npm update -g @hatchway/cli
# or
hatchway upgrade
```

**Q: How do I uninstall?**
A:
```bash
hatchway cleanup --all
npm uninstall -g @hatchway/cli
rm -rf ~/Library/Application\ Support/hatchway  # macOS
rm -rf ~/.config/hatchway  # Linux
```

## Development

See the main [Hatchway repository](https://github.com/codyde/hatchway) for development instructions.

```bash
# Clone and setup
git clone https://github.com/codyde/hatchway.git
cd hatchway
pnpm install

# Build the CLI
cd apps/runner
pnpm run build

# Test locally
node dist/cli/index.js runner
```

## License

MIT
