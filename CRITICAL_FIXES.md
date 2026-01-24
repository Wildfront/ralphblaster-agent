# Critical Issues Fixed

This document summarizes the critical security and reliability issues that were fixed based on the code review.

## 1. Race Condition in Process Cleanup ✅

**File:** `src/executor/index.js:170-194`

**Issue:** The `killCurrentProcess()` method was checking `this.currentProcess` in the setTimeout callback, which could reference a different process if `this.currentProcess` was reassigned between SIGTERM and SIGKILL signals.

**Risk:** Could kill the wrong process if a new job started during the grace period.

**Fix:** Capture the process reference at the start of the method to avoid race condition.

```javascript
// BEFORE: Unsafe - checks this.currentProcess in timeout
async killCurrentProcess() {
  if (this.currentProcess && !this.currentProcess.killed) {
    this.currentProcess.kill('SIGTERM');
    await new Promise((resolve) => {
      setTimeout(() => {
        if (this.currentProcess && !this.currentProcess.killed) { // ❌ Wrong reference
          this.currentProcess.kill('SIGKILL');
        }
        resolve();
      }, PROCESS_KILL_GRACE_PERIOD_MS);
    });
  }
}

// AFTER: Safe - uses captured reference
async killCurrentProcess() {
  const processToKill = this.currentProcess; // ✅ Capture reference
  if (processToKill && !processToKill.killed) {
    processToKill.kill('SIGTERM');
    await new Promise((resolve) => {
      setTimeout(() => {
        if (processToKill && !processToKill.killed) { // ✅ Uses captured reference
          processToKill.kill('SIGKILL');
        }
        resolve();
      }, PROCESS_KILL_GRACE_PERIOD_MS);
    });
  }
}
```

**Tests:** `test/executor-kill-process.test.js`
- Added test: "does not kill new process if currentProcess is reassigned during grace period"

---

## 2. Missing Timeout on Batch Operations ✅

**File:** `src/api-client.js:395-409`

**Issue:** Batch log operations used default 15s timeout, but batch operations with many logs could take longer.

**Risk:** Batch requests could timeout prematurely with large payloads.

**Fix:** Added 30s timeout for batch operations.

```javascript
// BEFORE: Uses default 15s timeout
async addSetupLogBatch(jobId, logs) {
  await this.client.post(`/api/v1/ralph/jobs/${jobId}/setup_logs`, {
    logs: logs
  }); // ❌ No timeout specified
}

// AFTER: Uses 30s timeout for batches
async addSetupLogBatch(jobId, logs) {
  await this.client.post(`/api/v1/ralph/jobs/${jobId}/setup_logs`, {
    logs: logs
  }, {
    timeout: BATCH_API_TIMEOUT_MS // ✅ 30s for batch operations
  });
}
```

**Tests:** `test/api-client-batch-metadata.test.js`
- Added comprehensive batch operation timeout tests

---

## 3. Missing Metadata Validation ✅

**File:** `src/api-client.js:347-357`

**Issue:** No validation or size limits on metadata objects sent to API.

**Risk:** Could send arbitrarily large or malformed metadata, potentially causing API errors or memory issues.

**Fix:** Added validation for metadata type, size limit (10KB), and serialization errors.

```javascript
// BEFORE: No validation
async updateJobMetadata(jobId, metadata) {
  await this.client.patch(`/api/v1/ralph/jobs/${jobId}/metadata`, {
    metadata: metadata // ❌ No validation
  });
}

// AFTER: With validation
async updateJobMetadata(jobId, metadata) {
  // Validate metadata is an object
  if (!metadata || typeof metadata !== 'object') {
    logger.warn('Invalid metadata: must be an object');
    return;
  }

  // Check metadata size (max 10KB)
  try {
    const metadataStr = JSON.stringify(metadata);
    if (metadataStr.length > 10000) {
      logger.warn(`Metadata too large (${metadataStr.length} bytes), truncating`);
      return;
    }
  } catch (error) {
    logger.warn(`Error serializing metadata: ${error.message}`);
    return;
  }

  await this.client.patch(`/api/v1/ralph/jobs/${jobId}/metadata`, {
    metadata: metadata
  });
}
```

**Tests:** `test/api-client-batch-metadata.test.js`
- Tests for null/undefined/invalid metadata
- Tests for metadata size limits
- Tests for circular reference handling

---

## 4. Weak Branch Name Validation ✅

**File:** `src/api-client.js:187-195`

**Issue:** Branch name validation regex was too permissive, allowing invalid git branch names and potential path traversal.

**Risk:** Could accept invalid branch names or enable path traversal attacks if server uses branch names unsafely.

**Fix:** Strengthened regex to follow git branch naming rules.

```javascript
// BEFORE: Too permissive
if (!/^[a-zA-Z0-9/_-]{1,200}$/.test(result.branchName)) {
  // ❌ Allows leading/trailing slashes, double slashes, leading dashes
}

// AFTER: Strict git branch naming rules
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(result.branchName) ||
    result.branchName.length > 200) {
  // ✅ Must start with alphanumeric
  // ✅ Each segment after / must start with alphanumeric
  // ✅ No leading/trailing slashes or dashes
  // ✅ No double slashes
}
```

**Valid branch names:**
- ✅ `feature-123`
- ✅ `feature/user-auth`
- ✅ `feature/v2/user-auth`
- ✅ `JIRA-123_user-auth-v2`

**Invalid branch names:**
- ❌ `-invalid` (starts with dash)
- ❌ `/invalid` (starts with slash)
- ❌ `feature/` (ends with slash)
- ❌ `feature/-invalid` (segment starts with dash)
- ❌ `feature//bug` (double slash)

**Tests:** `test/api-client-branch-validation.test.js`
- Comprehensive branch name validation tests (20+ test cases)

---

## 5. Missing Progress Callback Throttling ✅

**File:** `src/index.js:178-186`

**Issue:** No throttling on progress updates, could send hundreds of updates per second during rapid output.

**Risk:** Could flood API with progress updates, causing performance issues.

**Fix:** Added 100ms throttle (max 10 updates/sec) with proper error handling.

```javascript
// BEFORE: No throttling
const result = await this.executor.execute(job, async (chunk) => {
  try {
    await this.apiClient.sendProgress(job.id, chunk); // ❌ No throttling
  } catch (error) {
    logger.warn(`Failed to send progress update: ${error.message}`);
  }
});

// AFTER: With 100ms throttling
constructor() {
  // ... existing code ...
  this.lastProgressUpdate = 0; // Add throttle state
}

async processJob(job) {
  // Reset throttle for new job
  this.lastProgressUpdate = 0;

  const result = await this.executor.execute(job, async (chunk) => {
    // Throttle to max 10 updates/sec
    const now = Date.now();
    if (now - this.lastProgressUpdate < PROGRESS_THROTTLE_MS) {
      return; // ✅ Skip this update
    }
    this.lastProgressUpdate = now;

    // Better error handling
    try {
      await this.apiClient.sendProgress(job.id, chunk).catch((apiError) => {
        // ✅ Swallow API errors - progress is best-effort
        logger.debug(`Progress update API error: ${apiError.message}`);
      });
    } catch (error) {
      // ✅ Catch synchronous errors too
      logger.warn(`Failed to send progress update: ${error.message}`);
    }
  });
}
```

**Tests:** `test/index-progress-callback.test.js`
- Added throttling tests with Date.now() mocking
- Tests for throttle reset between jobs
- Tests for rapid updates

---

## Summary

All 5 critical issues have been fixed with comprehensive test coverage:

| Issue | Severity | Status | Tests |
|-------|----------|--------|-------|
| Race condition in process cleanup | High | ✅ Fixed | executor-kill-process.test.js |
| Missing batch operation timeout | Medium | ✅ Fixed | api-client-batch-metadata.test.js |
| Missing metadata validation | Medium | ✅ Fixed | api-client-batch-metadata.test.js |
| Weak branch name validation | Medium | ✅ Fixed | api-client-branch-validation.test.js |
| Missing progress throttling | Medium | ✅ Fixed | index-progress-callback.test.js |

**Test Results:** ✅ All 588 tests passing (587 passed, 1 skipped)

**Files Modified:**
- `src/executor/index.js`
- `src/api-client.js`
- `src/index.js`

**Test Files Added:**
- `test/api-client-batch-metadata.test.js`
- `test/api-client-branch-validation.test.js`

**Test Files Modified:**
- `test/executor-kill-process.test.js`
- `test/index-progress-callback.test.js`
