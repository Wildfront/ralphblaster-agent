#!/bin/bash
# Ralph Agent Dashboard - Live monitoring of agent activity

LOG_DIR="$HOME/.ralph-agent-logs"
CURRENT_LOG="$LOG_DIR/agent-$(date +%Y%m%d).log"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Clear screen and hide cursor
clear
tput civis

# Restore cursor on exit
trap 'tput cnorm; exit' INT TERM

# Function to draw header
draw_header() {
    echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║${NC}            ${BOLD}Ralph Agent Activity Dashboard${NC}                 ${BOLD}${CYAN}║${NC}"
    echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Function to show agent status
show_agent_status() {
    local pid_file="$LOG_DIR/agent.pid"

    echo -e "${BOLD}Agent Status:${NC}"
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            local uptime=$(ps -p "$pid" -o etime= | tr -d ' ')
            echo -e "  ${GREEN}●${NC} Running (PID: ${pid}, Uptime: ${uptime})"
        else
            echo -e "  ${RED}●${NC} Not running (stale PID file)"
        fi
    else
        echo -e "  ${RED}●${NC} Not running"
    fi

    # Check for multiple agents
    local all_agents=$(pgrep -f "ralphblaster.js" | wc -l)
    if [ "$all_agents" -gt 1 ]; then
        echo -e "  ${YELLOW}⚠${NC}  Warning: ${all_agents} agent processes detected!"
    fi
    echo ""
}

# Function to show recent jobs (extracted from logs)
show_recent_jobs() {
    echo -e "${BOLD}Recent Jobs (last 5):${NC}"

    if [ ! -f "$CURRENT_LOG" ]; then
        echo "  No log file found"
        return
    fi

    # Extract job claims from logs
    grep "Claimed job" "$CURRENT_LOG" | tail -5 | while read -r line; do
        # Parse job ID and title
        if [[ $line =~ \#([0-9]+)\ -\ (.+)$ ]]; then
            local job_id="${BASH_REMATCH[1]}"
            local job_title="${BASH_REMATCH[2]}"
            local timestamp=$(echo "$line" | grep -oE '\[.*?\]' | head -1 | tr -d '[]')

            # Check if it's a PRD job
            if grep -q "🔴.*#${job_id}" "$CURRENT_LOG"; then
                echo -e "  ${MAGENTA}📄 PRD${NC} Job #${job_id}: ${job_title:0:50}..."
            else
                echo -e "  ${BLUE}💻 Code${NC} Job #${job_id}: ${job_title:0:50}..."
            fi
            echo -e "     ${timestamp}"
        fi
    done

    if ! grep -q "Claimed job" "$CURRENT_LOG"; then
        echo "  (No jobs processed yet)"
    fi
    echo ""
}

# Function to show live activity
show_live_activity() {
    echo -e "${BOLD}Live Activity (last 10 seconds):${NC}"

    if [ ! -f "$CURRENT_LOG" ]; then
        echo "  No log file found"
        return
    fi

    # Get logs from last 10 seconds
    local cutoff=$(date -u -v-10S +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -u -d "10 seconds ago" +"%Y-%m-%dT%H:%M:%S")

    local recent_activity=$(awk -v cutoff="$cutoff" '
        $0 ~ /\[.*\]/ {
            match($0, /\[([^\]]+)\]/, ts)
            if (ts[1] >= cutoff) print
        }
    ' "$CURRENT_LOG" | tail -8)

    if [ -z "$recent_activity" ]; then
        echo -e "  ${YELLOW}⏸${NC}  Waiting for jobs..."
    else
        echo "$recent_activity" | while read -r line; do
            # Color-code different activities
            if [[ $line =~ "Claimed job" ]]; then
                echo -e "  ${GREEN}→${NC} ${line}"
            elif [[ $line =~ "Executing" ]]; then
                echo -e "  ${BLUE}⚙${NC}  ${line}"
            elif [[ $line =~ "completed" ]]; then
                echo -e "  ${GREEN}✓${NC} ${line}"
            elif [[ $line =~ "failed\|error" ]]; then
                echo -e "  ${RED}✗${NC} ${line}"
            else
                echo "    ${line}"
            fi
        done
    fi
    echo ""
}

# Function to show statistics
show_statistics() {
    if [ ! -f "$CURRENT_LOG" ]; then
        return
    fi

    echo -e "${BOLD}Today's Statistics:${NC}"

    local total_jobs=$(grep -c "Claimed job" "$CURRENT_LOG" 2>/dev/null || echo 0)
    local prd_jobs=$(grep -c "🔴🔴🔴 PRD" "$CURRENT_LOG" 2>/dev/null || echo 0)
    local code_jobs=$((total_jobs - prd_jobs))
    local completed=$(grep -c "completed successfully" "$CURRENT_LOG" 2>/dev/null || echo 0)
    local errors=$(grep -c -E "failed|ERROR" "$CURRENT_LOG" 2>/dev/null || echo 0)

    echo "  Total jobs: ${total_jobs}"
    echo "  ├─ PRD generation: ${prd_jobs}"
    echo "  └─ Code execution: ${code_jobs}"
    echo ""
    echo "  Completed: ${GREEN}${completed}${NC}"
    echo "  Errors: ${RED}${errors}${NC}"
    echo ""
}

# Main dashboard loop
while true; do
    clear
    draw_header
    show_agent_status
    show_statistics
    show_recent_jobs
    show_live_activity

    echo -e "${CYAN}Press Ctrl+C to exit${NC}"
    echo ""
    echo -e "Logs: ${CURRENT_LOG}"
    echo -e "Refreshing in 5 seconds..."

    sleep 5
done
