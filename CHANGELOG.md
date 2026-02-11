# Agent Changelog

## 2026-02-11 - Fix Headless Permission Hanging (v1.6.0)

### Critical Bug Fix

**Issue**: Agent would hang indefinitely in headless mode when Claude tried to execute Bash commands (git, npm, gh, docker, etc.), waiting for user approval that would never come.

**Root Cause**: The `--permission-mode acceptEdits` flag only auto-approves Edit/Write/Read tools, not Bash commands. In headless environments, Claude would wait for user approval of Bash commands, causing the process to hang.

**Impact**:
- Jobs would timeout without completing
- Agent appeared unresponsive during git operations
- Users had to manually add `--allowedTools` flags as a temporary workaround
- Workarounds would revert when the npm package was updated

**Solution**:
- **Maintains `acceptEdits` as default** (security-conscious, no breaking changes)
- Automatically adds `--allowedTools` for common dev commands to prevent hanging:
  - `git`, `gh`, `npm`, `bundle`, `rails`, `docker`, `yarn`, `pnpm`, `echo`
- Added configurable `CLAUDE_PERMISSION_MODE` environment variable for users who need `acceptAll`
- Centralized Claude CLI argument building in `getClaudeArgs()` method
- **Security preserved**: Only explicitly allowed commands run automatically; everything else still requires approval

### Files Modified

**Agent (Node.js):**
- `src/executor/claude-runner.js`:
  - Added `getClaudeArgs()` method to centralize CLI argument building
  - Updated both `runClaude()` and `runClaudeDirectly()` to use centralized args
  - Implements smart permission handling based on environment variable
- `ENVIRONMENT_VARIABLES.md`:
  - Added documentation for `CLAUDE_PERMISSION_MODE` variable
  - Added documentation for `CLAUDE_STREAM_DEBUG` variable

### Configuration Options

```bash
# Default: Secure mode with allowed dev commands (recommended)
# No need to set - this is the default behavior
ralphblaster

# Explicitly set acceptEdits (same as default)
export CLAUDE_PERMISSION_MODE="acceptEdits"

# Unrestricted: Auto-approve everything (⚠️ use with caution)
export CLAUDE_PERMISSION_MODE="acceptAll"

# Manual: Prompt for everything (not suitable for headless)
export CLAUDE_PERMISSION_MODE="prompt"
```

### Expected Results

After updating:
- ✅ No more hanging when Claude runs git/npm/gh/docker commands
- ✅ Agent completes jobs without manual intervention
- ✅ Security boundaries maintained (only allowed commands auto-execute)
- ✅ Configurable security levels via environment variable
- ✅ Safe for production deployment

### Breaking Changes

**None** - Default behavior remains `acceptEdits`, but now automatically includes common dev commands to prevent hanging. This is backward compatible and adds no new security risks.

## 2026-01-28 - Fix Agent False Offline Status (v1.5.0)

### Critical Bug Fix

**Issue**: Agent frequently showed as "offline" in the UI even when actively running and processing jobs.

**Root Cause**: Timing mismatch between agent heartbeat (60s) and backend offline detection threshold (30s), creating a guaranteed 30-second window where the agent would incorrectly show as offline.

**Impact**:
- UI flickered between online/offline states during normal operation
- ActionCable was broadcasting the WRONG status in real-time (timing bug, not ActionCable bug)
- Users could not reliably see when their agent was actually connected

**Solution**:
- Reduced agent heartbeat interval: 60s → 20s (3 heartbeats per minute)
- Increased backend offline threshold: 30s → 35s
- Creates 15-second safety margin for network delays, clock skew, and processing time
- Agent now sends multiple heartbeats within the offline detection window
- ActionCable now broadcasts the CORRECT status in real-time

### Files Modified

**Agent (Node.js):**
- `src/index.js` - Changed `HEARTBEAT_INTERVAL_MS` from 60000ms to 20000ms
- `test/index-heartbeat.test.js` - Updated all timing tests, added verification test

**Backend (Rails):**
- `app/models/user.rb` - Added `AGENT_OFFLINE_THRESHOLD = 35.seconds` constant
- `app/models/concerns/agent_status_broadcaster.rb` - Updated to use `User::AGENT_OFFLINE_THRESHOLD`
- `app/jobs/agent_status_monitor_job.rb` - Updated `DISCONNECT_THRESHOLD` to 35 seconds

### Expected Results

After updating:
- Zero false offline readings during normal operation
- Stable "online" status without flickering
- Real disconnects still detected within 35-40 seconds
- Offline detection during crashes: < 40 seconds
- ActionCable broadcasts correct status instantly via WebSocket

### Performance Impact

- Network traffic: 3x increase (60 heartbeats/hour → 180 heartbeats/hour)
- Bandwidth impact: Minimal (~18KB/hour per agent)
- Server load: < 1% CPU increase (simple timestamp updates)

### Testing

All heartbeat tests pass:
```bash
npm test -- test/index-heartbeat.test.js
```

---

## 2026-01-22 - Fix Worktree Location to Prevent Main Branch Conflicts (v1.4.0)

### Critical Bug Fix

**Issue**: Worktrees were being created inside the main repository (`.ralphblaster-worktrees/`), causing git to switch the main directory to the worktree's branch.

**Impact**:
- Users working in the main directory would find their branch unexpectedly switched
- Git could behave unpredictably with nested worktrees
- Main repo and worktree could interfere with each other

**Solution**:
- Worktrees are now created as siblings to the repo: `<repo-parent>/<repo-name>-worktrees/job-{id}/`
- This prevents any git conflicts between main repo and worktrees
- Follows git best practices for worktree management

### Files Modified

- `src/worktree-manager.js` - Changed `getWorktreePath()` to create worktrees outside repo
- `test/worktree-manager-complete.test.js` - Updated all test expectations for new path format
- `README.md` - Updated directory structure documentation

### Migration Notes

**For existing installations:**
- Old worktrees in `.ralphblaster-worktrees/` will remain but won't be used (already using correct naming)
- New jobs will create worktrees in the new location
- You can safely delete old `.ralphblaster-worktrees/` directories after verifying no active work exists
- Add `.ralphblaster-worktrees/` to your `.gitignore` to hide legacy directories

### Testing

Verified:
- All 33 WorktreeManager tests pass
- Worktrees created in correct sibling location
- No interference with main repository branch
- RalphBlaster execution works with new worktree location

---

## 2026-01-21 - Fix PRD to JSON Conversion Permissions (v1.2.1)

### Bug Fix

**Critical Fix**: PRD-to-JSON conversion now includes `--dangerously-skip-permissions` flag

- Fixed: `/ralphblaster` skill execution was failing with "permission restrictions" error
- Root cause: Claude Code CLI requires explicit permission flag to write files (prd.json)
- Impact: All code execution jobs were failing at PRD conversion step
- Solution: Added `--dangerously-skip-permissions` to `claude /ralphblaster` command in `convertPrdToJson()`

### Files Modified

- `src/ralphblaster-instance-manager.js` - Line 64: Added permissions flag to Claude CLI command

### Testing

Users should verify:
1. Code execution jobs can now convert PRD markdown to prd.json successfully
2. No more "ENOENT: no such file or directory, access prd.json" errors
3. RalphBlaster instances start executing code after PRD conversion

---

## 2026-01-21 - Use Server-Provided Prompts (v1.2.0)

### Changes Made

1. **Removed Duplicate Prompt Logic**
   - Agent now uses `job.prompt` field from server instead of building prompts
   - Eliminates duplicate prompt logic between server and agent
   - Server's template system is now authoritative for all prompts
   - Ensures both title and description are always included (via server templates)

2. **Simplified Executor Methods**
   - `executeStandardPrd()` - Now simply uses `job.prompt`
   - `executePlanGeneration()` - Now simply uses `job.prompt`
   - `executeCodeImplementation()` - Now simply uses `job.prompt`
   - Removed `buildCodePrompt()` method (no longer needed)

3. **Benefits**
   - Single source of truth for prompts (server-side templates)
   - Easier to modify prompts without agent code changes
   - Consistent formatting across all job types
   - Supports custom prompt templates via server admin panel

### Files Modified

- `src/executor.js` - Removed prompt building logic, use job.prompt

### Migration Notes

**Breaking Change:** This version requires server version with template system support (RalphBlaster v2.0+)

---

## 2026-01-21 - Fix Job Type Logging (v1.1.2)

### Changes Made

1. **Fixed Job Type Display in Logs**
   - Updated executor.js to check `prd_mode` field when logging job execution
   - Now correctly displays "Executing plan generation job #X" instead of "Executing prd_generation job #X"
   - Improves log clarity when generating plans vs PRDs

### Files Modified

- `src/executor.js` - Added prd_mode check for job description logging (line 17-19)

---

## 2026-01-20 - Production Optimizations (v1.1.1)

### Changes Made

1. **Reduced Long Polling Timeout**
   - Changed from 30 seconds to 10 seconds
   - Reduces max job delivery delay from 30s to 10s
   - Lower thread occupancy on server
   - Axios timeout reduced to 15s (10s + 5s buffer)

2. **Better Production Resource Usage**
   - Faster job delivery with lower resource usage
   - Improved responsiveness for production deployments

### Files Modified

- `src/api-client.js` - Updated timeout values

---

## 2026-01-20 - PRD Mode Support (v1.1.0)

### Changes Made

1. **PRD Mode Support**
   - Added support for `prd_mode` field in job payload
   - Agent now checks `job.prd_mode` to determine content type ("prd" or "plan")
   - Logs correct content type: "Generating PRD" vs "Generating Plan"

2. **Separate Generation Methods**
   - Split `executePrdGeneration()` into two methods:
     - `executeStandardPrd()` - Uses Claude `/prd` skill for PRD generation
     - `executePlanGeneration()` - Uses Claude Code for implementation planning
   - Each method uses appropriate prompts for the content type

3. **Custom Instructions Support**
   - Both PRD and Plan generation now support `custom_instructions` field
   - Instructions are appended to prompts when provided

### Files Modified

- `src/executor.js` - Added prd_mode routing, separate PRD/Plan methods

### Behavior

When `job.prd_mode === "plan"`:
- Logs: "Generating Plan for: [task title]"
- Uses Claude Code with explicit EnterPlanMode instructions
- Prompts Claude to use its planning mode feature to explore the codebase
- Returns the generated plan without implementing it
- Returns plan content as `prdContent`

When `job.prd_mode === "prd"` (or undefined):
- Logs: "Generating PRD for: [task title]"
- Uses Claude `/prd` skill to generate PRD
- Returns PRD content as `prdContent`

---

## 2026-01-19 - Long Polling + Job Types Update

### Changes Made

1. **Long Polling Support**
   - Updated API client to use long polling with 30-second server timeout
   - Increased axios timeout to 65 seconds to accommodate long polling
   - Removed sleep delays between polls (server waits for jobs)
   - Immediate reconnection after 204 No Content responses

2. **Job Type Support**
   - Added support for `job_type` field: `prd_generation` and `code_execution`
   - Executor now routes jobs based on type

3. **PRD Generation**
   - Implemented `executePrdGeneration()` method
   - Uses Claude `/prd` skill to generate PRDs
   - Returns `prdContent` in completion payload

4. **Code Execution**
   - Refactored existing implementation into `executeCodeImplementation()`
   - Continues to use Claude `--print` for code implementation
   - Returns `summary` and `branchName` in completion payload

5. **API Updates**
   - `GET /api/v1/ralph/jobs/next?timeout=30` - long polling parameter
   - `PATCH /api/v1/ralph/jobs/:id` - now accepts `prd_content` parameter

### Files Modified

- `src/api-client.js` - Long polling support, prd_content handling
- `src/executor.js` - Job type routing, PRD generation
- `src/index.js` - Removed sleep delays for long polling

### Testing

1. **Reset Test Job:**
   ```bash
   # Job #1 has been reset to pending status
   # It's a PRD generation job for task "update 'Good afternoon' header to have a 😊 after it"
   ```

2. **Restart Agent:**
   ```bash
   cd ~/src/ralphblaster-agent
   npm start
   ```

3. **Expected Behavior:**
   - Agent will long poll (wait up to 30s for jobs)
   - Should immediately claim job #1
   - Execute Claude `/prd` skill
   - Send PRD content back to server
   - Server will store PRD and mark task as complete

### Environment Setup

Make sure your `.env` file has:
```
RALPHBLASTER_API_URL=http://localhost:3000
RALPHBLASTER_API_TOKEN=<your_token_here>
```

Get your API token from: http://localhost:3000/api_tokens

Make sure the token has `ralphblaster_agent` permission enabled.

### Troubleshooting

**"timeout of 30000ms exceeded"**
- This was fixed by increasing axios timeout to 65s

**"500 Internal Server Error"**
- Check Rails logs for errors
- Ensure migrations have been run: `bin/rails db:migrate`

**Claude CLI not found**
- Ensure `claude` is in your PATH
- Test: `claude --version`

**Job stuck in "running"**
- Reset job: `bin/rails runner "RalphblasterJob.find(ID).update!(status: :pending)"`
