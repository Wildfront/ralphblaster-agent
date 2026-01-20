# Ralph Agent

Ralph Agent is a distributed autonomous coding agent that polls a Rails API for jobs and executes them locally using Claude CLI.

## Features

- 🔄 **Automatic Job Polling**: Continuously polls the Ralph API for new coding jobs
- 🤖 **Claude CLI Integration**: Executes jobs using the Claude CLI
- 💪 **Resilient**: Handles failures gracefully with automatic retries and timeouts
- 🔐 **Secure**: Uses API tokens with specific permissions for authentication
- 📊 **Real-time Updates**: Reports job progress and status back to the API
- ⚡ **Heartbeat System**: Keeps jobs alive during long-running executions

## Prerequisites

- Node.js >= 18.0.0
- Claude CLI installed and available in PATH (`claude --version` should work)
- A Ralph API token with `ralph_agent` permission

## Installation

### Global Installation

```bash
npm install -g ralph-agent
```

### Local Installation

```bash
git clone <repository>
cd ralph-agent
npm install
```

### Using npx (No Installation Required)

```bash
npx ralph-agent --token=your_token_here
```

## Usage

### Basic Usage

```bash
# Production (default)
ralph-agent --token=your_api_token_here

# Using environment variable
RALPH_API_TOKEN=your_api_token_here ralph-agent

# Local development (override API URL)
ralph-agent --token=your_token --api-url=http://localhost:5002
```

### Configuration Options

The agent can be configured via environment variables or command-line flags:

| Environment Variable | CLI Flag | Default | Description |
|---------------------|----------|---------|-------------|
| `RALPH_API_TOKEN` | `--token=` | *Required* | API authentication token |
| `RALPH_API_URL` | `--api-url=` | `https://ralphblaster.com` | Ralph API base URL |
| `RALPH_POLL_INTERVAL` | - | `5000` | Polling interval in milliseconds |
| `RALPH_LOG_LEVEL` | - | `info` | Log level (error, warn, info, debug) |
| `RALPH_MAX_RETRIES` | - | `3` | Maximum retry attempts |

### Using .env File

Create a `.env` file in the ralph-agent directory:

```env
RALPH_API_TOKEN=your_api_token_here
# RALPH_API_URL=http://localhost:5002  # Uncomment for local development
RALPH_POLL_INTERVAL=5000
RALPH_LOG_LEVEL=info
```

Then run:

```bash
ralph-agent
```

## How It Works

1. **Polling**: The agent continuously polls the API endpoint `/api/v1/ralph/jobs/next` for available jobs
2. **Job Claiming**: When a job is found, it's automatically claimed by the agent
3. **Status Update**: The agent marks the job as "running" and starts sending heartbeats
4. **Execution**: The job is executed using `claude --print` in the project directory
5. **Completion**: Results are parsed and reported back to the API
6. **Cleanup**: The agent marks the job as completed or failed and continues polling

## API Token Setup

To create an API token with ralph_agent permission:

1. Log into your Ralph account
2. Navigate to API Tokens settings
3. Create a new token
4. Check the "Ralph Agent Access" permission
5. Copy the token (shown only once!)

## Example Output

```
[2026-01-16T20:00:00.000Z] [INFO]
╔═══════════════════════════════════════╗
║      Ralph Agent Starting...          ║
╚═══════════════════════════════════════╝

[2026-01-16T20:00:00.123Z] [INFO] Ralph Agent starting...
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

### "API token requires 'ralph_agent' permission"

Your API token doesn't have the correct permissions. Create a new token with the `ralph_agent` permission checked.

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

The project's `system_path` in Ralph is incorrect or the directory doesn't exist on your machine.

## Development

### Running Locally

```bash
npm start
```

### Debugging

Enable debug logging:

```bash
RALPH_LOG_LEVEL=debug ralph-agent --token=your_token
```

## Architecture

```
┌─────────────────┐         ┌──────────────────┐
│  Ralph Agent    │         │   Rails API      │
│                 │         │                  │
│  ┌──────────┐   │  Poll   │  ┌────────────┐  │
│  │  Polling │───┼────────>│  │ Job Queue  │  │
│  │   Loop   │   │         │  └────────────┘  │
│  └──────────┘   │         │                  │
│       │         │  Claim  │                  │
│       ▼         │<────────┤                  │
│  ┌──────────┐   │         │                  │
│  │ Executor │   │         │                  │
│  │  (Claude)│   │ Status  │                  │
│  └──────────┘   │────────>│                  │
│                 │         │                  │
└─────────────────┘         └──────────────────┘
```

## License

MIT
