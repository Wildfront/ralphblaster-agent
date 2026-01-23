# Ralph Agent Monitoring Guide

This guide explains how to monitor your Ralph agent and troubleshoot issues like invisible job processing.

## The Problem

Ralph agents can sometimes:
- Run in background processes you can't see
- Get stuck and stop polling
- Have multiple instances running simultaneously
- Process jobs without visible logs

## The Solution: Agent Monitor

Two new scripts help you manage and monitor your agent:

### 1. `monitor-agent.sh` - Agent Management

Controls agent lifecycle and ensures only one agent runs at a time.

```bash
# Start the agent (fails if already running)
bin/monitor-agent.sh start

# Check status (shows if multiple agents are running)
bin/monitor-agent.sh status

# Stop the agent gracefully
bin/monitor-agent.sh stop

# Kill all agents and start fresh (best for stuck agents)
bin/monitor-agent.sh restart

# Watch live logs
bin/monitor-agent.sh logs

# Show recent logs (last 50 lines)
bin/monitor-agent.sh show-logs

# Show more logs
bin/monitor-agent.sh show-logs 200

# Emergency: kill all agent processes
bin/monitor-agent.sh kill-all
```

### 2. `agent-dashboard.sh` - Live Dashboard

Real-time visualization of agent activity.

```bash
# Launch the dashboard
bin/agent-dashboard.sh
```

The dashboard shows:
- ✅ Agent status (running/stopped, uptime)
- 📊 Today's statistics (total jobs, PRD vs code, success rate)
- 📋 Recent jobs processed (last 5)
- 🔴 Live activity (last 10 seconds)
- ⚠️ Warnings if multiple agents detected

Press Ctrl+C to exit.

## Log Files

All logs are stored in `~/.ralph-agent-logs/`:
- `agent-YYYYMMDD.log` - Daily log files
- `agent.pid` - PID file for the running agent

## Detecting Multiple Agents

The monitor will warn you if multiple agent processes are detected:

```bash
bin/monitor-agent.sh status
```

If you see:
```
⚠️  WARNING: Multiple agent processes detected!
```

Fix it with:
```bash
bin/monitor-agent.sh restart
```

This kills ALL agents and starts exactly one.

## Troubleshooting

### Problem: "PRD jobs complete but I don't see logs"

**Diagnosis:**
```bash
bin/monitor-agent.sh status
```

Look for:
- "Main agent: NOT RUNNING" - Your visible agent died
- "Multiple agent processes detected" - Another agent is processing jobs
- Stale PID file - Agent crashed but PID file remains

**Fix:**
```bash
# Nuclear option: kill everything and start fresh
bin/monitor-agent.sh restart

# Then watch the dashboard
bin/agent-dashboard.sh
```

### Problem: "Agent is stuck/frozen"

**Symptoms:**
- No new logs appearing
- Jobs in database but not being processed
- Process exists but unresponsive

**Fix:**
```bash
# Graceful stop might hang on stuck agents
# Use kill-all instead
bin/monitor-agent.sh kill-all

# Wait a moment
sleep 2

# Start fresh
bin/monitor-agent.sh start
```

### Problem: "How do I know which agent is processing my jobs?"

**Solution:**
Watch the dashboard while creating a PRD job:

```bash
bin/agent-dashboard.sh
```

You'll see real-time:
- 📄 PRD jobs with red dots: `🔴🔴🔴 PRD GENERATION JOB CLAIMED`
- 💻 Code jobs with green dots: `🟢🟢🟢 STARTING ... EXECUTION`

If you don't see activity, the visible agent isn't processing jobs.

## Best Practices

### 1. Always Use the Monitor

Instead of running `node bin/ralph-agent.js` directly:

```bash
# ❌ Don't do this
node bin/ralph-agent.js &

# ✅ Do this instead
bin/monitor-agent.sh start
```

### 2. Check Status Before Starting

```bash
# Check if already running
bin/monitor-agent.sh status

# If multiple agents or stuck, restart
bin/monitor-agent.sh restart
```

### 3. Monitor During Development

Keep the dashboard open in a separate terminal:

```bash
# Terminal 1: Your development work
cd /Users/macmartine/src/ralph-agent
# ... make changes ...

# Terminal 2: Live monitoring
bin/agent-dashboard.sh
```

### 4. Periodic Health Checks

Add to your workflow:

```bash
# Morning routine
cd ~/src/ralph-agent
bin/monitor-agent.sh status
bin/monitor-agent.sh show-logs 20
```

## Integration with tmux/screen

If you run the agent in tmux/screen, use the monitor:

```bash
# In your tmux session
tmux new -s ralph-agent
cd ~/src/ralph-agent
bin/monitor-agent.sh start

# Detach: Ctrl+B, D

# Later, check status from anywhere
bin/monitor-agent.sh status

# Reattach to see live logs
tmux attach -t ralph-agent
bin/monitor-agent.sh logs
```

## Daily Workflow

**Starting your day:**
```bash
# 1. Check if agent is running
bin/monitor-agent.sh status

# 2. If not running or stuck, restart
bin/monitor-agent.sh restart

# 3. Launch dashboard to monitor
bin/agent-dashboard.sh
```

**During development:**
```bash
# Make code changes
vim src/executor.js

# Restart agent to load changes
bin/monitor-agent.sh restart

# Verify it picked up changes
bin/monitor-agent.sh show-logs 10
```

**End of day:**
```bash
# Check today's stats
bin/monitor-agent.sh status

# Stop the agent (or leave it running)
bin/monitor-agent.sh stop
```

## Advanced: Systemd Integration (Optional)

For production servers, you can create a systemd service:

```bash
# /etc/systemd/system/ralph-agent.service
[Unit]
Description=Ralph Agent
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/ralph-agent
ExecStart=/home/youruser/ralph-agent/bin/monitor-agent.sh start
ExecStop=/home/youruser/ralph-agent/bin/monitor-agent.sh stop
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable ralph-agent
sudo systemctl start ralph-agent
sudo systemctl status ralph-agent
```

## FAQ

**Q: Why not just `ps aux | grep ralph`?**
A: The monitor shows which agent is YOUR tracked agent vs zombie processes, and warns about multiple agents.

**Q: Can I run multiple agents on purpose?**
A: Not recommended. Multiple agents compete for the same jobs, causing confusion. If you need multiple agents, use different API tokens and accounts.

**Q: What if the monitor script itself has issues?**
A: Emergency fallback:
```bash
pkill -9 -f ralph-agent
node bin/ralph-agent.js > ~/ralph-agent.log 2>&1 &
echo $! > ~/.ralph-agent-logs/agent.pid
```

**Q: Do I need to remove the loud logging (🔴🔴🔴)?**
A: It's helpful for debugging, but you can set `RALPH_LOG_LEVEL=warn` to hide it if it's too noisy.

## Summary

**The monitoring solution gives you:**

✅ **Visibility** - See exactly which agent is processing jobs
✅ **Control** - Ensure only one agent runs
✅ **Debugging** - Detect stuck/zombie agents immediately
✅ **Confidence** - Know your agent is working correctly

**When you see the mystery again:**

1. Run `bin/monitor-agent.sh status` - catch multiple agents
2. Watch `bin/agent-dashboard.sh` - see real-time activity
3. Check `~/.ralph-agent-logs/` - historical evidence

If PRD jobs are being processed without visible logs, you'll now be able to prove whether:
- Another agent is doing it (status shows multiple processes)
- Your agent is doing it but logs aren't visible (dashboard shows activity)
- Something else entirely (neither shows activity = investigate further)
