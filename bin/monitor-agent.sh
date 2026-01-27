#!/bin/bash
# Ralph Agent Monitoring Script
# Ensures only one agent runs and provides visibility into its activity

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_SCRIPT="$AGENT_DIR/bin/ralphblaster.js"
LOG_DIR="$HOME/.ralphblaster-logs"
CURRENT_LOG="$LOG_DIR/agent-$(date +%Y%m%d).log"
PID_FILE="$LOG_DIR/agent.pid"
STATUS_FILE="$LOG_DIR/agent-status.json"

# Create log directory
mkdir -p "$LOG_DIR"

# Function to check if agent is running
check_agent() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            # Check if it's actually our agent process
            if ps -p "$pid" -o command= | grep -q "ralphblaster"; then
                return 0  # Running
            fi
        fi
        # Stale PID file
        rm -f "$PID_FILE"
    fi
    return 1  # Not running
}

# Function to kill all agent processes
kill_all_agents() {
    echo "Searching for all Ralph agent processes..."
    local pids=$(pgrep -f "ralphblaster.js")

    if [ -z "$pids" ]; then
        echo "No agent processes found"
        return
    fi

    echo "Found agent processes: $pids"
    for pid in $pids; do
        echo "Killing process $pid..."
        kill -TERM "$pid" 2>/dev/null
        sleep 1
        # Force kill if still running
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "Force killing $pid..."
            kill -KILL "$pid" 2>/dev/null
        fi
    done

    rm -f "$PID_FILE"
    echo "All agents stopped"
}

# Function to start agent
start_agent() {
    if check_agent; then
        echo "❌ Agent already running (PID: $(cat "$PID_FILE"))"
        echo "Use 'monitor-agent.sh restart' to restart it"
        return 1
    fi

    echo "Starting Ralph agent..."
    echo "Logs: $CURRENT_LOG"

    # Start agent with output to log file
    cd "$AGENT_DIR"
    RALPH_LOG_LEVEL="${RALPH_LOG_LEVEL:-info}" node "$AGENT_SCRIPT" >> "$CURRENT_LOG" 2>&1 &
    local pid=$!

    echo $pid > "$PID_FILE"

    # Wait a moment to ensure it started
    sleep 2

    if check_agent; then
        echo "✅ Agent started successfully (PID: $pid)"
        echo ""
        echo "Monitor logs with:"
        echo "  tail -f $CURRENT_LOG"
        echo ""
        echo "Check status with:"
        echo "  $0 status"
        return 0
    else
        echo "❌ Agent failed to start"
        echo "Check logs: $CURRENT_LOG"
        return 1
    fi
}

# Function to stop agent
stop_agent() {
    if ! check_agent; then
        echo "Agent not running"
        # Clean up any zombie processes just in case
        kill_all_agents
        return 0
    fi

    local pid=$(cat "$PID_FILE")
    echo "Stopping agent (PID: $pid)..."
    kill -TERM "$pid" 2>/dev/null

    # Wait for graceful shutdown
    local timeout=10
    while [ $timeout -gt 0 ]; do
        if ! ps -p "$pid" > /dev/null 2>&1; then
            rm -f "$PID_FILE"
            echo "✅ Agent stopped"
            return 0
        fi
        sleep 1
        timeout=$((timeout - 1))
    done

    # Force kill if still running
    echo "Force killing agent..."
    kill -KILL "$pid" 2>/dev/null
    rm -f "$PID_FILE"
    echo "✅ Agent stopped (forced)"
}

# Function to show status
show_status() {
    echo "=== Ralph Agent Status ==="
    echo ""

    # Check main agent
    if check_agent; then
        local pid=$(cat "$PID_FILE")
        echo "✅ Main agent: RUNNING (PID: $pid)"

        # Get process info
        echo ""
        echo "Process details:"
        ps -p "$pid" -o pid,state,start,time,command | tail -n +2

        # Get API token info
        if [ -f "$HOME/.ralphblasterrc" ]; then
            echo ""
            echo "API Token: configured in ~/.ralphblasterrc"
        fi

        # Show recent activity from logs
        echo ""
        echo "Recent activity (last 5 lines):"
        if [ -f "$CURRENT_LOG" ]; then
            tail -5 "$CURRENT_LOG" | sed 's/^/  /'
        else
            echo "  (no log file found)"
        fi
    else
        echo "❌ Main agent: NOT RUNNING"
    fi

    echo ""
    echo "=== All Ralph Agent Processes ==="
    local all_pids=$(pgrep -f "ralphblaster.js")

    if [ -z "$all_pids" ]; then
        echo "No agent processes found"
    else
        echo "Found processes:"
        for pid in $all_pids; do
            echo ""
            ps -p "$pid" -o pid,state,start,time,command | tail -n +2 | sed 's/^/  /'
        done

        # Warning if multiple agents
        local count=$(echo "$all_pids" | wc -w)
        if [ "$count" -gt 1 ]; then
            echo ""
            echo "⚠️  WARNING: Multiple agent processes detected!"
            echo "This may cause jobs to be processed by different agents."
            echo "Run '$0 restart' to ensure only one agent is running."
        fi
    fi

    echo ""
    echo "Logs directory: $LOG_DIR"
    echo "Current log: $CURRENT_LOG"
}

# Function to tail logs
tail_logs() {
    if [ ! -f "$CURRENT_LOG" ]; then
        echo "No log file found at: $CURRENT_LOG"
        return 1
    fi

    echo "Tailing agent logs (Ctrl+C to stop)..."
    echo "File: $CURRENT_LOG"
    echo ""
    tail -f "$CURRENT_LOG"
}

# Function to show recent logs
show_logs() {
    local lines="${1:-50}"

    if [ ! -f "$CURRENT_LOG" ]; then
        echo "No log file found at: $CURRENT_LOG"
        return 1
    fi

    echo "Last $lines lines from agent log:"
    echo "File: $CURRENT_LOG"
    echo ""
    tail -n "$lines" "$CURRENT_LOG"
}

# Main command handling
case "${1:-status}" in
    start)
        start_agent
        ;;
    stop)
        stop_agent
        ;;
    restart)
        echo "Restarting agent..."
        kill_all_agents  # Kill ALL agents, not just the tracked one
        sleep 2
        start_agent
        ;;
    status)
        show_status
        ;;
    logs)
        tail_logs
        ;;
    show-logs)
        show_logs "${2:-50}"
        ;;
    kill-all)
        kill_all_agents
        ;;
    *)
        echo "Ralph Agent Monitor"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  start       Start the agent (fails if already running)"
        echo "  stop        Stop the agent gracefully"
        echo "  restart     Kill all agents and start fresh"
        echo "  status      Show agent status and recent activity"
        echo "  logs        Tail agent logs in real-time"
        echo "  show-logs   Show recent logs (default: 50 lines)"
        echo "  kill-all    Kill all agent processes (use when stuck)"
        echo ""
        echo "Examples:"
        echo "  $0 start                # Start the agent"
        echo "  $0 status               # Check if agent is running"
        echo "  $0 logs                 # Watch live logs"
        echo "  $0 show-logs 100        # Show last 100 log lines"
        echo "  $0 restart              # Fresh start (kills any zombies)"
        echo ""
        exit 1
        ;;
esac
