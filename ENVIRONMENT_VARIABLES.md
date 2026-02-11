# Environment Variables

This document lists all environment variables supported by the RalphBlaster Agent.

## Backward Compatibility

As of version 1.5.0, the agent supports both `RALPHBLASTER_*` and `RALPH_*` prefixes for all environment variables. The `RALPH_*` prefix is deprecated but will continue to work during the transition period.

**Priority Order:**
1. `RALPHBLASTER_*` variables (new, recommended)
2. `RALPH_*` variables (deprecated, backward compatible)
3. Default values

When a deprecated `RALPH_*` variable is detected, a deprecation warning will be displayed on first use.

## Core Configuration

### RALPHBLASTER_API_TOKEN (required)
**Old name:** `RALPH_API_TOKEN`

Your RalphBlaster API authentication token. Required for all operations.

**Example:**
```bash
export RALPHBLASTER_API_TOKEN="your_token_here"
```

### RALPHBLASTER_API_URL
**Old name:** `RALPH_API_URL`
**Default:** `https://app.ralphblaster.com`

The base URL for the RalphBlaster API.

**Example:**
```bash
export RALPHBLASTER_API_URL="https://custom-api.example.com"
```

### RALPHBLASTER_MAX_RETRIES
**Old name:** `RALPH_MAX_RETRIES`
**Default:** `3`

Maximum number of retry attempts for failed API requests. Must be a positive integer.

**Example:**
```bash
export RALPHBLASTER_MAX_RETRIES="5"
```

## Security Configuration

### RALPHBLASTER_ALLOWED_PATHS
**Old name:** `RALPH_ALLOWED_PATHS`
**Default:** (none - allows all user directories)

Colon-separated list of allowed base paths for project directories. Provides additional security by restricting which directories the agent can access.

**Example:**
```bash
export RALPHBLASTER_ALLOWED_PATHS="/Users/me/projects:/home/me/work"
```

## Claude Execution Configuration

### CLAUDE_PERMISSION_MODE
**Default:** `acceptEdits` (with auto-allowed dev commands)
**Valid values:** `acceptEdits`, `acceptAll`, `prompt`

Controls Claude Code's permission behavior in headless mode. This determines which tools require user approval.

- **`acceptEdits` (default, recommended)**: Auto-approve Edit/Write/Read tools + explicitly allowed Bash commands only
  - Automatically allows: git, gh, npm, bundle, rails, docker, yarn, pnpm, echo
  - Blocks: Anything else (rm, curl, wget, etc.)
  - Best balance of security and automation

- **`acceptAll`**: Auto-approve ALL tools without restrictions
  - ⚠️ **Use with caution** - Claude can execute ANY command
  - Only use if you fully trust the PRD source and understand the risks
  - Recommended only for isolated test environments

- **`prompt`**: Prompt for all actions
  - ❌ Not suitable for headless/automated mode (will hang)
  - Only use for interactive debugging

**How It Works:**
When using `acceptEdits` (default), the agent automatically adds `--allowedTools` flags for common development commands. This prevents hanging when Claude needs to run `git commit`, `npm install`, etc., while maintaining security boundaries.

**Example:**
```bash
# Use default safe mode (recommended for production)
# No need to set - acceptEdits with allowed commands is the default
ralphblaster

# Explicitly set acceptEdits (same as default)
export CLAUDE_PERMISSION_MODE="acceptEdits"

# Use unrestricted mode (⚠️ use with caution)
export CLAUDE_PERMISSION_MODE="acceptAll"
```

**⚠️ Security Considerations:**
- **Default (`acceptEdits`)**: Claude can only run approved dev commands - provides good security while preventing hangs
- **`acceptAll`**: Claude can run ANY command - use only in isolated/trusted environments
- Never use `prompt` in automated/headless environments

### CLAUDE_STREAM_DEBUG
**Default:** `true`

Enable or disable debug logging for Claude's stream-json output. Set to `false` to reduce verbosity.

**Example:**
```bash
export CLAUDE_STREAM_DEBUG="false"
```

## Logging Configuration

### RALPHBLASTER_LOG_LEVEL
**Old name:** `RALPH_LOG_LEVEL`
**Default:** `info`
**Valid values:** `error`, `warn`, `info`, `debug`

Controls the verbosity of console logging.

**Example:**
```bash
export RALPHBLASTER_LOG_LEVEL="debug"
```

### RALPHBLASTER_CONSOLE_COLORS
**Old name:** `RALPH_CONSOLE_COLORS`
**Default:** `true`

Enable or disable colored console output. Set to `false`, `0`, or empty string to disable.

**Example:**
```bash
export RALPHBLASTER_CONSOLE_COLORS="false"
```

### RALPHBLASTER_CONSOLE_FORMAT
**Old name:** `RALPH_CONSOLE_FORMAT`
**Default:** `pretty`
**Valid values:** `pretty`, `json`

Console output format. Use `json` for machine parsing or log aggregation.

**Example:**
```bash
export RALPHBLASTER_CONSOLE_FORMAT="json"
```

### RALPHBLASTER_MAX_BATCH_SIZE
**Old name:** `RALPH_MAX_BATCH_SIZE`
**Default:** `10`

Maximum number of log entries to batch before sending to the API. Must be a positive integer.

**Example:**
```bash
export RALPHBLASTER_MAX_BATCH_SIZE="20"
```

### RALPHBLASTER_FLUSH_INTERVAL
**Old name:** `RALPH_FLUSH_INTERVAL`
**Default:** `2000`

Time in milliseconds between automatic log flushes to the API. Must be a positive integer.

**Example:**
```bash
export RALPHBLASTER_FLUSH_INTERVAL="5000"
```

### RALPHBLASTER_USE_BATCH_ENDPOINT
**Old name:** `RALPH_USE_BATCH_ENDPOINT`
**Default:** `true`

Whether to use the batch API endpoint for sending logs. Falls back to individual calls if batch endpoint fails.

**Example:**
```bash
export RALPHBLASTER_USE_BATCH_ENDPOINT="false"
```

## Multi-Agent Configuration

### RALPHBLASTER_AGENT_ID
**Old name:** `RALPH_AGENT_ID`
**Default:** `agent-default`

Unique identifier for this agent instance. Automatically set when using `--agents` flag for multi-agent deployments.

**Example:**
```bash
export RALPHBLASTER_AGENT_ID="agent-prod-1"
```

## Configuration Priority

The agent loads configuration from multiple sources in this order:

1. **Command-line flags** (e.g., `--token`, `--api-url`)
2. **Environment variables** (RALPHBLASTER_* > RALPH_*)
3. **Config file** (`~/.ralphblasterrc`)
4. **Default values**

## Migration Guide

To migrate from old `RALPH_*` variables to new `RALPHBLASTER_*` variables:

### Option 1: Update all at once
```bash
# Old
export RALPH_API_TOKEN="token"
export RALPH_LOG_LEVEL="debug"

# New
export RALPHBLASTER_API_TOKEN="token"
export RALPHBLASTER_LOG_LEVEL="debug"
```

### Option 2: Gradual migration
You can use both during the transition period. New variables take precedence:
```bash
# Set new variable while keeping old one for compatibility
export RALPHBLASTER_API_TOKEN="token"
export RALPH_API_TOKEN="token"  # This will be ignored
```

### Option 3: No changes required
The old `RALPH_*` variables will continue to work with deprecation warnings. However, it's recommended to migrate to the new names.

## Example Configurations

### Development
```bash
export RALPHBLASTER_API_TOKEN="dev_token_123"
export RALPHBLASTER_LOG_LEVEL="debug"
export RALPHBLASTER_CONSOLE_FORMAT="pretty"
export RALPHBLASTER_CONSOLE_COLORS="true"
```

### Production
```bash
export RALPHBLASTER_API_TOKEN="prod_token_456"
export RALPHBLASTER_LOG_LEVEL="info"
export RALPHBLASTER_CONSOLE_FORMAT="json"
export RALPHBLASTER_CONSOLE_COLORS="false"
export RALPHBLASTER_MAX_BATCH_SIZE="50"
export RALPHBLASTER_FLUSH_INTERVAL="5000"
```

### CI/CD
```bash
export RALPHBLASTER_API_TOKEN="${RALPHBLASTER_TOKEN}"
export RALPHBLASTER_LOG_LEVEL="warn"
export RALPHBLASTER_CONSOLE_FORMAT="json"
export RALPHBLASTER_CONSOLE_COLORS="false"
export RALPHBLASTER_ALLOWED_PATHS="/workspace"
```

## See Also

- [README.md](./README.md) - General documentation
- [RENAME_AUDIT.md](./RENAME_AUDIT.md) - Rename audit and migration plan
