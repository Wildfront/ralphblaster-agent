# Phase 3 - Enhanced Structured Logging

## Overview

Phase 3 adds rich structured logging capabilities to make logs more useful, searchable, and informative. Instead of plain text logs, every log now includes structured metadata that can be filtered, searched, and analyzed.

## Key Features

### 1. Global Context
Set context once, it's automatically included in all logs:

```javascript
// Set at job start
logger.setJobContext(job.id, apiClient, {
  jobType: 'code_execution',
  taskTitle: 'Make background lighter',
  projectName: 'ralphblaster'
});

// All subsequent logs automatically include this context
logger.info('Starting execution');
// Metadata includes: jobType, taskTitle, projectName
```

### 2. Child Loggers
Create component-specific loggers that inherit context:

```javascript
const worktreeLogger = logger.child({ component: 'worktree' });

worktreeLogger.info('Creating worktree', { path: '/path/to/worktree' });
// Includes parent context + component: 'worktree'
```

### 3. Semantic Events
Log events with structured types instead of free-form text:

```javascript
// Instead of:
logger.info('Creating worktree for job 1414');

// Use semantic events:
logger.event('worktree.creating', {
  component: 'worktree',
  operation: 'create',
  path: '/path/to/worktree',
  branch: 'ralphblaster/feature-branch'
});
```

### 4. Automatic Performance Tracking

**Manual timers:**
```javascript
const timer = logger.startTimer('worktree.create');
// ... do work ...
timer.done({ path: worktreePath });
// Automatically logs duration
```

**Automatic measurement:**
```javascript
const result = await logger.measure('prd.conversion', async () => {
  return await convertPRD(job);
});
// Logs: prd.conversion.started
// Logs: prd.conversion.complete (with duration)
```

### 5. Rich Metadata
Every log can include structured metadata:

```javascript
logger.info('Worktree created', {
  component: 'worktree',
  operation: 'create',
  path: '/path/to/worktree',
  branch: 'ralphblaster/feature-branch',
  duration: 3200
});
```

## How Logs Flow

### Agent Side

1. **Log with metadata** → `logger.info('Creating worktree', {...metadata})`
2. **Merge global context** → Adds jobType, taskTitle, etc.
3. **Format for display** → Terminal shows component, duration nicely
4. **Send to API** → Batched with full structured metadata

### Backend Side

1. **Receive log** → PATCH /jobs/:id/setup_log with metadata field
2. **Sanitize metadata** → Validate safe values, allow nested objects
3. **Store in task.ralphblaster_logs** → Each log has `metadata` field
4. **Broadcast to UI** → UI receives structured data

### UI Display

Logs are stored with structure:
```json
{
  "timestamp": "2025-01-23T10:30:45.123Z",
  "level": "info",
  "message": "Creating",
  "metadata": {
    "component": "worktree",
    "operation": "create",
    "eventType": "worktree.creating",
    "path": "/Users/.../job-1414",
    "branch": "ralphblaster/feature-branch",
    "jobType": "code_execution",
    "taskTitle": "Make background lighter"
  }
}
```

UI can now:
- Filter by component
- Search metadata fields
- Group by operation
- Show performance metrics

## API Changes

### Single Log Endpoint (Updated)

**Before (Phase 2):**
```http
PATCH /api/v1/ralphblaster/jobs/:id/setup_log
{
  "level": "info",
  "message": "Creating worktree",
  "timestamp": "2025-01-23T10:30:45.123Z"
}
```

**After (Phase 3):**
```http
PATCH /api/v1/ralphblaster/jobs/:id/setup_log
{
  "level": "info",
  "message": "Creating",
  "timestamp": "2025-01-23T10:30:45.123Z",
  "metadata": {
    "component": "worktree",
    "operation": "create",
    "eventType": "worktree.creating",
    "path": "/Users/.../job-1414",
    "branch": "ralphblaster/feature-branch"
  }
}
```

### Batch Endpoint (Updated)

```http
POST /api/v1/ralphblaster/jobs/:id/setup_logs
{
  "logs": [
    {
      "level": "info",
      "message": "Creating",
      "timestamp": "2025-01-23T10:30:45.123Z",
      "metadata": {
        "component": "worktree",
        "operation": "create",
        "eventType": "worktree.creating",
        "path": "/Users/.../job-1414"
      }
    },
    ...
  ]
}
```

## Example Usage

### Worktree Operations

**Before Phase 3:**
```javascript
logger.info(`Creating worktree for job ${job.id}`);
// Output: [INFO] Creating worktree for job 1414
```

**After Phase 3:**
```javascript
logger.event('worktree.creating', {
  component: 'worktree',
  operation: 'create',
  path: worktreePath,
  branch: branchName
});
// Output: [INFO] [job-1414] [worktree] Creating path: /Users/.../job-1414 branch: ralph/feature
// Metadata includes full structured data
```

### PRD Conversion with Timing

**Before Phase 3:**
```javascript
const start = Date.now();
logger.info('Starting PRD conversion');
const result = await convertPRD(job);
const duration = Date.now() - start;
logger.info(`PRD conversion completed in ${duration}ms`);
```

**After Phase 3:**
```javascript
const result = await logger.measure('prd.conversion', async () => {
  return await convertPRD(job);
});
// Automatically logs:
// - prd.conversion.started
// - prd.conversion.complete (45s)
```

### Component-Specific Logging

**Before Phase 3:**
```javascript
logger.info('Creating worktree');
logger.info('Launching Claude');
// All logs look the same
```

**After Phase 3:**
```javascript
const worktreeLogger = logger.child({ component: 'worktree' });
const executorLogger = logger.child({ component: 'executor' });

worktreeLogger.info('Creating');  // [worktree] Creating
executorLogger.info('Launching'); // [executor] Launching
// Clear component separation
```

## Message Formatting

Phase 3 formats messages intelligently:

```javascript
logger.info('Creating worktree', {
  component: 'worktree',
  path: '/Users/.../job-1414',
  branch: 'ralphblaster/feature-branch',
  duration: 3200
});

// Terminal Output:
// [2025-01-23T10:30:45Z] [INFO] [job-1414] [worktree] Creating worktree [worktree] (3.2s) path: /Users/.../job-1414 branch: ralphblaster/feature-branch

// Message sent to UI:
// "Creating worktree [worktree] (3.2s) path: /Users/.../job-1414 branch: ralphblaster/feature-branch"

// Metadata stored in DB:
// { component: 'worktree', path: '...', branch: '...', duration: 3200 }
```

Duration formatting:
- `< 1s`: "450ms"
- `< 60s`: "3.2s"
- `>= 60s`: "2m 15s"

## Backend Metadata Sanitization

To prevent security issues, metadata is sanitized:

### Allowed Types
- Strings
- Numbers
- Booleans
- Null
- One level of nested objects
- Arrays of safe values

### Not Allowed
- Functions
- Deep nesting (>1 level)
- Symbol types
- Circular references

```ruby
# Backend sanitization
def sanitize_log_metadata(metadata_params)
  # Allows { component: 'worktree', path: '/path' }
  # Allows { metadata: { nested: 'value' } } (1 level)
  # Blocks { deep: { nested: { value: 'bad' } } } (>1 level)
  # Blocks functions, symbols, etc.
end
```

## Backward Compatibility

**Phase 2 code still works:**
```javascript
logger.info('Creating worktree'); // Still works, just no metadata
```

**New Phase 3 features are additive:**
```javascript
logger.info('Creating worktree', { component: 'worktree' }); // Enhanced
logger.event('worktree.created', { path }); // New semantic events
const timer = logger.startTimer('operation'); // New timing
```

**Backend accepts both:**
- Logs without metadata (Phase 2)
- Logs with metadata (Phase 3)
- Stores metadata if present, ignores if not

## Benefits

### For Debugging
- **Filter by component** - "Show me all worktree logs"
- **Search metadata** - "Find logs with path containing 'job-1414'"
- **Performance analysis** - "Which operations took >10 seconds?"

### For Monitoring
- **Structured data** - Easy to index in log aggregation tools
- **Automatic timing** - No manual performance tracking needed
- **Semantic events** - Group related operations automatically

### For Users
- **Better UI** - Categorized, filterable logs
- **Performance visibility** - See what's slow
- **Professional appearance** - Structured, organized logs

## Migration Guide

### Update Existing Logs

**Pattern 1: Simple info logs**
```javascript
// Before
logger.info('Creating worktree for job 1414');

// After (Phase 3)
logger.event('worktree.creating', {
  component: 'worktree',
  operation: 'create'
});
```

**Pattern 2: Logs with context**
```javascript
// Before
logger.info(`Created worktree: ${path}`);

// After (Phase 3)
logger.event('worktree.created', {
  component: 'worktree',
  path: path
});
```

**Pattern 3: Timed operations**
```javascript
// Before
const start = Date.now();
const result = await doWork();
const duration = Date.now() - start;
logger.info(`Work completed in ${duration}ms`);

// After (Phase 3)
const result = await logger.measure('work', async () => {
  return await doWork();
});
```

## Future UI Enhancements

Phase 3 structured data enables future UI features:

1. **Filterable logs**
   ```
   [Component: All ▼] [Level: All ▼] [Event Type: All ▼]
   ```

2. **Searchable metadata**
   ```
   🔍 Search: path contains "worktree"
   ```

3. **Grouped by operation**
   ```
   Worktree Operations (4 logs)
     ├─ Creating (2s)
     ├─ Created ✓
     └─ Removed ✓
   ```

4. **Performance timeline**
   ```
   Timeline:
   0s ────── 3s ──── 48s ──── 293s
   │ Worktree │ PRD │  Execution  │
   ```

5. **Export structured logs**
   ```
   [Export JSON] [Export CSV]
   ```

## Summary

Phase 3 transforms logs from plain text to rich structured data:

✅ **Global context** - Automatic metadata on all logs
✅ **Child loggers** - Component-specific logging
✅ **Semantic events** - Structured event types
✅ **Auto timing** - Built-in performance tracking
✅ **Rich metadata** - Searchable, filterable data
✅ **Backward compatible** - Phase 2 code still works
✅ **Backend ready** - Stores and sanitizes metadata
✅ **UI ready** - Structured data available for display

**Phase 3 makes logs useful for debugging, monitoring, and analysis!**
