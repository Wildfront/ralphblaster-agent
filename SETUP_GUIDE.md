# RalphBlaster Agent Setup Guide

This guide explains how to set up and use the RalphBlaster agent with the proper three-step workflow.

## Installation

```bash
npm install -g ralphblaster
```

## Setup Process

### Step 1: Save Your Credentials

Run this **once** to save your API token and URL to `~/.ralphblasterrc`:

```bash
ralphblaster init --token=XXXXXXXXXXXXXXXXXXXXXXXX --api-url=https://hq.ralphblaster.com
```

This will:
- Save your API token to `~/.ralphblasterrc`
- Save your API URL to `~/.ralphblasterrc`
- Make the file readable/writable only by you (permissions: 0600)

**Alternative:** You can also set environment variables:
```bash
export RALPHBLASTER_API_TOKEN="XXXXXXXXXXXXXXXXXXXXXXXX"
export RALPHBLASTER_API_URL="https://hq.ralphblaster.com"
ralphblaster init
```

### Step 2: Register Your Project

Navigate to your project directory and register it with RalphBlaster:

```bash
cd /path/to/your/project
ralphblaster add-project
```

This will:
- Auto-detect your project name from:
  1. Git remote URL (e.g., `my-repo` from `https://github.com/user/my-repo.git`)
  2. `package.json` name field
  3. Directory name (fallback)
- Send a POST request to `/projects` with:
  - `system_path`: Full path to your project directory
  - `name`: Detected project name
- Display project details (name, icon, color) returned from the API

**Note:** You need to run this for each project you want to register with RalphBlaster.

### Step 3: Start the Agent

Start the agent to begin processing tasks:

```bash
ralphblaster
```

The agent will:
- Load credentials from `~/.ralphblasterrc`
- Poll the API for pending tasks
- Execute tasks assigned to projects in the current directory
- Send progress updates and results back to the API

## Multi-Agent Mode

You can run multiple agents concurrently to process tasks in parallel:

```bash
ralphblaster --agents=3
```

This will spawn 3 agent processes, each polling independently.

## Configuration

### Config File Location

`~/.ralphblasterrc` (JSON format)

Example:
```json
{
  "apiToken": "XXXXXXXXXXXXXXXXXXXXXXXX",
  "apiUrl": "https://hq.ralphblaster.com"
}
```

### Environment Variables

Configuration priority (highest to lowest):
1. Command-line flags (`--token`, `--api-url`)
2. Environment variables (`RALPHBLASTER_API_TOKEN`, `RALPHBLASTER_API_URL`)
3. Config file (`~/.ralphblasterrc`)
4. Defaults

Available environment variables:
- `RALPHBLASTER_API_TOKEN` - API token for authentication
- `RALPHBLASTER_API_URL` - API base URL (default: `https://hq.ralphblaster.com`)
- `RALPHBLASTER_LOG_LEVEL` - Log level: `error`, `warn`, `info`, `debug` (default: `info`)
- `RALPHBLASTER_ALLOWED_PATHS` - Colon-separated list of allowed base paths (security whitelist)
- `RALPHBLASTER_AGENT_ID` - Agent identifier for multi-agent setups

**Legacy variables** (deprecated but still supported):
- `RALPH_API_TOKEN` - Use `RALPHBLASTER_API_TOKEN` instead
- `RALPH_API_URL` - Use `RALPHBLASTER_API_URL` instead

## Commands Reference

### `ralphblaster init`

Saves credentials to `~/.ralphblasterrc`.

**Options:**
- `--token=<token>` - API token (or set `RALPHBLASTER_API_TOKEN`)
- `--api-url=<url>` - API base URL (default: `https://hq.ralphblaster.com`)

**Example:**
```bash
ralphblaster init --token=your_token_here --api-url=https://hq.ralphblaster.com
```

### `ralphblaster add-project`

Registers the current directory as a project with RalphBlaster.

**Requirements:**
- Must run `init` first to save credentials
- Must run from your project directory

**Example:**
```bash
cd /path/to/your/project
ralphblaster add-project
```

### `ralphblaster` (default)

Starts the agent in polling mode.

**Options:**
- `--agents=<count>` - Run multiple agents concurrently (1-20, default: 1)

**Example:**
```bash
ralphblaster
ralphblaster --agents=3
```

## Troubleshooting

### "No API token provided"

Make sure you've run `ralphblaster init` first:
```bash
ralphblaster init --token=your_token_here
```

### "Invalid API token"

Your token may have expired or been revoked. Generate a new token in RalphBlaster and run:
```bash
ralphblaster init --token=new_token_here
```

### "Could not connect to RalphBlaster API"

Check:
1. Your internet connection
2. The API URL is correct (default: `https://hq.ralphblaster.com`)
3. No firewall is blocking the connection

### "API token lacks 'ralph_agent' permission"

Generate a new agent token with the correct permissions in RalphBlaster.

## Security

- Config file (`~/.ralphblasterrc`) is created with `0600` permissions (readable/writable only by you)
- API tokens are never logged or displayed in output
- The agent validates project paths to prevent unauthorized filesystem access
- Environment variables are sanitized before passing to Claude CLI

## Getting Help

```bash
ralphblaster --help
```

For issues or feedback, visit: https://github.com/anthropics/ralphblaster-agent/issues
