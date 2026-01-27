# RalphBlaster Agent Rename Audit

This document catalogs all "ralph" references in the ralphblaster-agent codebase that need to be renamed to "ralphblaster" for brand consistency.

**Generated:** 2026-01-26

---

## Package Configuration

### `package.json`
- ✅ `"name": "ralphblaster"` - Already correct
- **Binary name:** `"ralphblaster": "bin/ralph-agent.js"` - Considers if CLI should be `ralphblaster-agent`
- ✅ Repository URLs already use "ralphblaster-agent"
- ✅ Description mentions "Ralph agent" - needs update to "RalphBlaster agent"
- **Scripts:** Consider if npm scripts should change

---

## Executable Files

### Files to Rename
- `bin/ralph-agent.js` → `bin/ralphblaster-agent.js` (or keep as-is since package is ralphblaster)

**Decision needed:** Should the CLI command be:
- `ralphblaster` (shorter, matches package name)
- `ralphblaster-agent` (more descriptive)

---

## Environment Variables

All environment variables use `RALPH_` prefix and should be updated to `RALPHBLASTER_`:

### Configuration (`src/config.js`)
- `RALPH_API_URL` → `RALPHBLASTER_API_URL`
- `RALPH_API_TOKEN` → `RALPHBLASTER_API_TOKEN`
- `RALPH_MAX_RETRIES` → `RALPHBLASTER_MAX_RETRIES`
- Error messages reference `RALPH_API_TOKEN`

### Executor (`src/executor/index.js`)
- `RALPH_ALLOWED_PATHS` → `RALPHBLASTER_ALLOWED_PATHS`

### Claude Runner (`src/executor/claude-runner.js`)
- Redacts `RALPH_API_TOKEN` in Claude settings
- `RALPH_WORKTREE_PATH` → `RALPHBLASTER_WORKTREE_PATH`
- `RALPH_INSTANCE_DIR` → `RALPHBLASTER_INSTANCE_DIR`
- `RALPH_MAIN_REPO` → `RALPHBLASTER_MAIN_REPO`

### Logging Configuration (`src/logging/config.js`)
- `RALPH_LOG_LEVEL` → `RALPHBLASTER_LOG_LEVEL`
- `RALPH_CONSOLE_COLORS` → `RALPHBLASTER_CONSOLE_COLORS`
- `RALPH_CONSOLE_FORMAT` → `RALPHBLASTER_CONSOLE_FORMAT`
- `RALPH_AGENT_ID` → `RALPHBLASTER_AGENT_ID`
- `RALPH_MAX_BATCH_SIZE` → `RALPHBLASTER_MAX_BATCH_SIZE`
- `RALPH_FLUSH_INTERVAL` → `RALPHBLASTER_FLUSH_INTERVAL`
- `RALPH_USE_BATCH_ENDPOINT` → `RALPHBLASTER_USE_BATCH_ENDPOINT`

### Additional Variables (from README)
- `RALPH_POLL_INTERVAL` → `RALPHBLASTER_POLL_INTERVAL`

**Total:** 13+ environment variables to rename

---

## API Endpoints

### Current Endpoints (`src/api-client.js` and elsewhere)
- `/api/v1/ralph/jobs/next` → `/api/v1/ralphblaster/jobs/next`
- `/api/v1/ralph/jobs/{id}` → `/api/v1/ralphblaster/jobs/{id}`
- Other ralph-namespaced endpoints

---

## Logging & Formatters

### `src/logging/formatter.js`
- Redaction pattern: `RALPH_API_TOKEN=[^\s&]+` → `RALPHBLASTER_API_TOKEN=[^\s&]+`
- Should maintain backward compatibility to also redact old `RALPH_API_TOKEN`

---

## Test Files

### Environment Variable Tests (`test/logging-config.test.js`)
- All `process.env.RALPH_*` references
- 30+ test references to RALPH_ variables

### Formatter Tests (`test/logging-formatter.test.js`)
- Tests for `RALPH_API_TOKEN` redaction

### Init Command Tests (`test/commands-init-complete.test.js`)
- Expects `export RALPH_API_TOKEN` in output

**Total:** 50+ test references to update

---

## Documentation Files

### `README.md`
**Title & Branding:**
- `# Ralph Agent` → `# RalphBlaster Agent`
- "Ralph Agent is a distributed..." → "RalphBlaster Agent is a distributed..."

**Features Section:**
- "polls the Ralph API" → "polls the RalphBlaster API"

**Installation:**
- `npm install -g ralph-agent` → `npm install -g ralphblaster` (or ralphblaster-agent)
- `cd ralph-agent` → `cd ralphblaster-agent`
- `npx ralph-agent` → `npx ralphblaster`
- `ralph-agent --token=...` → `ralphblaster --token=...`

**Environment Variables Table:**
- 13 entries with `RALPH_*` variables to update

**Configuration:**
- `.env` file example uses `RALPH_*` variables

**How It Works:**
- References to "Ralph autonomous agent"
- "Ralph Autonomous Agent Integration" section heading
- "Ralph Execution Limits" section heading
- "Advantages of Ralph Integration" section heading

**Logs:**
- `.ralph-logs/` → `.ralphblaster-logs/`

**Environment Variables in Execution:**
- `RALPH_WORKTREE_PATH` mentions
- `RALPH_INSTANCE_DIR` mentions
- `RALPH_MAIN_REPO` mentions

**API Token Creation:**
- "Log into your Ralph account" → "Log into your RalphBlaster account"
- "Ralph Agent Access" permission → "RalphBlaster Agent Access"

**Banner:**
- ASCII art: "Ralph Agent Starting..." → "RalphBlaster Agent Starting..."

### `AGENT_MONITORING.md`
- `# Ralph Agent Monitoring Guide` → `# RalphBlaster Agent Monitoring Guide`
- "Ralph agents can sometimes:" → "RalphBlaster agents can sometimes:"
- `.ralph-agent-logs/` → `.ralphblaster-agent-logs/`
- `bin/ralph-agent.js` → `bin/ralphblaster-agent.js`
- `cd /Users/macmartine/src/ralph-agent` → `.../ralphblaster-agent`
- `tmux new -s ralph-agent` → `tmux new -s ralphblaster-agent`
- Systemd service: `/etc/systemd/system/ralph-agent.service` → `.../ralphblaster-agent.service`
- Service description: "Description=Ralph Agent" → "Description=RalphBlaster Agent"

### `IMPLEMENTATION_SUMMARY.md`
- "Ralph's iteration-based approach" → "RalphBlaster's iteration-based approach"
- "const RalphInstanceManager" → "const RalphblasterInstanceManager"
- "Removed Ralph instance creation"
- "runRalphInstance()" references
- "Ralph-specific patterns" section
- "Before (Ralph Iteration):" section
- "No Ralph script, no instance directory"
- "Archive/delete Ralph skill files"

### `CHANGELOG.md`
- "Ralph execution works..." references
- "Ralph instances start executing..."
- "RalphBlaster v2.0+" → (already correct)
- "RalphJob.find(ID)" → "RalphblasterJob.find(ID)"

### `REFACTORING_SUMMARY.md`
- "Ralph Agent executor system" → "RalphBlaster Agent executor system"

### Other Documentation
- `CRITICAL_FIXES.md`
- `MULTI_AGENT_IMPLEMENTATION.md`
- `MULTI_AGENT_USAGE.md`
- `PHASE1-BACKEND-API-NEEDED.md`
- `PHASE2-BATCH-LOGGING.md`
- `PHASE3-STRUCTURED-LOGGING.md`
- `REFACTORING_VERIFICATION.md`

(Need to check these for ralph references)

---

## Git Branch Names

### Git References
- `.git/logs/refs/heads/ralph` - Old branch
- `.git/logs/refs/remotes/origin/ralph` - Old remote branch
- `.git/refs/heads/ralph` - Old branch reference
- `.git/refs/remotes/origin/ralph` - Old remote reference

**Note:** These are historical git artifacts and don't need renaming

---

## Summary Statistics

### Environment Variables: 13+
All need update from `RALPH_*` to `RALPHBLASTER_*`

### API Endpoints: 5+
All `/api/v1/ralph/*` to `/api/v1/ralphblaster/*`

### Files to Potentially Rename: 1
- `bin/ralph-agent.js`

### Documentation Files: 10+
All need review and updates for "Ralph" → "RalphBlaster"

### Test Files: 5+
- 50+ references to update in tests

### Code Files: 20+
- All environment variable references in src/
- API endpoint paths
- Error messages mentioning Ralph

---

## Migration Strategy

**Phase 1: Backward Compatibility**
1. Update `src/config.js` to support both `RALPHBLASTER_*` and `RALPH_*` (with deprecation warnings)
2. Update API client to try new endpoints first, fall back to old
3. Update logging/formatter to redact both token names

**Phase 2: Code Updates**
1. Update all default values to use `RALPHBLASTER_*`
2. Update all error messages and documentation strings
3. Update all test files

**Phase 3: Documentation**
1. Update README.md with new variable names
2. Update all .md files
3. Update examples and banner text

**Phase 4: Cleanup**
1. Remove backward compatibility for old variable names
2. Remove old API endpoint fallback logic
3. Update .env.example to only show new names

**Breaking Changes:**
- Environment variable names (can be backward compatible temporarily)
- CLI command name if changed from `ralphblaster` to `ralphblaster-agent`
- API endpoints (can be backward compatible with fallback)

**Estimated Impact:**
- 1 potential file rename
- 100+ code reference updates
- 50+ test updates
- 10+ documentation files
- 13+ environment variables
