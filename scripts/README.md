# Ralph Agent Multi-Process Scripts

Scripts for managing multiple Ralph agent processes running concurrently.

## Overview

These scripts enable you to run multiple Ralph agent instances in parallel, allowing concurrent job processing. Each agent:
- Has a unique ID (e.g., `agent-1`, `agent-2`)
- Polls the API independently for jobs
- Maintains isolated state and logs
- Can be monitored and managed independently

## Scripts

### start-agents.sh

Launches multiple agent processes with unique IDs.

**Usage:**
```bash
./scripts/start-agents.sh [count]
```

**Examples:**
```bash
# Start 3 agents (default)
./scripts/start-agents.sh

# Start 5 agents
./scripts/start-agents.sh 5

# Start 1 agent (single-agent mode)
./scripts/start-agents.sh 1
```

**What it does:**
- Creates a `logs/` directory for agent logs
- Launches N agent processes with unique IDs
- Creates a `.agent-pids` file to track PIDs
- Sets up signal handlers for graceful shutdown
- Displays status and log file locations

**Stopping agents:**
- Press `Ctrl+C` to gracefully stop all agents
- Or: `pkill -f 'RALPH_AGENT_ID=agent-'`

### agent-status.sh

Displays the status of all running agents.

**Usage:**
```bash
./scripts/agent-status.sh
```

**Example output:**
```
═══════════════════════════════════════════════════════
  Ralph Agent Status Dashboard
═══════════════════════════════════════════════════════

AGENT ID        STATUS     PID        LAST LOG ENTRY
────────────────────────────────────────────────────────
agent-1         RUNNING    12345      [2025-01-23T10:30:15.123Z] [INFO] [agent-1] [job-42]
agent-2         RUNNING    12346      [2025-01-23T10:30:20.456Z] [INFO] [agent-2] Polling...
agent-3         DEAD       12347      Process not running

Summary: Running: 2 | Dead: 1
```

**Monitoring continuously:**
```bash
# Refresh every 5 seconds
watch -n 5 ./scripts/agent-status.sh
```

## Log Files

Agent logs are stored in `logs/` directory:
- `logs/agent-1.log` - Logs for agent-1
- `logs/agent-2.log` - Logs for agent-2
- etc.

**Viewing logs:**
```bash
# Follow a specific agent
tail -f logs/agent-1.log

# Follow all agents
tail -f logs/agent-*.log

# Search for errors across all agents
grep ERROR logs/agent-*.log

# Filter by job ID
grep "job-42" logs/agent-*.log
```

## Log Format

Each log entry includes:
- Timestamp
- Log level (INFO, WARN, ERROR, DEBUG)
- Agent ID (e.g., `[agent-1]`)
- Job ID (when processing a job, e.g., `[job-42]`)
- Message

Example:
```
[2025-01-23T10:30:15.123Z] [INFO] [agent-1] [job-42] Claimed job #42 - Implement user authentication
```

## Environment Variables

- `RALPH_AGENT_ID` - Set automatically by launcher script (e.g., `agent-1`)
- `RALPH_API_TOKEN` - API token for Ralph backend (required)
- `RALPH_API_URL` - API endpoint URL (optional, defaults to http://localhost:3000)

## Architecture

### Process Isolation
- Each agent runs as a separate Node.js process
- Agents do not share memory or state
- Process crashes do not affect other agents
- Each agent has independent event loop and resource management

### Job Distribution
- Agents poll `/api/v1/ralph/jobs/next` independently
- API atomically assigns different jobs to each agent
- No coordination needed between agents
- Natural load balancing through polling

### Worktree Isolation
- Each job gets a unique git worktree: `{repo}-worktrees/job-{id}/`
- Worktrees are isolated by job ID (not agent ID)
- Multiple agents can work on different jobs in the same repo
- Automatic cleanup after job completion

### Log Traceability
- Agent ID included in all log messages
- Job ID included when processing a job
- Easy to filter logs by agent or job
- Each agent has a separate log file

## Resource Requirements

### Per Agent Process
- **CPU**: ~5-10% baseline, 60-80% during job execution
- **Memory**: ~100MB baseline, 300-500MB during job execution
- **Disk**: One worktree per active job (~repo size)

### Example: 3 Agents
- **CPU**: ~150-240% total (leaves CPU for other processes)
- **Memory**: ~300MB baseline, ~1.5GB peak
- **Disk**: 3x worktree space (cleaned up after jobs complete)

## Troubleshooting

### Agent Dies Immediately
1. Check the agent's log file: `cat logs/agent-N.log`
2. Verify `RALPH_API_TOKEN` is set correctly
3. Verify API is accessible: `curl $RALPH_API_URL/health`

### No Jobs Being Claimed
1. Check if jobs are in queue: visit Ralph UI
2. Verify agent has correct permissions
3. Check API connectivity in logs

### Worktree Conflicts
- Worktrees are unique by job ID, so conflicts should be rare
- If conflicts occur, check for stale worktrees:
  ```bash
  ls -la {repo}-worktrees/
  git worktree list
  ```
- Clean up stale worktrees:
  ```bash
  git worktree prune
  ```

### High Memory Usage
- Normal: Each active job uses 300-500MB
- If memory grows unbounded, check for leaks in logs
- Consider reducing agent count or adding memory

### Agent Won't Stop
- Try graceful shutdown: `Ctrl+C` in launcher terminal
- Force stop: `pkill -9 -f 'RALPH_AGENT_ID=agent-'`
- Clean up PID file: `rm scripts/.agent-pids`

## Operational Tips

### Starting Agents on Boot (systemd)
Create `/etc/systemd/system/ralph-agents.service`:
```ini
[Unit]
Description=Ralph Agent Multi-Process
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/ralphblaster-agent
ExecStart=/path/to/ralphblaster-agent/scripts/start-agents.sh 3
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable ralph-agents
sudo systemctl start ralph-agents
sudo systemctl status ralph-agents
```

### Monitoring in Production
```bash
# Watch agent status in real-time
watch -n 5 ./scripts/agent-status.sh

# Monitor for errors
tail -f logs/agent-*.log | grep ERROR

# Alert on agent death
while true; do
  dead=$(./scripts/agent-status.sh | grep DEAD | wc -l)
  if [ $dead -gt 0 ]; then
    echo "ALERT: $dead agents are dead"
    # Send notification here
  fi
  sleep 60
done
```

### Scaling Strategy
1. **Start small**: Begin with 2-3 agents
2. **Monitor metrics**: Watch CPU, memory, job throughput
3. **Scale up**: Add agents if jobs are queuing and resources available
4. **Scale down**: Remove agents during low-traffic periods

### Best Practices
- Run 1 agent per 2 CPU cores available
- Keep total memory usage under 80% of available RAM
- Monitor disk space for worktrees (auto-cleanup happens after jobs)
- Check logs daily for errors or warnings
- Restart agents weekly to clear any accumulated state

## Future Enhancements

Planned improvements:
- Dynamic agent scaling based on queue depth
- Agent specialization (PRD vs code execution)
- Health check endpoint for each agent
- Metrics export (Prometheus format)
- Auto-restart on failure
- Graceful rolling updates
