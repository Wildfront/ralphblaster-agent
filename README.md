# RalphBlaster Agent

RalphBlaster Agent is a distributed autonomous coding agent that polls a Rails API for jobs and executes them locally using Claude CLI.

# Requirements

  Compatibility range:
  - ✅ macOS 10.15+ (any recent version)
  - ✅ Linux (Ubuntu, Debian, RHEL, Fedora, Arch, etc.)
  - ✅ Works with different shells (bash, zsh, sh) since it doesn't rely on shell execution

  The only requirement is that users have Node.js 18+, Claude CLI, and Git installed - all of which are readily available on both platforms.

## Features

- 🔄 **Automatic Job Polling**: Continuously polls the RalphBlaster API for new coding jobs
- 🤖 **Claude CLI Integration**: Executes jobs using the Claude CLI
- 🚀 **Multi-Agent Support**: Run multiple agents concurrently for parallel job processing
- 💪 **Resilient**: Handles failures gracefully with automatic retries and timeouts
- 🔐 **Secure**: Uses API tokens with specific permissions for authentication
- 📊 **Real-time Updates**: Reports job progress and status back to the API
- ⚡ **Heartbeat System**: Keeps jobs alive during long-running executions

## Prerequisites

- Node.js >= 18.0.0
- Claude CLI installed and available in PATH (`claude --version` should work)
- A RalphBlaster API token with `ralphblaster_agent` permission

## Installation

### Global Installation

```bash
npm install -g ralphblaster
```

### Local Installation

```bash
git clone <repository>
cd ralphblaster-agent
npm install
```

### Using npx (No Installation Required)

```bash
npx ralphblaster --token=your_token_here
```

## Usage

### Basic Usage

```bash
# Single agent (default)
ralphblaster --token=your_api_token_here

# Using environment variable
RALPHBLASTER_API_TOKEN=your_api_token_here ralphblaster

# Local development (override API URL)
ralphblaster --token=your_token --api-url=http://localhost:5002
```

### Multi-Agent Mode (Parallel Processing)

Run multiple agents concurrently to process jobs in parallel:

```bash
# Run 3 agents for 3x throughput
ralphblaster --agents=3

# With npm
npm start -- --agents=3

# Or use convenience scripts
npm run start:multi      # 3 agents
npm run start:multi:5    # 5 agents

# Advanced: Use bash scripts for production
./scripts/start-agents.sh 3
./scripts/agent-status.sh
```

**Benefits:**
- 3x job processing throughput with 3 agents
- Process isolation - one crash doesn't affect others
- Full log traceability with agent IDs
- Easy to scale up/down

**See:** `MULTI_AGENT_USAGE.md` for complete guide

### Configuration Options

The agent can be configured via environment variables or command-line flags:

| Environment Variable | CLI Flag | Default | Description |
|---------------------|----------|---------|-------------|
| `RALPHBLASTER_API_TOKEN` | `--token=` | *Required* | API authentication token |
| `RALPHBLASTER_API_URL` | `--api-url=` | `https://ralphblaster.com` | RalphBlaster API base URL |
| `RALPHBLASTER_AGENT_ID` | `--agents=` | `agent-default` / `1` | Agent ID or agent count for multi-agent mode |
| `RALPHBLASTER_POLL_INTERVAL` | - | `5000` | Polling interval in milliseconds |
| `RALPHBLASTER_LOG_LEVEL` | - | `info` | Log level (error, warn, info, debug) |
| `RALPHBLASTER_MAX_RETRIES` | - | `3` | Maximum retry attempts |

### Using .env File

Create a `.env` file in the ralphblaster-agent directory:

```env
RALPHBLASTER_API_TOKEN=your_api_token_here
# RALPHBLASTER_API_URL=http://localhost:5002  # Uncomment for local development
RALPHBLASTER_POLL_INTERVAL=5000
RALPHBLASTER_LOG_LEVEL=info
```

Then run:

```bash
ralphblaster
```

## How It Works

1. **Polling**: The agent continuously polls the API endpoint `/api/v1/ralphblaster/jobs/next` for available jobs
2. **Job Claiming**: When a job is found, it's automatically claimed by the agent
3. **Status Update**: The agent marks the job as "running" and starts sending heartbeats
4. **Execution**: The job is executed based on its type:
   - **PRD Generation**: Uses Claude `/prd` skill or direct prompts
   - **Code Execution**: Creates a RalphBlaster agent instance (see below)
5. **Completion**: Results are parsed and reported back to the API
6. **Cleanup**: The agent marks the job as completed or failed and continues polling

### Agent Status System

The agent uses a heartbeat system to maintain connection status with the backend:

- **Heartbeat Interval**: 20 seconds (3 heartbeats per minute)
- **Offline Threshold**: 35 seconds (backend considers agent offline after this)
- **Safety Margin**: 15 seconds buffer to prevent false offline readings

This ensures the agent is always shown as "online" in the UI during normal operation, while still detecting real disconnections within 35-40 seconds. Status updates are broadcast in real-time via ActionCable WebSocket connections.

## RalphBlaster Agent Integration

For `code_execution` job types, the agent uses the RalphBlaster system - an iterative, PRD-driven execution framework that enables complex, multi-step implementations.

### How the Agent Works

1. **Poll for Jobs**: Agent continuously polls `/api/v1/ralphblaster/jobs/next` for available work
2. **Worktree Creation**: Creates an isolated git worktree for each job in `{repo}-worktrees/job-{id}/`
3. **Claude Execution**: Runs Claude CLI directly in the worktree with the server-provided prompt
4. **Progress Streaming**: Real-time output streamed to `.ralphblaster-logs/job-{id}.log` and sent to API
5. **Git Activity**: Commits are made in the worktree, then pushed to remote
6. **Completion**: Job status and results reported back to API via `/api/v1/ralphblaster/jobs/{id}`
7. **Cleanup**: Worktrees are automatically removed after job completion (configurable)

### Directory Structure

Worktrees are created as siblings to your project (not inside it) to prevent git conflicts:

```
my-project/                      # Your main repository
my-project-worktrees/            # Worktrees (sibling directory)
└── job-{id}/                    # Isolated worktree for each job
    └── [project files...]       # Isolated copy of project code
.ralphblaster-logs/              # Log files (persisted)
└── job-{id}.log                 # Agent execution log
└── job-{id}-stderr.log          # Error output (if any)
```

### Key Features

Agent directly executes Claude CLI with:

- `RALPHBLASTER_WORKTREE_PATH` - Path to the git worktree
- `RALPHBLASTER_INSTANCE_DIR` - Path to the RalphBlaster instance directory
- `RALPHBLASTER_MAIN_REPO` - Path to the main repository

### RalphBlaster Execution Limits

- **Max Iterations**: 10
- **Timeout**: 2 hours
- **Completion**: All user stories must pass quality checks

### Advantages of RalphBlaster Agent Integration

- **Structured Approach**: PRD-driven development ensures clear requirements
- **Quality Assurance**: Each story is validated with tests before proceeding
- **Progress Tracking**: Detailed logs of what was accomplished
- **Isolation**: Git worktrees keep work separate from main repository
- **Iterative Refinement**: Can fix issues and retry failed stories automatically

## API Token Setup

To create an API token with ralphblaster_agent permission:

1. Log into your RalphBlaster account
2. Navigate to API Tokens settings
3. Create a new token
4. Check the "RalphBlaster Agent Access" permission
5. Copy the token (shown only once!)

## Example Output

```
[2026-01-16T20:00:00.000Z] [INFO]
╔═══════════════════════════════════════╗
║   RalphBlaster Agent Starting...      ║
╚═══════════════════════════════════════╝

[2026-01-16T20:00:00.123Z] [INFO] RalphBlaster Agent starting...
[2026-01-16T20:00:00.124Z] [INFO] API URL: https://ralphblaster.com
[2026-01-16T20:00:00.125Z] [INFO] Poll interval: 5000ms
[2026-01-16T20:00:05.234Z] [INFO] Claimed job #42 - Implement user authentication
[2026-01-16T20:00:05.345Z] [INFO] Job #42 marked as running
[2026-01-16T20:00:05.456Z] [INFO] Executing job #42 in /path/to/project
[2026-01-16T20:05:30.789Z] [INFO] Job #42 marked as completed
[2026-01-16T20:05:30.890Z] [INFO] Job #42 completed successfully
```

## Graceful Shutdown

The agent handles shutdown signals gracefully:

- `SIGINT` (Ctrl+C): Marks current job as failed and exits
- `SIGTERM`: Same as SIGINT
- Uncaught exceptions: Logged and triggers shutdown

## Troubleshooting

### "API token requires 'ralphblaster_agent' permission"

Your API token doesn't have the correct permissions. Create a new token with the `ralphblaster_agent` permission checked.

### "Cannot connect to API"

Check that:
- The API URL is correct
- The Rails server is running
- There are no firewall issues

### "Failed to execute Claude CLI"

Ensure:
- Claude CLI is installed (`claude --version`)
- Claude CLI is in your PATH
- You're authenticated with Claude

### "Project path does not exist"

The project's `system_path` in RalphBlaster is incorrect or the directory doesn't exist on your machine.

## Development

### Running Locally

```bash
npm start
```

### Debugging

Enable debug logging:

```bash
RALPHBLASTER_LOG_LEVEL=debug ralphblaster --token=your_token
```

## Architecture

```
┌──────────────────────┐         ┌──────────────────┐
│  RalphBlaster Agent  │         │   Rails API      │
│                      │         │                  │
│  ┌──────────┐        │  Poll   │  ┌────────────┐  │
│  │  Polling │────────┼────────>│  │ Job Queue  │  │
│  │   Loop   │        │         │  └────────────┘  │
│  └──────────┘        │         │                  │
│       │              │  Claim  │                  │
│       ▼              │<────────┤                  │
│  ┌──────────┐        │         │                  │
│  │ Executor │        │         │                  │
│  │  (Claude)│        │ Status  │                  │
│  └──────────┘        │────────>│                  │
│                      │         │                  │
└──────────────────────┘         └──────────────────┘
```

## License

MIT
