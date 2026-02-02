# OpenBuilder

OpenBuilder is an AI-powered application builder that leverages Claude Code, OpenAI Codex, or OpenCode to generate and build projects. You can run it locally on your machine or connect a runner to the hosted SaaS version at [openbuilder.sh](https://openbuilder.sh).

## Quick Start

```bash
# Install the CLI
curl -fsSL https://openbuilder.sh/install | bash

# Launch the TUI
openbuilder
```

This opens an interactive TUI where you can choose:
- **Local Mode** - Run the full stack locally (web app + runner)
- **Runner Mode** - Connect to the hosted SaaS at openbuilder.sh

## Local Mode (Self-Hosted)

Run everything locally on your machine.

```bash
openbuilder
# Select "Local mode" from the TUI
```

This starts:
- **Web App** on `http://localhost:3000` (Next.js frontend)
- **Runner** to execute builds and manage dev servers

Open `http://localhost:3000` in your browser and start building!

## Runner Mode (Connect to SaaS)

Connect your local machine as a runner to the hosted OpenBuilder at [openbuilder.sh](https://openbuilder.sh).

```bash
# Connect to openbuilder.sh (opens browser for authentication)
openbuilder runner
```

This will:
1. Open your browser for authentication (GitHub or Sentry)
2. Automatically create a runner token
3. Connect your machine to openbuilder.sh

You can also use the interactive TUI:
```bash
openbuilder
# Select "Runner mode" from the menu
```

## AI Backends

OpenBuilder supports multiple AI backends for code generation.

### Claude Code (Default)

Uses the Claude Agent SDK with the same authentication as your local Claude CLI installation.

```bash
# Ensure Claude CLI is installed and authenticated
claude --version
```

Select your preferred Claude model using the `@model` tag in the web UI:
- `claude-haiku-4-5` (default, fastest)
- `claude-sonnet-4-5` (balanced)
- `claude-opus-4-5` (most capable)

### OpenAI Codex

Use OpenAI's Codex for code generation. Set your API key as an environment variable:

```bash
export OPENAI_API_KEY=your-api-key
```

Then select the `gpt-5.2-codex` model using the `@model` tag in the web UI.

### OpenCode (Model Agnostic)

[OpenCode](https://opencode.ai) is an open-source AI coding agent that supports **75+ LLM providers**, making it completely model agnostic. You can use:

- **Cloud providers**: Anthropic, OpenAI, Google Vertex AI, Amazon Bedrock, Azure, xAI, DeepSeek, Groq, Together AI, and many more
- **Local models**: Ollama, LM Studio, llama.cpp
- **OpenCode Zen**: Curated list of tested and verified models from the OpenCode team

OpenCode is configured at the **runner level** (not per-project). To use OpenCode:

```bash
# Install OpenCode
curl -fsSL https://opencode.ai/install | bash

# Start OpenCode in server mode (in a separate terminal)
opencode --server

# Set environment variables before starting your runner
export ENABLE_OPENCODE_SDK=true
export OPENCODE_URL=http://localhost:4096

# Then start OpenBuilder
openbuilder
```

When OpenCode is enabled, all AI requests are routed through your OpenCode server. Configure your preferred provider by running `/connect` in the OpenCode TUI. See the [OpenCode Providers documentation](https://opencode.ai/docs/providers/) for the full list of 75+ supported providers.

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **npm or pnpm** - Package manager
- **macOS, Linux, or WSL** - Windows users should use WSL
- **AI Backend** - Claude Code, OpenAI API key, or OpenCode (supports 75+ providers)

Verify your setup:
```bash
node --version  # Should be 18.0.0 or higher
```

## How It Works

1. **You describe what you want** - Enter a prompt like "Create a React app with a todo list"
2. **AI generates the code** - Your configured AI backend (Claude, Codex, or OpenCode) builds the application
3. **Preview instantly** - The runner starts a dev server and creates a preview URL via Cloudflare tunnel
4. **Iterate** - Continue refining with follow-up prompts

### Configuration Tags

Use the tag selector in the web UI to configure your build:

| Tag | Description | Options |
|-----|-------------|---------|
| `@model` | AI model to use | `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-opus-4-5`, `gpt-5.2-codex` |
| `@framework` | Project framework | Next.js, Vite, Astro, TanStack |
| `@runner` | Which runner to use | Your connected runners |
| `@brand` | Design theme | Sentry, Stripe, Vercel, and more |

## CLI Commands

| Command | Description |
|---------|-------------|
| `openbuilder` | Launch TUI to choose local or runner mode |
| `openbuilder runner` | Connect to openbuilder.sh (auto-login via browser) |
| `openbuilder login` | Authenticate with openbuilder.sh |
| `openbuilder run` | Start local mode directly |
| `openbuilder init` | Interactive setup wizard |
| `openbuilder upgrade` | Upgrade CLI and app installation |
| `openbuilder status` | Show runner status and configuration |
| `openbuilder config list` | View all configuration |
| `openbuilder cleanup --all` | Clean up all projects |

## Configuration

Configuration is stored at:
- **macOS**: `~/Library/Application Support/openbuilder/config.json`
- **Linux**: `~/.config/openbuilder/config.json`

Override settings with command-line flags:
```bash
openbuilder runner \
  --workspace ~/my-projects \
  --runner-id my-runner
```

## Project Structure

Generated projects are saved to your workspace directory (default: `~/openbuilder-workspace/`):

```
~/openbuilder-workspace/
├── react-todo-app/
│   ├── package.json
│   ├── src/
│   └── ...
├── nextjs-blog/
└── vite-portfolio/
```

## Troubleshooting

### CLI not found after install
Restart your terminal or run:
```bash
source ~/.bashrc  # or ~/.zshrc
```

### Cannot connect to server
Check your internet connection and runner key:
```bash
openbuilder status
```

### Build fails
Ensure you have all prerequisites installed:
```bash
node --version
git --version
claude --version  # If using Claude Code
```

### Reset everything
```bash
openbuilder config reset
openbuilder cleanup --all
openbuilder init
```

## Development

For detailed development instructions, see the [CLI README](apps/runner/README.md).

### Run from source

```bash
# Clone the repo
git clone https://github.com/codyde/openbuilder.git
cd openbuilder

# Install dependencies
pnpm install

# Start development
pnpm run dev
```

## Architecture

```
┌─────────────────┐                    ┌────────────┐
│    Web App      │◀──── WebSocket ───▶│   Runner   │
│  (Next.js UI)   │                    │ (CLI/Node) │
└─────────────────┘                    └────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │    AI Backend    │
                                    │ (Claude/Codex/   │
                                    │    OpenCode)     │
                                    └──────────────────┘
```

- **Web App**: Next.js frontend for creating and managing projects
- **Runner**: Executes builds, manages dev servers, creates tunnels for previews
- **AI Backend**: Generates code based on your prompts (Claude Code, Codex, or OpenCode with 75+ provider options)

## License

MIT
