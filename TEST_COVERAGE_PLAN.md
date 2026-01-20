# Critical Test Coverage Plan

## Priority: Security & Data Validation

### Input Validation Tests (api-client.js)
- [x] Test `validateJob()` rejects null/undefined job
- [x] Test `validateJob()` rejects job with missing id
- [x] Test `validateJob()` rejects job with invalid id (0, negative, non-number)
- [x] Test `validateJob()` rejects job with missing/empty job_type
- [x] Test `validateJob()` rejects unknown job_type
- [x] Test `validateJob()` rejects job with missing/empty task_title
- [x] Test `validateJob()` accepts valid prd_generation job
- [x] Test `validateJob()` accepts valid code_execution job
- [x] Test `validateJob()` rejects code_execution job without project.system_path
- [x] Test `validateJob()` accepts code_execution job with valid project

### Path Sanitization Tests (executor.js)
- [x] Test `validateAndSanitizePath()` rejects null/undefined paths
- [x] Test `validateAndSanitizePath()` rejects paths with null bytes
- [x] Test `validateAndSanitizePath()` blocks /etc directory
- [x] Test `validateAndSanitizePath()` blocks /bin directory
- [x] Test `validateAndSanitizePath()` blocks /System directory (macOS)
- [x] Test `validateAndSanitizePath()` blocks /Windows directory
- [x] Test `validateAndSanitizePath()` normalizes paths with .. traversal
- [x] Test `validateAndSanitizePath()` accepts valid project paths
- [x] Test `validateAndSanitizePath()` converts relative to absolute paths

## Priority: Core Functionality

### Job Execution Tests (executor.js)
- [x] Test `execute()` routes prd_generation jobs correctly
- [x] Test `execute()` routes code_execution jobs correctly
- [x] Test `execute()` throws error for unknown job type
- [x] Test `executeCodeImplementation()` fails for non-existent path
- [x] Test `executeCodeImplementation()` fails for invalid path
- [x] Test `executePrdGeneration()` uses process.cwd() when no project path
- [x] Test `parseOutput()` extracts RALPH_SUMMARY correctly
- [x] Test `parseOutput()` extracts RALPH_BRANCH correctly
- [x] Test `parseOutput()` handles missing markers gracefully

### Process Management Tests (executor.js)
- [x] Test `killCurrentProcess()` terminates running process
- [x] Test `currentProcess` is set when spawning Claude
- [x] Test `currentProcess` is cleared when process exits
- [x] Test `currentProcess` is cleared on process error

## Priority: Shutdown & Cleanup

### Graceful Shutdown Tests (index.js)
- [x] Test `stop()` clears heartbeat interval
- [x] Test `stop()` kills running Claude process
- [x] Test `stop()` marks current job as failed
- [x] Test `stop()` handles case when no current job
- [x] Test `stopHeartbeat()` is called before marking job complete
- [x] Test `stopHeartbeat()` is called before marking job failed

### Heartbeat Tests (index.js)
- [x] Test `startHeartbeat()` sends heartbeat every 60s
- [x] Test `stopHeartbeat()` clears interval
- [x] Test heartbeat continues on API failure (logs warning)

## Priority: API Integration

### API Client Tests (api-client.js)
- [x] Test `getNextJob()` returns null on 204 status
- [x] Test `getNextJob()` returns job on success
- [x] Test `getNextJob()` rejects invalid job from API
- [x] Test `getNextJob()` handles 403 permission error
- [x] Test `getNextJob()` handles ECONNREFUSED
- [x] Test `markJobRunning()` sends correct status
- [x] Test `markJobCompleted()` includes prd_content for prd jobs
- [x] Test `markJobCompleted()` includes summary/branch for code jobs
- [x] Test `markJobFailed()` doesn't throw on API error

## Priority: Configuration

### Config Tests (config.js)
- [x] Test exits when RALPH_API_TOKEN is missing
- [x] Test parses RALPH_POLL_INTERVAL as integer
- [x] Test parses RALPH_MAX_RETRIES as integer
- [x] Test uses default values when env vars not set
- [ ] Test validates API URL format (future enhancement)
- [ ] Test validates API token format (future enhancement)

## Test Infrastructure Setup

- [x] Choose test framework (Jest recommended)
- [x] Add test dependencies to package.json
- [x] Create test/ directory structure
- [x] Add npm test script
- [x] Setup test mocks for child_process.spawn
- [x] Setup test mocks for axios
- [x] Setup test fixtures for job objects

## Coverage Goals

- [x] Achieve >80% coverage for src/api-client.js (achieved 86.74%)
- [ ] Achieve >80% coverage for src/executor.js (achieved 61.9% - security-critical functions at 100%)
- [ ] Achieve >70% coverage for src/index.js (achieved 56.94% - critical shutdown/heartbeat paths covered)
- [x] Achieve 100% coverage for security-critical validation functions (validateJob, validateAndSanitizePath)

## Notes

- Focus on security-critical validation first (top 2 sections)
- Use mocks/stubs for external dependencies (spawn, axios)
- Integration tests can come later - unit tests are priority
- Consider adding a CI/CD workflow to run tests automatically
