# Multi-Agent Usage Guide

## Overview

Ralph agent now supports running multiple concurrent agents to process jobs in parallel. You can launch multiple agents using your existing `npm start` or `ralphblaster` commands.

## Quick Start

### Single Agent (Default)
```bash
# Development
npm start

# Production
ralphblaster
```

### Multiple Agents

**Development:**
```bash
# Start 3 agents
npm start -- --agents=3

# Or use convenience scripts
npm run start:multi      # 3 agents
npm run start:multi:5    # 5 agents
```

**Production:**
```bash
# Start 3 agents
ralphblaster --agents=3

# Start 5 agents
ralphblaster --agents=5
```

## Usage Patterns

### 1. Command-Line Flag (Recommended)

Most flexible - works with both npm and direct command:

```bash
# Any number of agents (1-20)
ralphblaster --agents=2
ralphblaster --agents=10

# With other flags
ralphblaster --agents=3 --api-url=http://localhost:3000
ralphblaster --agents=5 --token=your_token_here
```

### 2. NPM Scripts (Convenient)

Pre-configured shortcuts:

```bash
npm start              # 1 agent (default)
npm run start:multi    # 3 agents
npm run start:multi:5  # 5 agents
```

### 3. Bash Scripts (Advanced)

For production deployment with advanced monitoring:

```bash
# Full-featured launcher with log files
./scripts/start-agents.sh 3

# Monitor status
./scripts/agent-status.sh

# View logs
tail -f logs/agent-*.log
```

See `scripts/README.md` for details on bash scripts.

## Choosing Agent Count

### Guidelines

**Development:**
- 1-2 agents for testing
- 3 agents for typical parallel development

**Production:**
- Start with 2-3 agents
- Monitor CPU and memory usage
- Scale up based on job queue depth

**Resource Rule of Thumb:**
- 1 agent per 2 CPU cores
- ~100MB RAM per idle agent
- ~300-500MB RAM per active agent

### Examples

**4 Core Machine:**
```bash
ralphblaster --agents=2  # Conservative
```

**8 Core Machine:**
```bash
ralphblaster --agents=4  # Balanced
```

**16 Core Machine:**
```bash
ralphblaster --agents=8  # High throughput
```

## Monitoring

### Log Output

Each agent logs with its ID:
```
[2025-01-23T10:30:15.123Z] [INFO] [agent-1] Ralph Agent starting...
[2025-01-23T10:30:15.456Z] [INFO] [agent-2] Ralph Agent starting...
[2025-01-23T10:30:15.789Z] [INFO] [agent-3] Ralph Agent starting...
```

When processing jobs:
```
[2025-01-23T10:30:20.123Z] [INFO] [agent-1] [job-42] Claimed job #42
[2025-01-23T10:30:21.456Z] [INFO] [agent-2] [job-43] Claimed job #43
```

### Real-Time Monitoring

**Using bash scripts:**
```bash
# Launch agents with separate log files
./scripts/start-agents.sh 3

# Check status
./scripts/agent-status.sh

# Watch specific agent
tail -f logs/agent-1.log

# Watch all agents
tail -f logs/agent-*.log
```

**Using command-line flag:**
- All agents share stdio (unified console output)
- Agent IDs shown in each log line
- Use `grep` to filter by agent: `... | grep "\[agent-2\]"`

## Stopping Agents

### Graceful Shutdown

Press `Ctrl+C` in the terminal:
```bash
# All agents will receive SIGTERM and shutdown gracefully
# Jobs in progress will be marked as failed
# Worktrees will be cleaned up
```

### Force Stop

If agents don't stop:
```bash
pkill -9 -f ralph-agent
```

## Configuration

All existing configuration works with multi-agent mode:

### Environment Variables
```bash
# Set once, applies to all agents
export RALPH_API_TOKEN=your_token_here
export RALPH_API_URL=https://ralphblaster.com
export RALPH_LOG_LEVEL=info

# Start agents
ralphblaster --agents=3
```

### Config File
```bash
# Initialize once
ralphblaster init --token=your_token_here

# Token applies to all agents
ralphblaster --agents=3
```

### Command-Line Flags
```bash
# All flags work with multi-agent mode
ralphblaster --agents=3 --api-url=http://localhost:3000 --token=dev_token
```

## Architecture

### How It Works

**Command-line flag mode** (`--agents=N`):
1. Parent process spawns N child processes
2. Each child runs a full agent instance
3. Each gets unique `RALPH_AGENT_ID` env var
4. Parent handles signal forwarding and cleanup
5. All agents share console output

**Bash script mode** (`scripts/start-agents.sh`):
1. Bash script spawns N background processes
2. Each agent writes to separate log file
3. PID tracking for management
4. Advanced monitoring with status script

### Job Distribution

- Each agent polls API independently
- API atomically assigns different jobs
- No coordination needed between agents
- Natural load balancing

### Isolation

- **Process**: Each agent is a separate OS process
- **Worktrees**: Unique git worktree per job ID
- **State**: No shared memory between agents
- **Logs**: Agent ID in every log message

## Troubleshooting

### Agents Exit Immediately

Check logs for errors:
```bash
ralphblaster --agents=3
# Look for error messages in output
```

Common issues:
- Missing `RALPH_API_TOKEN`
- Invalid API URL
- Network connectivity

### Only One Agent Running

Verify agent count flag:
```bash
ralphblaster --agents=3  # Correct
ralphblaster agents=3    # Wrong (missing --)
```

### Agents Not Claiming Jobs

1. Check if jobs exist in queue (Ralph UI)
2. Verify agent permissions
3. Check API connectivity:
   ```bash
   curl $RALPH_API_URL/health
   ```

### High Memory Usage

Normal:
- ~100MB per idle agent
- ~500MB per active agent with Claude

If exceeding:
- Reduce agent count
- Check for memory leaks in logs
- Restart agents periodically

### Git Worktree Conflicts

Rare but possible:
```bash
# List worktrees
git worktree list

# Clean stale worktrees
git worktree prune
```

## Best Practices

### Development

```bash
# Start with 1-2 agents during development
npm start -- --agents=2

# Use unified console output for debugging
# Agent IDs make it easy to trace actions
```

### Staging

```bash
# Test with production-like load
ralphblaster --agents=3

# Monitor for 24 hours before production
# Check memory, CPU, job throughput
```

### Production

```bash
# Use bash scripts for robust deployment
./scripts/start-agents.sh 3

# Set up monitoring
watch -n 5 ./scripts/agent-status.sh

# Or use systemd/PM2 for auto-restart
# See scripts/README.md for examples
```

### Scaling Strategy

1. **Start small**: 2-3 agents initially
2. **Monitor metrics**: CPU, memory, job queue depth
3. **Scale gradually**: Add 1-2 agents at a time
4. **Find sweet spot**: Balance throughput vs. resources

## Examples

### Local Development
```bash
# Single agent for simple testing
npm start

# Multi-agent for parallel testing
npm start -- --agents=2
```

### Staging Server
```bash
# 3 agents with custom API URL
ralphblaster --agents=3 --api-url=https://staging.ralphblaster.com
```

### Production Server
```bash
# Using bash scripts for robust deployment
./scripts/start-agents.sh 5

# Monitor in another terminal
watch -n 5 ./scripts/agent-status.sh

# View logs
tail -f logs/agent-*.log
```

### CI/CD Pipeline
```bash
# Run single agent in CI
ralphblaster --token=$CI_TOKEN --api-url=$CI_API_URL

# Or test multi-agent functionality
ralphblaster --agents=2 --token=$CI_TOKEN
```

## Migration from Old Setup

### If You Used Old Scripts

The old `old-scripts/ralph-multi.sh` is now replaced by:

**Option 1 - Command-line flag:**
```bash
# Old way
./old-scripts/ralph-multi.sh 3

# New way
ralphblaster --agents=3
```

**Option 2 - New bash scripts:**
```bash
# Old way
./old-scripts/ralph-multi.sh 3

# New way
./scripts/start-agents.sh 3
```

### Benefits of New System

- ✓ Integrated with `ralphblaster` command
- ✓ Works with npm scripts
- ✓ Unified with single-agent usage
- ✓ Same flags and configuration
- ✓ Better error handling
- ✓ Cleaner shutdown logic

## FAQ

**Q: How many agents should I run?**
A: Start with 2-3, monitor resources, scale based on job queue depth.

**Q: Can I mix command-line flag and bash scripts?**
A: Yes, but choose one approach per deployment for consistency.

**Q: Do agents share jobs?**
A: No, each job is claimed by exactly one agent atomically.

**Q: What happens if one agent crashes?**
A: Other agents continue working. Use process managers for auto-restart.

**Q: Can I change agent count without restarting?**
A: No, you need to stop all agents and restart with new count.

**Q: Will this work on Windows?**
A: Yes, command-line flag method is cross-platform. Bash scripts need WSL/Git Bash.

**Q: Can I set different tokens per agent?**
A: No, all agents use the same configuration. Use separate deployments for different tokens.

**Q: How do I know which agent processed which job?**
A: Check logs - every action includes `[agent-X]` and `[job-Y]` identifiers.
