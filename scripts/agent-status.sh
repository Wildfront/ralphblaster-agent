#!/bin/bash
# Check status of all running agents
# Based on ralph-status.sh pattern

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$SCRIPT_DIR/.agent-pids"
LOG_DIR="$PROJECT_DIR/logs"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Ralph Agent Status Dashboard${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

if [ ! -f "$PID_FILE" ]; then
  echo -e "${YELLOW}No agents currently running${NC}"
  echo ""
  echo -e "${BLUE}To start agents: ./scripts/start-agents.sh [count]${NC}"
  exit 0
fi

running_count=0
dead_count=0

printf "%-15s %-10s %-10s %s\n" "AGENT ID" "STATUS" "PID" "LAST LOG ENTRY"
echo "────────────────────────────────────────────────────────────────────────────────"

while IFS='|' read -r agent_id pid; do
  log_file="$LOG_DIR/$agent_id.log"

  if kill -0 "$pid" 2>/dev/null; then
    status="${GREEN}RUNNING${NC}"
    ((running_count++))

    if [ -f "$log_file" ]; then
      # Get last log entry and truncate to 60 chars
      last_line=$(tail -1 "$log_file" 2>/dev/null | cut -c1-60)
      if [ -z "$last_line" ]; then
        last_line="(log file empty)"
      fi
    else
      last_line="(no log file)"
    fi

    printf "%-15s ${status}   %-10s %s\n" "$agent_id" "$pid" "$last_line"
  else
    status="${RED}DEAD${NC}"
    ((dead_count++))
    printf "%-15s ${status}      %-10s %s\n" "$agent_id" "$pid" "Process not running"
  fi
done < "$PID_FILE"

echo ""
echo -e "${BLUE}Summary:${NC} Running: ${GREEN}$running_count${NC} | Dead: ${RED}$dead_count${NC}"
echo ""

if [ $running_count -gt 0 ]; then
  echo -e "${BLUE}Commands:${NC}"
  echo "  Follow specific agent: tail -f $LOG_DIR/agent-1.log"
  echo "  Follow all agents:     tail -f $LOG_DIR/agent-*.log"
  echo "  Monitor continuously:  watch -n 5 ./scripts/agent-status.sh"
  echo "  Stop all agents:       pkill -f 'RALPH_AGENT_ID=agent-'"
  echo ""
fi

# Show warning if any agents are dead
if [ $dead_count -gt 0 ]; then
  echo -e "${YELLOW}Warning: Some agents have died. Check their logs for errors.${NC}"
  echo -e "${YELLOW}To restart: stop all agents and run ./scripts/start-agents.sh${NC}"
  echo ""
fi
