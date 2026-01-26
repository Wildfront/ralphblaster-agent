# Logging Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Configuration](#configuration)
5. [Using the Logger](#using-the-logger)
6. [Structured Logging](#structured-logging)
7. [Log Destinations](#log-destinations)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Overview

Ralph Blaster Agent uses a comprehensive logging system designed for production environments. The logging architecture provides:

- **Multiple log levels** (error, warn, info, debug) for granular control
- **Structured logging** with metadata for machine-readable logs
- **Multiple destinations**: console, file, and API
- **Batched API logging** to reduce overhead (10 logs → 1 API call)
- **Security-first design** with automatic redaction of sensitive data
- **Multi-agent support** with agent IDs for distributed tracing
- **Performance tracking** with built-in timers and measurement utilities
- **Context propagation** through child loggers

---

## Architecture

### Core Components

The logging system consists of three main modules:

1. **`src/logger.js`**: Main logger interface with structured logging features
2. **`src/setup-log-batcher.js`**: Batches logs to reduce API overhead
3. **`src/utils/log-file-helper.js`**: Manages job-specific log files

### Data Flow

```
Application Code
       ↓
    Logger
    ↓   ↓   ↓
Console File API
         ↓
   SetupLogBatcher
    (buffers logs)
         ↓
    API Endpoint
```

### Key Design Decisions

- **No external dependencies**: Uses only Node.js built-ins for reliability
- **Fail-safe operation**: Logging failures never crash the application
- **Batched API calls**: Reduces overhead from hundreds of API calls to dozens
- **Automatic redaction**: Prevents accidental token/credential leakage
- **Context inheritance**: Child loggers automatically inherit parent context

---

## Quick Start

### Basic Logging

```javascript
const logger = require('./logger');

// Simple messages
logger.info('Server started');
logger.warn('Disk space low');
logger.error('Connection failed');
logger.debug('Processing request');
```

### Logging with Metadata

```javascript
// Add structured data to any log
logger.info('User logged in', {
  userId: 'user-123',
  ipAddress: '192.168.1.1',
  component: 'auth'
});

// Output: [2026-01-26T10:30:00.000Z] [INFO] [auth] User logged in
// API receives: { userId: 'user-123', ipAddress: '192.168.1.1', component: 'auth' }
```

### Event Logging

```javascript
// Semantic events with structured metadata
logger.event('worktree.created', {
  path: '/path/to/worktree',
  duration: 3200
});

// Auto-formats to: "Created" with eventType, category, action metadata
```

### Performance Measurement

```javascript
// Method 1: Manual timer
const timer = logger.startTimer('database.query');
// ... do work ...
timer.done({ rows: 42 });

// Method 2: Automatic measurement
const result = await logger.measure('api.call', async () => {
  return await fetchData();
});
```

---

## Configuration

### Environment Variables

Configure logging behavior through environment variables:

```bash
# Log level (default: info)
export RALPH_LOG_LEVEL=debug      # error | warn | info | debug

# Console formatting (default: pretty)
export RALPH_CONSOLE_FORMAT=json  # pretty | json

# Console colors (default: true)
export RALPH_CONSOLE_COLORS=false # true | false
```

### Configuration File

You can also set these in `~/.ralphblasterrc`:

```json
{
  "logLevel": "debug",
  "consoleColors": true,
  "consoleFormat": "pretty"
}
```

### Log Levels

- **error** (0): Critical errors requiring immediate attention
- **warn** (1): Warning conditions that should be reviewed
- **info** (2): General informational messages (default)
- **debug** (3): Detailed debugging information

Only logs at or below the configured level are output. For example, if `logLevel=info`, debug logs are suppressed.

### Console Formats

#### Pretty Format (Default)

Clean, human-readable output optimized for terminal viewing:

```
[2026-01-26T10:30:00.000Z] [INFO] [agent-1] [job-123] [worktree] Creating worktree
```

- Shows only the message in console
- Sends full metadata to API
- Supports color coding by level

#### JSON Format

Machine-readable format with full metadata:

```
[2026-01-26T10:30:00.000Z] [INFO] [agent-1] [job-123] Message { "component": "worktree", "path": "/path" }
```

- Shows message and full JSON metadata
- Useful for log aggregation systems
- Can be parsed programmatically

---

## Using the Logger

### Setting Context

#### Agent Context

For multi-agent environments, set an agent ID:

```javascript
logger.setAgentId('agent-1');
logger.info('Starting work'); // Includes [agent-1] in output
```

#### Job Context

Link logs to a specific job and enable API logging:

```javascript
const apiClient = require('./api-client');

// Enable API logging for this job
logger.setJobContext(jobId, apiClient, {
  component: 'worktree',
  environment: 'production'
});

logger.info('Job started'); // Sent to API with job context

// Clear when done
await logger.clearJobContext();
```

**Note**: Only `info` and `error` level logs are sent to the API to reduce overhead. `debug` and `warn` logs remain local.

#### Global Context

Set context that applies to all subsequent logs:

```javascript
// Single key-value
logger.setContext('requestId', 'req-123');

// Multiple keys at once
logger.setContext({
  requestId: 'req-123',
  userId: 'user-456'
});

logger.info('Processing request'); // Includes requestId and userId
```

### Child Loggers

Create child loggers with additional context:

```javascript
const worktreeLogger = logger.child({ component: 'worktree' });

worktreeLogger.info('Creating worktree'); // Includes component: 'worktree'
worktreeLogger.error('Creation failed');  // Also includes component

// Child loggers can have children
const cleanupLogger = worktreeLogger.child({ operation: 'cleanup' });
cleanupLogger.info('Cleaning up'); // Includes component + operation
```

**Benefits**:
- Context inheritance (children inherit parent context)
- Namespace isolation (different modules use different loggers)
- Automatic metadata propagation

---

## Structured Logging

Structured logging adds machine-readable metadata to logs, enabling powerful querying and analysis.

### Event Logging

Events are semantic actions with structured metadata:

```javascript
// Format: 'category.action'
logger.event('worktree.created', {
  path: '/path/to/worktree',
  duration: 3200,
  size: 1024000
});

// Auto-generates:
// - level: 'info' (or 'error' if action is 'failed')
// - message: 'Created'
// - metadata: { eventType: 'worktree.created', category: 'worktree', action: 'created', ... }
```

**Conventions**:
- Use `category.action` format
- Actions like `failed` or `error` automatically log as errors
- Include relevant context (paths, IDs, durations)

### Performance Tracking

#### Start/Stop Timer

Manual control over timing:

```javascript
const timer = logger.startTimer('git.clone', { repo: 'owner/repo' });

try {
  await cloneRepository();
  timer.done({ branch: 'main', commits: 150 });
} catch (error) {
  timer.done({ error: error.message });
  throw error;
}

// Logs: git.clone.complete with duration, repo, branch, commits
```

#### Automatic Measurement

Wrap async operations for automatic timing:

```javascript
const result = await logger.measure('prd.conversion', async () => {
  return await convertPRD(job);
}, { jobId: job.id });

// Automatically logs:
// 1. prd.conversion.started { jobId: 123 }
// 2. prd.conversion.complete { jobId: 123, success: true, duration: 5200 }
```

**Note**: If the function throws, `success: false` and `error: message` are added.

### Metadata Best Practices

Good metadata is:

1. **Relevant**: Include information useful for debugging
   ```javascript
   logger.info('File written', {
     path: '/path/to/file',
     size: 1024,
     duration: 150
   });
   ```

2. **Structured**: Use consistent field names
   ```javascript
   // Good: consistent naming
   logger.event('api.request', { endpoint: '/users', method: 'GET' });

   // Bad: inconsistent
   logger.event('api.request', { url: '/users', verb: 'GET' });
   ```

3. **Searchable**: Use fields you'll want to query
   ```javascript
   // Enables: "show me all logs for user-123"
   logger.info('Action performed', { userId: 'user-123' });
   ```

4. **Concise**: Don't log huge objects
   ```javascript
   // Good: log only key fields
   logger.info('User created', { userId: user.id, email: user.email });

   // Bad: log entire object
   logger.info('User created', user); // May be 50+ fields
   ```

---

## Log Destinations

The logger writes to multiple destinations simultaneously:

### 1. Console Output

**Always enabled**. Writes to stdout/stderr with:

- Timestamps
- Log levels
- Agent IDs (if set)
- Job IDs (if set)
- Component names (if present)
- Optional color coding

**Configuration**:
- `RALPH_CONSOLE_FORMAT=pretty` (clean) or `json` (detailed)
- `RALPH_CONSOLE_COLORS=true` (default) or `false`

### 2. Job Log Files

**Managed by LogFileHelper**. Creates per-job log files in `.ralph-logs/`:

```javascript
const LogFileHelper = require('./utils/log-file-helper');

// Create job log with stream (for real-time writing)
const { logFile, logStream } = await LogFileHelper.createJobLogStream(
  workingDir,
  job,
  startTime,
  'PRD Generation'
);

// Write to stream
logStream.write('Processing...\n');

// Close stream when done
logStream.end();

// Add completion footer
LogFileHelper.writeCompletionFooterToStream(logStream, 'PRD Generation', {
  questionCount: 5
});
```

**Features**:
- Standard header with job ID, title, timestamp
- Real-time streaming for long-running jobs
- Completion footer with metadata
- Located in `.ralph-logs/job-{id}.log`

### 3. API Logging

**Enabled via `setJobContext()`**. Sends logs to Ralph Blaster API for UI display:

```javascript
logger.setJobContext(jobId, apiClient, globalContext);

logger.info('Job started');  // Sent to API
logger.error('Job failed');  // Sent to API (flushed immediately)
logger.debug('Details');     // NOT sent to API (debug/warn are local only)
```

**Batching Behavior**:
- Buffers up to 10 logs before sending (configurable)
- Flushes every 2 seconds (configurable)
- Error logs flush immediately (don't wait for batch)
- Gracefully falls back if batch endpoint unavailable

**Configuration**:
```javascript
// Default configuration
logger.setJobContext(jobId, apiClient, {
  maxBatchSize: 10,      // Buffer size
  flushInterval: 2000,   // Flush frequency (ms)
  useBatchEndpoint: true // Try batch first
});
```

### 4. Adding New Destinations

To add a new log destination:

1. **Modify `log()` function in `src/logger.js`**:

```javascript
function log(level, message, data = null) {
  // ... existing code ...

  // Add your new destination
  if (customDestination.enabled) {
    customDestination.write(level, message, data);
  }
}
```

2. **Example: File destination**:

```javascript
const fs = require('fs');
const logFileStream = fs.createWriteStream('/var/log/ralph.log', { flags: 'a' });

function log(level, message, data = null) {
  // ... existing code ...

  // Write to file
  const logEntry = JSON.stringify({ timestamp, level, message, data }) + '\n';
  logFileStream.write(logEntry);
}
```

3. **Example: Syslog destination**:

```javascript
const dgram = require('dgram');
const syslogClient = dgram.createSocket('udp4');

function log(level, message, data = null) {
  // ... existing code ...

  // Send to syslog
  const syslogMessage = `<${levelToSyslog(level)}>${message}`;
  syslogClient.send(syslogMessage, 514, 'localhost');
}
```

---

## Best Practices

### 1. Choose Appropriate Log Levels

```javascript
// ERROR: Things that are broken
logger.error('Database connection failed', { error: err.message });

// WARN: Things that are concerning but not broken
logger.warn('Disk space low', { available: '5%' });

// INFO: Normal operations (default level)
logger.info('Server started', { port: 3000 });

// DEBUG: Detailed debugging (verbose)
logger.debug('Received request', { headers, body });
```

### 2. Use Structured Logging

```javascript
// Good: Structured and searchable
logger.info('User action', {
  userId: 'user-123',
  action: 'login',
  ipAddress: '192.168.1.1'
});

// Bad: Unstructured
logger.info('User user-123 performed login from 192.168.1.1');
```

### 3. Use Child Loggers for Components

```javascript
// Create component-specific loggers
const worktreeLogger = logger.child({ component: 'worktree' });
const apiLogger = logger.child({ component: 'api' });

// All logs automatically include component
worktreeLogger.info('Creating worktree');
apiLogger.info('Sending request');
```

### 4. Measure Performance

```javascript
// For critical operations, always measure duration
const result = await logger.measure('database.query', async () => {
  return await db.query(sql);
}, { query: sql });
```

### 5. Log Events, Not Implementation Details

```javascript
// Good: What happened (event)
logger.event('worktree.created', { path, duration });

// Bad: How it happened (implementation)
logger.info('Called git worktree add with --detach flag');
```

### 6. Context Over Repetition

```javascript
// Good: Set context once
const requestLogger = logger.child({ requestId: 'req-123' });
requestLogger.info('Request received');
requestLogger.info('Processing started');
requestLogger.info('Processing complete');

// Bad: Repeat context
logger.info('Request received', { requestId: 'req-123' });
logger.info('Processing started', { requestId: 'req-123' });
logger.info('Processing complete', { requestId: 'req-123' });
```

### 7. Always Clear Job Context

```javascript
try {
  logger.setJobContext(jobId, apiClient);
  // ... process job ...
} finally {
  // Ensures buffered logs are flushed
  await logger.clearJobContext();
}
```

### 8. Don't Log Sensitive Data

The logger automatically redacts common token patterns, but be cautious:

```javascript
// Safe: Redacted automatically
logger.info('API request', {
  headers: { Authorization: 'Bearer sk-1234...' } // Becomes [REDACTED]
});

// Unsafe: Custom secrets may not be caught
logger.info('Database password', { password: 'secret123' });

// Better: Don't log sensitive fields
logger.info('Database connection', { host, database }); // No password
```

---

## Troubleshooting

### Logs Not Appearing in Console

**Symptom**: No logs visible in terminal

**Causes & Solutions**:

1. **Log level too low**:
   ```bash
   # Check current level
   echo $RALPH_LOG_LEVEL

   # Set to debug for maximum verbosity
   export RALPH_LOG_LEVEL=debug
   ```

2. **Console colors disabled**:
   ```bash
   # Re-enable colors
   export RALPH_CONSOLE_COLORS=true
   ```

3. **Output redirected**:
   ```bash
   # Check if stdout/stderr are redirected
   ls -l /proc/self/fd/1
   ls -l /proc/self/fd/2
   ```

### Logs Not Appearing in API

**Symptom**: Logs visible in console but not in Ralph Blaster UI

**Causes & Solutions**:

1. **Job context not set**:
   ```javascript
   // Must call this to enable API logging
   logger.setJobContext(jobId, apiClient);
   ```

2. **Log level too low**:
   ```javascript
   // Only info and error are sent to API
   logger.info('This goes to API');   // ✓
   logger.error('This goes to API');  // ✓
   logger.debug('This stays local');  // ✗
   logger.warn('This stays local');   // ✗
   ```

3. **API client not configured**:
   ```bash
   # Check token is set
   echo $RALPH_API_TOKEN

   # Or in ~/.ralphblasterrc
   cat ~/.ralphblasterrc
   ```

4. **Network issues**:
   ```javascript
   // Enable debug logging to see API errors
   export RALPH_LOG_LEVEL=debug

   // Check for network error messages
   ```

### Logs Missing Metadata

**Symptom**: Console shows clean logs but API doesn't receive metadata

**Cause**: Using `RALPH_CONSOLE_FORMAT=pretty` (expected behavior)

**Solution**: Pretty format hides metadata in console but still sends it to API. To see metadata in console:

```bash
export RALPH_CONSOLE_FORMAT=json
```

### Performance Issues

**Symptom**: Application slow when logging heavily

**Causes & Solutions**:

1. **Too many API calls**:
   - Batching should handle this automatically
   - Verify batching is enabled: `useBatchEndpoint: true`
   - Increase batch size: `maxBatchSize: 20`

2. **Synchronous file I/O**:
   - Use streams instead of `fs.appendFileSync()`
   - LogFileHelper uses streams by default

3. **Logging large objects**:
   ```javascript
   // Bad: Logs huge object
   logger.info('Data', hugeObject);

   // Good: Log only relevant fields
   logger.info('Data', {
     id: hugeObject.id,
     count: hugeObject.items.length
   });
   ```

### Circular Reference Errors

**Symptom**: `[Unable to stringify: ...]` in logs

**Cause**: Object contains circular references

**Solution**: The logger handles this automatically with `safeStringify()`, showing `[Circular]` for circular refs. No action needed.

### Sensitive Data Leakage

**Symptom**: Tokens or credentials visible in logs

**Solution**: The logger redacts common patterns automatically:

- `Authorization: Bearer [REDACTED]`
- `RALPH_API_TOKEN=[REDACTED]`
- `"apiToken": "[REDACTED]"`
- `"token": "[REDACTED]"`

If custom secrets leak, add patterns to `redactSensitiveData()` in `src/logger.js`.

### Log Files Growing Too Large

**Symptom**: `.ralph-logs/` directory consuming disk space

**Solution**: Implement log rotation:

```javascript
const fs = require('fs');
const path = require('path');

// Delete old log files (older than 7 days)
function cleanupOldLogs(logDir, maxAgeDays = 7) {
  const files = fs.readdirSync(logDir);
  const now = Date.now();

  files.forEach(file => {
    const filePath = path.join(logDir, file);
    const stats = fs.statSync(filePath);
    const ageMs = now - stats.mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays > maxAgeDays) {
      fs.unlinkSync(filePath);
    }
  });
}
```

---

## Advanced Topics

### Multi-Agent Logging

For distributed systems with multiple agents:

```javascript
// Agent 1
logger.setAgentId('agent-1');
logger.info('Processing job');
// Output: [2026-01-26T10:30:00.000Z] [INFO] [agent-1] Processing job

// Agent 2
logger.setAgentId('agent-2');
logger.info('Processing job');
// Output: [2026-01-26T10:30:00.000Z] [INFO] [agent-2] Processing job
```

This enables tracing which agent generated which logs.

### Custom Batcher Configuration

Fine-tune batching behavior:

```javascript
const SetupLogBatcher = require('./setup-log-batcher');

const batcher = new SetupLogBatcher(apiClient, jobId, {
  maxBatchSize: 20,       // Buffer up to 20 logs
  flushInterval: 5000,    // Flush every 5 seconds
  useBatchEndpoint: true  // Use batch API
});

// Add logs manually
batcher.add('info', 'Message', { metadata: 'value' });

// Flush immediately
await batcher.flush();

// Shutdown (flushes remaining logs)
await batcher.shutdown();
```

### Integrating with External Logging Services

Example: Sending logs to Datadog

```javascript
const logger = require('./logger');
const dogapi = require('dogapi');

// Wrap logger to also send to Datadog
const originalLog = logger.info;
logger.info = (message, data) => {
  originalLog(message, data);

  // Also send to Datadog
  dogapi.event.create({
    title: message,
    text: JSON.stringify(data),
    tags: ['source:ralph-agent']
  });
};
```

---

## API Reference

See JSDoc comments in source files for detailed API documentation:

- **[src/logger.js](../src/logger.js)**: Main logger interface
- **[src/setup-log-batcher.js](../src/setup-log-batcher.js)**: Batching implementation
- **[src/utils/log-file-helper.js](../src/utils/log-file-helper.js)**: File logging utilities

---

## Summary

The Ralph Blaster Agent logging system provides a production-ready logging solution with:

- Simple API for basic logging: `logger.info('message')`
- Powerful structured logging for metadata: `logger.info('message', { key: 'value' })`
- Multiple destinations: console, file, API
- Automatic batching for efficiency
- Security with automatic redaction
- Performance tracking with timers
- Context propagation with child loggers

For most use cases, follow this pattern:

```javascript
const logger = require('./logger');

// Set context once
logger.setJobContext(jobId, apiClient);
const componentLogger = logger.child({ component: 'myComponent' });

// Log events and measure performance
await componentLogger.measure('operation', async () => {
  componentLogger.info('Starting operation');
  // ... do work ...
  componentLogger.event('operation.complete', { result: 'success' });
});

// Clean up
await logger.clearJobContext();
```

For questions or issues, refer to the [Troubleshooting](#troubleshooting) section or examine the source code.
