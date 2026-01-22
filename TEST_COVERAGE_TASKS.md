# Test Coverage Improvement Tasks

**Current Coverage: 51.21%** | **Target Coverage: 75%+**

This document tracks all tests that need to be written to improve test coverage for the ralphblaster-agent project.

---

## Priority 1: CRITICAL - executor.js (43.85% → 75%+)

### executePlanGeneration (Lines 169-188) - ✅ COMPLETED
- [x] Test plan generation with valid job and prompt
- [x] Test plan generation with server-provided prompt
- [x] Test plan generation output parsing
- [x] Test plan generation execution time tracking
- [x] Test plan generation error handling and logging
- [x] Test plan generation with missing/invalid project path

### executeCodeImplementation - Major Gaps (Lines 212-381) - ✅ COMPLETED
- [x] Test code execution with invalid/missing project path
- [x] Test code execution with empty prompt
- [x] Test prompt validation in code execution flow
- [x] Test worktree creation and cleanup flow
- [x] Test Ralph instance creation
- [x] Test execution log file saving to .ralph-logs
- [x] Test log file creation when directory doesn't exist
- [x] Test progress.txt and prd.json copying to logs
- [x] Test progress.txt copy when file missing
- [x] Test completion signal detection (ralphComplete flag)
- [x] Test progress summary reading
- [x] Test branch name retrieval from prd.json
- [x] Test branch name fallback to worktreeManager
- [x] Test execution summary building and formatting
- [x] Test git activity logging integration
- [x] Test status event emission during code execution
- [x] Test worktree auto-cleanup when enabled
- [x] Test worktree preservation when auto-cleanup disabled
- [x] Test cleanup on execution failure
- [x] Test gitActivity metadata in result object

### Error Categorization (Lines 393-446) - ✅ COMPLETED
- [x] Test categorizeError with ENOENT (Claude not installed)
- [x] Test categorizeError with authentication failures
- [x] Test categorizeError with token limit exceeded
- [x] Test categorizeError with rate limiting (429)
- [x] Test categorizeError with permission denied (EACCES)
- [x] Test categorizeError with execution timeout
- [x] Test categorizeError with network errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT)
- [x] Test categorizeError with non-zero exit codes
- [x] Test categorizeError with unknown errors

### Environment & Security (Lines 452-475) - ✅ COMPLETED
- [x] Test getSanitizedEnv returns only allowed variables
- [x] Test getSanitizedEnv handles missing environment variables
- [x] Test getSanitizedEnv doesn't leak sensitive variables

### runClaudeSkill (Lines 486-564) - ✅ COMPLETED
- [x] Test runClaudeSkill timeout handling
- [x] Test runClaudeSkill process cleanup on timeout
- [x] Test runClaudeSkill with skill success
- [x] Test runClaudeSkill with skill failure
- [x] Test runClaudeSkill error enrichment
- [x] Test runClaudeSkill partial output capture

### runClaude (Lines 574-654) - ✅ COMPLETED
- [x] Test runClaude timeout handling (default 2 hours)
- [x] Test runClaude process cleanup on timeout
- [x] Test runClaude error enrichment
- [x] Test runClaude partial output in errors

### detectAndEmitEvents (Lines 661-718) - ✅ COMPLETED
- [x] Test file modification event detection
- [x] Test multiple file pattern matching
- [x] Test git commit event detection
- [x] Test test execution event detection
- [x] Test cleanup phase event detection
- [x] Test event emission with no apiClient
- [x] Test event emission error handling
- [x] Test that only one event emitted per chunk

### runRalphInstance (Lines 729-816) - ✅ COMPLETED
- [x] Test Ralph instance execution with valid parameters
- [x] Test Ralph instance timeout handling
- [x] Test Ralph instance process tracking
- [x] Test Ralph instance stdout/stderr handling
- [x] Test Ralph instance event detection integration
- [x] Test Ralph instance exit code 0 (completion)
- [x] Test Ralph instance exit code 1 (max iterations)
- [x] Test Ralph instance exit with error codes
- [x] Test Ralph instance spawn errors
- [x] Test Ralph instance error categorization
- [x] Test Ralph instance partial output capture
- [x] Test environment variables passed to Ralph (RALPH_WORKTREE_PATH, etc.)

### logGitActivity (Lines 852-985) - ✅ COMPLETED
- [x] Test git activity logging with valid worktree
- [x] Test git activity with missing/invalid worktree path
- [x] Test commit count calculation
- [x] Test uncommitted changes detection
- [x] Test last commit info retrieval
- [x] Test remote push status check
- [x] Test change stats retrieval
- [x] Test git activity summary formatting
- [x] Test git activity with zero commits
- [x] Test git activity with uncommitted changes but no commits
- [x] Test git activity error handling
- [x] Test git activity onProgress callback
- [x] Test git activity summary object structure

### parseOutput (Lines 823-842) - ✅ COMPLETED (Already had tests)
- [x] Test parseOutput with RALPH_SUMMARY marker
- [x] Test parseOutput with RALPH_BRANCH marker
- [x] Test parseOutput with both markers
- [x] Test parseOutput with no markers

### killCurrentProcess (Lines 992-1016) - ✅ COMPLETED
- [x] Test killCurrentProcess with active process
- [x] Test killCurrentProcess SIGTERM then SIGKILL flow
- [x] Test killCurrentProcess with no active process
- [x] Test killCurrentProcess error handling

### validateAndSanitizePath (Lines 1023-1112)
- [ ] Test path validation with null bytes
- [ ] Test path validation with system directories (/etc, /bin, etc.)
- [ ] Test path validation with macOS system dirs (/System, /Library)
- [ ] Test path validation with Windows system dirs
- [ ] Test path validation with sensitive subdirectories (.ssh, .aws, etc.)
- [ ] Test path validation with RALPH_ALLOWED_PATHS whitelist
- [ ] Test path validation outside allowed paths
- [ ] Test path validation with paths outside user directories

---

## Priority 2: HIGH - worktree-manager.js (9.09% → 90%+)

### createWorktree (Lines 18-60) - ✅ COMPLETED
- [x] Test createWorktree with valid job
- [x] Test createWorktree git version check
- [x] Test createWorktree with existing worktree (cleanup stale)
- [x] Test createWorktree git command execution
- [x] Test createWorktree branch creation
- [x] Test createWorktree path generation
- [x] Test createWorktree error handling
- [x] Test createWorktree logging

### removeWorktree (Lines 66-95) - ✅ COMPLETED
- [x] Test removeWorktree with valid worktree
- [x] Test removeWorktree force removal
- [x] Test removeWorktree error handling (best-effort)
- [x] Test removeWorktree logging
- [x] Test that branch is not deleted after removal

### getWorktreePath (Lines 102-105) - ✅ COMPLETED
- [x] Test worktree path generation format
- [x] Test worktree path with different job IDs

### getBranchName (Lines 112-114) - ✅ COMPLETED
- [x] Test branch name format (ralph/ticket-X/job-Y)
- [x] Test branch name with different task/job IDs

### execGit (Lines 123-167) - ✅ COMPLETED
- [x] Test execGit successful command
- [x] Test execGit with timeout
- [x] Test execGit process cleanup on timeout
- [x] Test execGit stdout capture
- [x] Test execGit stderr capture
- [x] Test execGit exit code 0 (success)
- [x] Test execGit exit code non-zero (failure)
- [x] Test execGit spawn errors
- [x] Test execGit shell=false security

---

## Priority 3: HIGH - commands/init.js (0% → 80%+)

### run (Lines 20-39) - ✅ COMPLETED
- [x] Test init command success flow
- [x] Test init command with project name detection
- [x] Test init command with API project creation
- [x] Test init command error handling
- [x] Test init command exit codes

### detectProjectName (Lines 45-71) - ✅ COMPLETED
- [x] Test project name detection from git remote
- [x] Test project name detection from package.json
- [x] Test project name fallback to directory name
- [x] Test project name detection priority order

### getGitRemoteName (Lines 77-97) - ✅ COMPLETED
- [x] Test git remote name extraction from HTTPS URL
- [x] Test git remote name extraction from SSH URL
- [x] Test git remote name with .git suffix
- [x] Test git remote name without .git suffix
- [x] Test git remote when not initialized
- [x] Test git remote when no origin configured

### getPackageJsonName (Lines 102-111) - ✅ COMPLETED
- [x] Test package.json name extraction
- [x] Test package.json when file doesn't exist
- [x] Test package.json when name field missing
- [x] Test package.json with invalid JSON

### getDirectoryName (Lines 116-118) - ✅ COMPLETED
- [x] Test directory name extraction

### createProject (Lines 123-158) - ✅ COMPLETED
- [x] Test project creation API call
- [x] Test project creation with valid response
- [x] Test project creation with unexpected response format
- [x] Test project creation with 401 (unauthorized)
- [x] Test project creation with 403 (forbidden)
- [x] Test project creation with 422 (validation error)
- [x] Test project creation with other error codes
- [x] Test project creation with network error
- [x] Test project creation with connection refused

### displaySuccess (Lines 163-172) - ✅ COMPLETED
- [x] Test success message display
- [x] Test success message formatting
- [x] Test icon emoji conversion

### getIconEmoji (Lines 177-208) - ✅ COMPLETED
- [x] Test emoji pass-through
- [x] Test Heroicon name to emoji mapping
- [x] Test all icon mappings
- [x] Test fallback icon

### formatColorName (Lines 213-226) - ✅ COMPLETED
- [x] Test color name formatting (snake_case to Title Case)
- [x] Test color name with hex color
- [x] Test color name with null/undefined

### handleError (Lines 231-246) - ✅ COMPLETED
- [x] Test error handling with API token error
- [x] Test error handling with connection error
- [x] Test error logging

---

## Priority 4: MEDIUM - api-client.js (79% → 90%+)

### Uncovered Areas

#### Constructor & Interceptors (Lines 25-27, 32-42) - ✅ COMPLETED
- [x] Test request interceptor adds auth header
- [x] Test request interceptor adds agent version
- [x] Test response interceptor redacts auth in errors
- [x] Test response interceptor redacts auth in error.response.config

#### validateOutput (Lines 137-148) - ✅ COMPLETED
- [x] Test validateOutput with non-string input
- [x] Test validateOutput truncation when exceeding max size
- [x] Test validateOutput truncation message

#### markJobCompleted - Gaps (Lines 172-177, 181) - ✅ COMPLETED
- [x] Test branch name validation regex rejection
- [x] Test invalid branch name omitted from payload
- [x] Test git activity metadata structure

#### sendProgress (Lines 253-262) - ✅ COMPLETED
- [x] Test sendProgress endpoint call
- [x] Test sendProgress error handling (warn, don't throw)

#### sendStatusEvent (Lines 271-283) - ✅ COMPLETED
- [x] Test sendStatusEvent API call
- [x] Test sendStatusEvent with metadata
- [x] Test sendStatusEvent error handling (best-effort)

#### updateJobMetadata (Lines 290-300) - ✅ COMPLETED
- [x] Test updateJobMetadata API call
- [x] Test updateJobMetadata error handling (best-effort)

---

## Test Infrastructure Improvements

- [ ] Add test helpers for mocking Git operations
- [ ] Add test helpers for mocking Claude CLI spawning
- [ ] Add test fixtures for various job types
- [ ] Add integration tests for full job execution flow
- [ ] Add tests for concurrent job execution scenarios
- [ ] Set up test coverage reporting in CI/CD

---

## Summary

**Total Tests to Write: ~150+**

**Breakdown by Priority:**
- Priority 1 (executor.js): ~85 tests
- Priority 2 (worktree-manager.js): ~25 tests
- Priority 3 (commands/init.js): ~30 tests
- Priority 4 (api-client.js): ~15 tests

**Estimated Coverage After Completion: 75-80%**
