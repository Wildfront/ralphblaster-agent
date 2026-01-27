# Ralph Blaster Agent Logging System Overview

## Three Distinct Logging Systems

Ralph Blaster Agent uses three separate logging systems, each optimized for a specific purpose:

### 1. Instance Setup Logs (Application Logging)
**Purpose:** Server-side structured logs for debugging and monitoring agent operations

**Source:** Application code via `logger.info()`, `logger.error()`, etc.

**Destination:** API endpoint `/api/v1/ralphblaster/jobs/:id/setup_log` (batched)

**What it logs:**
- Job lifecycle events ("Job started", "Marking as completed")
- High-level operation status ("Creating worktree", "Running Claude")
- Performance metrics and timings
- Error conditions and warnings

**Features:**
- Structured metadata for machine-readable logs
- Multiple log levels (error, warn, info, debug)
- Batched to API (10 logs → 1 API call)
- Child loggers with context propagation
- Performance tracking with timers
- Security-first with automatic redaction

**Documentation:** [docs/LOGGING.md](./LOGGING.md)

**Use Case:** Debugging agent issues, monitoring system health, audit trail

---

### 2. Live Progress (Claude CLI Output)
**Purpose:** Real-time terminal output from Claude Code execution

**Source:** Raw stdout from `claude` CLI process

**Destination:** API endpoint `/api/v1/ralphblaster/jobs/:id/progress` (streamed)

**What it shows:**
```
Reading src/app.js...
Editing src/utils/helper.js
Adding 3 files to git...
Running tests...
✓ All tests passed
Committing changes...
✓ Changes committed successfully
```

**Features:**
- **Raw terminal output** - exactly what you'd see running `claude` locally
- **No parsing** - no JSON, no event detection, no formatting
- **Real-time streaming** - chunks sent as they're generated
- **Simplified implementation** - removed ~500 lines of complex code

**Implementation:**
```javascript
// Before (complex JSON parsing)
spawn('claude', ['--print', '--output-format', 'stream-json', '--verbose', ...])
// Parse JSON events, extract results, detect patterns, format output

// After (simple raw streaming)
spawn('claude', ['--print', '--permission-mode', 'acceptEdits'])
// Just accumulate and stream raw terminal output
```

**Documentation:** This document

**Use Case:** Watching Claude work in real-time, debugging execution issues, seeing detailed progress

---

### 3. Activity Timeline (Milestone Tracking)
**Purpose:** High-level milestone tracking with progress percentages

**Source:** Application code via `apiClient.sendStatusEvent()`

**Destination:** API endpoint `/api/v1/ralphblaster/jobs/:id/events`

**What it shows:**
```
✓ Job claimed: "Make dark mode look beautiful"
  5% - Setting up workspace...
  10% - Worktree ready at blaster/ticket-145/job-1428
  15% - Claude started: Analyzing and executing...
  [heartbeat] Still working... (2m 18s elapsed)
  [heartbeat] Still working... (3m 18s elapsed)
  95% - Finalizing...
  100% - Task completed successfully
```

**Features:**
- **Progress percentages** for UI progress bars
- **Elapsed time tracking** via heartbeats every 60s
- **Major milestone markers** (setup complete, Claude started, job complete)
- **Structured events** with metadata

**Event Types:**
- `setup_started` - "Setting up workspace..."
- `git_operations` - "Creating Git worktree...", "Worktree ready"
- `claude_started` - "Claude is analyzing and executing..."
- `progress_update` - With percentage metadata (5%, 10%, 15%, 95%, 100%)
- `job_completed` - "Task completed successfully"
- `heartbeat` - "Still working... (Xm Ys elapsed)"

**Documentation:** [docs/LOGGING_SIMPLIFICATION.md](./LOGGING_SIMPLIFICATION.md)

**Use Case:** Quick status overview without reading terminal output, UI progress bars, mobile-friendly status display

---

## Comparison Matrix

| Feature | Instance Setup Logs | Live Progress | Activity Timeline |
|---------|---------------------|---------------|-------------------|
| **Purpose** | Agent debugging | Watch Claude work | Status overview |
| **Detail Level** | Medium (operations) | Very high (every line) | Low (milestones) |
| **Format** | Structured JSON | Raw terminal text | Structured events |
| **Update Frequency** | Batched every 2s | Real-time (every chunk) | Discrete milestones |
| **Progress %** | ❌ No | ❌ No | ✅ Yes |
| **Elapsed Time** | ❌ No | ❌ No | ✅ Yes |
| **Scannability** | Medium | Low (verbose) | High (key events) |
| **Debugging** | Good (agent issues) | Excellent (execution) | Poor (too high-level) |
| **User Overview** | Poor (too technical) | Poor (too detailed) | Excellent (at a glance) |

---

## Simplification Changes (January 2026)

### What We Removed
1. **`--output-format stream-json` flag** - Claude now outputs raw terminal format
2. **JSON parsing** (~200 lines) - No more event parsing, lineBuffer, finalResult extraction
3. **EventDetector class** (~150 lines) - No pattern-based event detection from output
4. **Event formatting** (~80 lines) - logClaudeEvent, formatEventForUI methods
5. **Hook formatting test** (entire file) - No longer needed

### What We Kept
1. **Activity Timeline** (sendStatusEvent) - Provides distinct value for milestone tracking
2. **Instance Setup Logs** (logger.info/error) - Application-level debugging
3. **Live Progress streaming** - Simplified to raw terminal output

### Result
- **Live Progress** = Simple raw terminal output (exactly what you see locally)
- **Activity Timeline** = High-level milestones (progress %, elapsed time, phases)
- **Instance Setup Logs** = Application logging (debugging, monitoring)

Three clear, distinct purposes. No redundancy. Much simpler implementation.

---

## Architecture Diagrams

### Live Progress Flow (Simplified)
```
User submits task
       ↓
Agent spawns claude CLI
       ↓
  claude process
       ↓
  Raw stdout
   (terminal output)
       ↓
Stream to UI in real-time
       ↓
User sees terminal output
```

### Activity Timeline Flow
```
Agent starts job
       ↓
Send "setup_started" event (5%)
       ↓
Send "git_operations" events (10%)
       ↓
Send "claude_started" event (15%)
       ↓
Send heartbeats every 60s
       ↓
Send "finalizing" event (95%)
       ↓
Send "job_completed" event (100%)
       ↓
User sees progress bar & milestones
```

### Instance Setup Logs Flow
```
Application code
       ↓
logger.info('message', metadata)
       ↓
    LogManager
       ↓   ↓   ↓
Console File API
       ↓
   Batcher (buffers)
       ↓
API endpoint
       ↓
UI: "Instance Setup Logs" section
```

---

## When to Use Which

### Use Instance Setup Logs When:
- ✅ Logging from application code
- ✅ Need structured metadata
- ✅ Debugging agent-level issues
- ✅ Tracking performance metrics
- ✅ Recording errors and warnings

```javascript
logger.info('Worktree created', {
  path: '/path/to/worktree',
  duration: 3200,
  branch: 'feature/123'
});
```

### Use Live Progress When:
- ✅ Showing Claude's real-time execution
- ✅ User wants to see exactly what's happening
- ✅ Debugging Claude execution issues
- ✅ Watching tools being called (Read, Write, Bash, etc.)

**Note:** You don't need to do anything - it's automatic when Claude runs.

### Use Activity Timeline When:
- ✅ Showing execution phase (setup → running → finalizing)
- ✅ Displaying progress percentage
- ✅ Updating status for user (heartbeats)
- ✅ Marking major milestones

```javascript
await this.apiClient.sendStatusEvent(
  job.id,
  'progress_update',
  'Workspace ready',
  { percentage: 10 }
);
```

---

## Configuration

### Instance Setup Logs
```bash
export RALPHBLASTER_LOG_LEVEL=debug           # error|warn|info|debug
export RALPHBLASTER_CONSOLE_FORMAT=pretty     # pretty|json
export RALPHBLASTER_CONSOLE_COLORS=true       # true|false
export RALPHBLASTER_MAX_BATCH_SIZE=10         # Logs to batch
export RALPHBLASTER_FLUSH_INTERVAL=2000       # Flush interval (ms)
```

### Live Progress
No configuration needed - automatically streams raw Claude output.

### Activity Timeline
No configuration needed - sendStatusEvent calls are hardcoded in job handlers.

---

## For New Developers

### Adding New Log Statements

**For application logging:**
```javascript
const logger = require('./logger');
logger.info('Operation completed', { duration: 1500 });
```

**For Activity Timeline milestones:**
```javascript
await this.apiClient.sendStatusEvent(
  job.id,
  'new_milestone',
  'Description of milestone',
  { metadata: 'optional' }
);
```

**For Live Progress:**
Nothing needed - it's automatic from Claude CLI output.

### Common Pitfalls

1. **Don't log to Activity Timeline from inside Claude execution** - It's for high-level phases only
2. **Don't try to parse Live Progress** - It's raw terminal output, not structured data
3. **Don't forget to set job context** - `logger.setJobContext()` enables API logging

---

## Summary

Ralph Blaster Agent's three-tier logging system provides:

1. **Instance Setup Logs** - Technical debugging for developers
2. **Live Progress** - Real-time execution visibility for users
3. **Activity Timeline** - Quick status overview for at-a-glance progress

Each serves a distinct purpose, with no overlap or redundancy. The recent simplification removed complex JSON parsing while preserving all three systems' unique value propositions.
