#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [max_iterations]

set -e

MAX_ITERATIONS=${1:-10}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

# Worktree configuration - auto-detect git repository
# Navigate up from instance directory to find git root
CURRENT_DIR="$SCRIPT_DIR"
while [ "$CURRENT_DIR" != "/" ]; do
  if [ -d "$CURRENT_DIR/.git" ] || git -C "$CURRENT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    MAIN_REPO_PATH="$(cd "$CURRENT_DIR" && git rev-parse --show-toplevel)"
    break
  fi
  CURRENT_DIR="$(dirname "$CURRENT_DIR")"
done

if [ -z "$MAIN_REPO_PATH" ]; then
  echo "Error: Could not find git repository. Ralph instances must be within a git repository."
  exit 1
fi

# Derive worktree parent directory (sibling to repo)
REPO_NAME="$(basename "$MAIN_REPO_PATH")"
REPO_PARENT="$(dirname "$MAIN_REPO_PATH")"
WORKTREE_PARENT="$REPO_PARENT/${REPO_NAME}-worktrees"
WORKTREE_PATH_FILE="$SCRIPT_DIR/.worktree-path"

# Setup worktree for the branch specified in prd.json
setup_worktree() {
  local branch_name="$1"

  if [ -z "$branch_name" ]; then
    echo "Error: No branch name provided to setup_worktree"
    return 1
  fi

  # If RALPH_WORKTREE_PATH is set and valid, use it
  if [ -n "$RALPH_WORKTREE_PATH" ] && [ -d "$RALPH_WORKTREE_PATH" ]; then
    if git -C "$RALPH_WORKTREE_PATH" rev-parse --git-dir >/dev/null 2>&1; then
      echo "✓ Using provided worktree: $RALPH_WORKTREE_PATH"
      echo "$RALPH_WORKTREE_PATH" > "$WORKTREE_PATH_FILE"
      export RALPH_WORKTREE_PATH
      return 0
    fi
  fi

  # Fall back to calculating worktree path (existing logic)
  # Derive worktree path (strip ralph/ prefix if present)
  local worktree_name=$(echo "$branch_name" | sed 's|^ralph/||')
  local worktree_path="$WORKTREE_PARENT/$worktree_name"

  # Create parent directory if it doesn't exist
  mkdir -p "$WORKTREE_PARENT"

  # Check if worktree already exists
  if [ -d "$worktree_path" ]; then
    # Verify it's a valid git worktree
    if git -C "$worktree_path" rev-parse --git-dir >/dev/null 2>&1; then
      echo "✓ Using existing worktree: $worktree_path"
      echo "$worktree_path" > "$WORKTREE_PATH_FILE"
      return 0
    else
      echo "⚠ Invalid worktree found, removing: $worktree_path"
      rm -rf "$worktree_path"
    fi
  fi

  # Create new worktree
  echo "Creating worktree for branch: $branch_name"
  cd "$MAIN_REPO_PATH"

  # Check if branch exists
  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    # Branch exists, checkout to worktree
    git worktree add "$worktree_path" "$branch_name"
  else
    # Branch doesn't exist, create from main
    git worktree add "$worktree_path" -b "$branch_name" main
  fi

  if [ $? -eq 0 ]; then
    echo "✓ Worktree created: $worktree_path"
    echo "$worktree_path" > "$WORKTREE_PATH_FILE"
    return 0
  else
    echo "✗ Failed to create worktree"
    return 1
  fi
}

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")
  
  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip "ralph/" prefix from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"
    
    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"
    
    # Reset progress file for new run
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# Setup worktree before starting iterations
if [ -f "$PRD_FILE" ]; then
  BRANCH_NAME=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$BRANCH_NAME" ]; then
    setup_worktree "$BRANCH_NAME"
    if [ $? -ne 0 ]; then
      echo "Failed to setup worktree"
      exit 1
    fi
  else
    echo "Error: No branchName found in prd.json"
    exit 1
  fi
else
  echo "Error: prd.json not found at $PRD_FILE"
  exit 1
fi

# Export environment variables for Claude
WORKTREE_PATH=$(cat "$WORKTREE_PATH_FILE" 2>/dev/null || echo "")
if [ -z "$WORKTREE_PATH" ]; then
  echo "Error: Worktree path not found"
  exit 1
fi

export RALPH_WORKTREE_PATH="$WORKTREE_PATH"
export RALPH_INSTANCE_DIR="$SCRIPT_DIR"
export RALPH_MAIN_REPO="$MAIN_REPO_PATH"

echo "Starting Ralph - Max iterations: $MAX_ITERATIONS"
echo "Worktree: $RALPH_WORKTREE_PATH"
echo "Instance: $RALPH_INSTANCE_DIR"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Ralph Iteration $i of $MAX_ITERATIONS"
  echo "═══════════════════════════════════════════════════════"
  echo "Started: $(date '+%H:%M:%S')"
  echo ""
  echo "💬 Executing Claude..."
  echo ""

  # Start tailing progress file in background to show real-time updates
  if [ -f "$PROGRESS_FILE" ]; then
    # Get current line count to show only new additions
    PROGRESS_LINES_BEFORE=$(wc -l < "$PROGRESS_FILE" 2>/dev/null || echo "0")
    tail -f "$PROGRESS_FILE" &
    TAIL_PID=$!
  fi

  # Run claude with the ralph prompt from the instance directory
  # Use --continue for iterations after the first to maintain context
  # Use stdbuf to unbuffer output for real-time visibility
  if [ "$i" -eq 1 ]; then
    OUTPUT=$(cd "$SCRIPT_DIR" && cat prompt.md | stdbuf -oL -eL claude --dangerously-skip-permissions 2>&1 | tee /dev/stderr) || true
  else
    OUTPUT=$(cd "$SCRIPT_DIR" && cat prompt.md | stdbuf -oL -eL claude --dangerously-skip-permissions --continue 2>&1 | tee /dev/stderr) || true
  fi

  # Stop tailing progress file
  if [ -n "$TAIL_PID" ]; then
    kill $TAIL_PID 2>/dev/null || true
    wait $TAIL_PID 2>/dev/null || true
  fi

  # Check for completion signal
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "✅ Ralph completed all tasks!"
    echo "Completed at iteration $i of $MAX_ITERATIONS ($(date '+%H:%M:%S'))"
    exit 0
  fi

  echo ""
  echo "✓ Iteration $i complete at $(date '+%H:%M:%S')"

  # Show progress summary from this iteration
  if [ -f "$PROGRESS_FILE" ]; then
    PROGRESS_LINES_AFTER=$(wc -l < "$PROGRESS_FILE" 2>/dev/null || echo "0")
    NEW_LINES=$((PROGRESS_LINES_AFTER - PROGRESS_LINES_BEFORE))
    if [ "$NEW_LINES" -gt 0 ]; then
      echo ""
      echo "📝 Progress update ($NEW_LINES new lines in $PROGRESS_FILE):"
      echo "---"
      tail -n "$NEW_LINES" "$PROGRESS_FILE" | head -20
      if [ "$NEW_LINES" -gt 20 ]; then
        echo "... (showing last 20 of $NEW_LINES new lines)"
      fi
      echo "---"
    fi
  fi

  echo "Continuing in 2 seconds..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
