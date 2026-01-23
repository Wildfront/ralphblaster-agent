#!/bin/bash
# Start N agent processes with unique IDs
# Based on patterns from ralph-multi.sh

set -e

AGENT_COUNT=${1:-3}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$SCRIPT_DIR/.agent-pids"
LOG_DIR="$PROJECT_DIR/logs"

# Colors (from ralph-multi.sh)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Cleanup function (from ralph-multi.sh pattern)
cleanup() {
  echo -e "\n${YELLOW}Shutting down all agents...${NC}"
  if [ -f "$PID_FILE" ]; then
    while IFS='|' read -r agent_id pid; do
      if kill -0 "$pid" 2>/dev/null; then
        echo "  Stopping $agent_id (PID: $pid)"
        kill "$pid" 2>/dev/null || true
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo -e "${GREEN}All agents stopped${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

# Initialize
mkdir -p "$LOG_DIR"
> "$PID_FILE"

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Ralph Agent Multi-Process Manager${NC}"
echo -e "${BLUE}  Starting $AGENT_COUNT agent(s)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Check if node is available
if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is not installed or not in PATH${NC}"
  exit 1
fi

# Check if index.js exists
if [ ! -f "$PROJECT_DIR/src/index.js" ]; then
  echo -e "${RED}Error: src/index.js not found in $PROJECT_DIR${NC}"
  exit 1
fi

# Launch agents
for i in $(seq 1 $AGENT_COUNT); do
  AGENT_ID="agent-$i"
  LOG_FILE="$LOG_DIR/$AGENT_ID.log"

  > "$LOG_FILE"  # Clear previous log

  cd "$PROJECT_DIR"
  RALPH_AGENT_ID="$AGENT_ID" node src/index.js >> "$LOG_FILE" 2>&1 &
  PID=$!

  echo "$AGENT_ID|$PID" >> "$PID_FILE"
  echo -e "${GREEN}✓${NC} Started $AGENT_ID (PID: $PID, Log: $LOG_FILE)"
done

echo ""
echo -e "${BLUE}All agents launched. Press Ctrl+C to stop all agents${NC}"
echo -e "${BLUE}Monitor status: ./scripts/agent-status.sh${NC}"
echo -e "${BLUE}Tail logs: tail -f $LOG_DIR/agent-*.log${NC}"
echo ""

# Keep script running to catch Ctrl+C
wait
