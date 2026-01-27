# Command Separation Refactoring

## Overview

Refactored the CLI commands to properly separate concerns into three distinct steps:

1. **`init`** - Save credentials only (no project registration)
2. **`add-project`** - Register current directory as a project
3. **`ralphblaster`** - Start the agent

## Changes Made

### 1. `src/commands/init.js` - Simplified to Only Save Credentials

**Before:** Combined credential saving AND project registration
**After:** Only saves credentials to `~/.ralphblasterrc`

**What it does now:**
- Accepts `--token` and `--api-url` (or reads from env vars)
- Saves `apiToken` and `apiUrl` to `~/.ralphblasterrc`
- Displays next steps (pointing user to `add-project`)
- NO project detection or API calls to `/projects`

**Removed functionality:**
- `detectProjectName()` - Moved to add-project
- `getGitRemoteName()` - Moved to add-project
- `getPackageJsonName()` - Moved to add-project
- `getDirectoryName()` - Moved to add-project
- `createProject()` - Moved to add-project
- Icon/color formatting - Moved to add-project

### 2. `src/commands/add-project.js` - Rewrote from Alias to Full Implementation

**Before:** Extended `InitCommand` and called `super.run()`
**After:** Standalone command that handles project registration

**What it does now:**
- Detects project name (git remote → package.json → directory name)
- Sends POST `/projects` with `system_path` and `name`
- Displays success message with project details
- Requires credentials to already be saved via `init`

**Key methods:**
- `detectProjectName()` - Auto-detect from git/package.json/directory
- `getGitRemoteName()` - Parse git remote URL
- `getPackageJsonName()` - Read from package.json
- `getDirectoryName()` - Use directory name as fallback
- `createProject()` - API call to register project
- `displaySuccess()` - Show project details and next steps
- Icon/color formatting helpers

### 3. Updated Default API URL

**Before:** `https://app.ralphblaster.com`
**After:** `https://hq.ralphblaster.com`

Changed in:
- `src/config.js` - Default value
- `bin/ralphblaster.js` - Help text
- `test/config.test.js` - Test assertion

### 4. Updated CLI Help Text

Updated `bin/ralphblaster.js` help output to show the new three-step workflow:

```
Getting Started:
  1. Save your credentials:
     ralphblaster init --token=XXXXXXXXXXXXXXXXXXXXXXXX

  2. Register your project (run in project directory):
     ralphblaster add-project

  3. Start the agent:
     ralphblaster
```

### 5. Test Updates

#### `test/commands-init-complete.test.js` - Completely Rewritten
- Removed all project-related tests
- Tests now focus on credential saving only
- Tests default API URL fallback
- Tests error handling for missing token
- Tests config file writing

#### `test/commands-add-project.test.js` - Created New Test File
- Tests project name detection (git → package.json → directory)
- Tests API call to `/projects`
- Tests error handling (401, network errors)
- Tests success message display

#### `test/config.test.js` - Updated Default URL
- Changed expected default from `app.ralphblaster.com` to `hq.ralphblaster.com`

### 6. Documentation

Created `SETUP_GUIDE.md` with:
- Step-by-step setup instructions
- Command reference
- Configuration details
- Troubleshooting tips
- Security notes

## User Workflow

### Old Workflow (Confusing)
```bash
# This did TWO things at once (save credentials + register project)
ralphblaster init --token=xxx

# This was just an alias for init (didn't make sense)
ralphblaster add-project

# Start agent
ralphblaster
```

### New Workflow (Clear)
```bash
# Step 1: Save credentials (once per machine)
ralphblaster init --token=xxx --api-url=https://hq.ralphblaster.com

# Step 2: Register project (once per project directory)
cd /path/to/project
ralphblaster add-project

# Step 3: Start agent (run whenever you want to process tasks)
ralphblaster
```

## Benefits

1. **Separation of Concerns** - Each command has a single, clear purpose
2. **Better UX** - Users understand what each step does
3. **Reusable Credentials** - Save token once, register many projects
4. **Testability** - Each command can be tested independently
5. **Clearer Error Messages** - Each step has specific error guidance

## Backward Compatibility

- Old environment variables still work (`RALPH_*` in addition to `RALPHBLASTER_*`)
- Config file format unchanged (`~/.ralphblasterrc`)
- API endpoints unchanged (POST `/projects`)

## Breaking Changes

**None** - This is a behavioral change but not breaking:
- Old users who ran `init` have projects already registered
- New users follow the clearer three-step flow
- Both workflows result in the same end state

## Test Coverage

- All 35 test suites passing ✓
- 791 tests passing ✓
- New tests for both `init` and `add-project` commands ✓

## Files Modified

1. `src/commands/init.js` - Simplified
2. `src/commands/add-project.js` - Rewritten
3. `src/config.js` - Updated default URL
4. `bin/ralphblaster.js` - Updated help text
5. `test/commands-init-complete.test.js` - Rewritten
6. `test/commands-add-project.test.js` - Created
7. `test/config.test.js` - Updated assertion

## Files Created

1. `SETUP_GUIDE.md` - Comprehensive setup documentation
2. `COMMAND_SEPARATION.md` - This file
