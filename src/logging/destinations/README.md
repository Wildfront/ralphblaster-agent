# Log Destinations

This directory contains the log destination abstraction layer for Ralph's logging system. Each destination represents a different output target for log messages (console, file, API, etc.).

## Architecture

All destinations extend `BaseDestination` and implement a common interface:

- `write(level, message, metadata)` - Write a log entry
- `flush()` - Flush any buffered logs
- `close()` - Clean up resources and ensure no logs are lost
- `shouldLog(level)` - Filter logs based on level
- `handleError(error, level, message)` - Handle write errors gracefully

This pluggable architecture allows destinations to be added, removed, or replaced independently.

## Available Destinations

### BaseDestination

Abstract base class defining the common interface. All destinations must extend this class.

**Key features:**
- Defines standard lifecycle methods (write, flush, close)
- Provides default error handling
- Manages shutdown state

### ConsoleDestination

Outputs logs to console (stdout/stderr) with formatting and colors.

**Configuration:**
```javascript
const destination = new ConsoleDestination({
  colors: true,           // Enable ANSI colors
  format: 'pretty',       // 'pretty' or 'json'
  minLevel: 'info'        // Minimum log level to output
});
```

**Features:**
- Pretty formatting for human readability
- JSON format for machine parsing
- Color-coded by log level
- Redacts sensitive data
- No buffering - immediate output

### FileDestination

Writes logs to job-specific files in `.ralph-logs/` directory.

**Configuration:**
```javascript
const destination = new FileDestination({
  workingDir: '/path/to/work',
  job: { id: 123, task_title: 'Generate PRD' },
  startTime: Date.now(),
  jobType: 'PRD Generation',
  useStream: true         // Use streams vs batch writes
});
```

**Features:**
- Creates organized log files per job
- Streaming mode for real-time output
- Batch mode for complete output
- Automatic header/footer formatting
- Safe error handling

### ApiDestination

Sends logs to API with intelligent batching to reduce overhead.

**Configuration:**
```javascript
const destination = new ApiDestination({
  apiClient: apiClientInstance,
  jobId: 123,
  maxBatchSize: 10,       // Flush after N logs
  flushInterval: 2000,    // Flush every N ms
  useBatchEndpoint: true  // Try batch endpoint first
});
```

**Features:**
- Batches multiple logs into single API calls
- Automatic periodic flushing
- Fallback to individual sends on batch failure
- Graceful shutdown with final flush

## Usage Example

### Single Destination

```javascript
const { ConsoleDestination } = require('./logging/destinations');

const logger = new ConsoleDestination({
  colors: true,
  format: 'pretty',
  minLevel: 'debug'
});

await logger.write('info', 'Job started', { jobId: 123 });
await logger.write('debug', 'Processing file', { file: 'example.js' });
await logger.close();
```

### Multiple Destinations (with LogManager)

```javascript
const { ConsoleDestination, FileDestination, ApiDestination } = require('./logging/destinations');

// Create destinations
const console = new ConsoleDestination({ minLevel: 'info' });
const file = new FileDestination({
  workingDir: '/tmp',
  job: { id: 1, task_title: 'Test' },
  startTime: Date.now(),
  jobType: 'Test'
});
const api = new ApiDestination({
  apiClient,
  jobId: 1
});

// Use with LogManager (future implementation)
const manager = new LogManager([console, file, api]);
await manager.log('info', 'Message to all destinations');
await manager.close(); // Closes all destinations
```

## Creating Custom Destinations

Extend `BaseDestination` and implement the required methods:

```javascript
const BaseDestination = require('./base-destination');

class CustomDestination extends BaseDestination {
  constructor(config) {
    super(config);
    // Initialize your destination
  }

  async write(level, message, metadata = {}) {
    // Write log to your destination
  }

  async flush() {
    // Flush any buffers
  }

  async close() {
    this.isShuttingDown = true;
    await this.flush();
    // Clean up resources
  }
}

module.exports = CustomDestination;
```

## Design Principles

1. **Independence** - Each destination operates independently without dependencies on other destinations
2. **Graceful Degradation** - Errors in one destination don't affect others
3. **No Job Context** - Destinations accept context as parameters, not through global state
4. **Async Support** - All operations support async/await for I/O operations
5. **Pluggable** - Destinations can be added/removed without code changes
6. **Testable** - Pure functions and dependency injection make testing easy

## Error Handling

Destinations handle their own errors gracefully:

- **ConsoleDestination** - Attempts to write error to stderr
- **FileDestination** - Falls back to console.error
- **ApiDestination** - Silently fails to prevent cascading errors

This prevents log failures from disrupting the application while still providing feedback when possible.

### BatchedDestination

Generic batching wrapper that can wrap any destination to add batching capabilities.

**Configuration:**
```javascript
const { BatchedDestination, ConsoleDestination } = require('./logging/destinations');

// Wrap any destination with batching
const console = new ConsoleDestination();
const batchedConsole = new BatchedDestination(console, {
  maxBatchSize: 10,        // Flush after N logs
  flushInterval: 2000,     // Flush every N ms
  useBatchSend: true       // Try sendBatch() if available
});
```

**Features:**
- Wraps any BaseDestination implementation
- Buffers logs and sends in batches
- Automatic periodic flushing
- Graceful fallback to individual sends
- Composable - can wrap any destination

**How it works:**
1. Buffers incoming logs until `maxBatchSize` is reached
2. Flushes automatically every `flushInterval` milliseconds
3. If destination implements `sendBatch()`, uses it for efficiency
4. Falls back to individual `write()` calls if batch sending fails
5. Ensures all logs are flushed on `close()`

### ApiDestinationUnbatched

Low-level API destination without batching. Used internally by ApiDestination.

**Note:** This should not be used directly - use `ApiDestination` instead, which wraps this with `BatchedDestination` for optimal performance.

## Batching Pattern

The batching pattern is composable and can be applied to any destination:

```javascript
// Example 1: Batched API destination (built-in)
const api = new ApiDestination({ apiClient, jobId });

// Example 2: Manual batching of any destination
const file = new FileDestination({ workingDir, job, startTime, jobType });
const batchedFile = new BatchedDestination(file, {
  maxBatchSize: 20,
  flushInterval: 5000
});

// Example 3: Custom destination with batching
class SyslogDestination extends BaseDestination {
  async write(level, message, metadata) {
    // Send single log to syslog
  }

  async sendBatch(logs) {
    // Optional: efficient batch send
  }
}

const syslog = new SyslogDestination(config);
const batchedSyslog = new BatchedDestination(syslog, {
  maxBatchSize: 50,
  flushInterval: 1000
});
```

## Migration from SetupLogBatcher

The old `SetupLogBatcher` class is deprecated. Migrate to the new destination-based approach:

**Before:**
```javascript
const SetupLogBatcher = require('./setup-log-batcher');
const batcher = new SetupLogBatcher(apiClient, jobId, {
  maxBatchSize: 10,
  flushInterval: 2000,
  useBatchEndpoint: true
});
batcher.add('info', 'message', metadata);
await batcher.flush();
await batcher.shutdown();
```

**After:**
```javascript
const { ApiDestination } = require('./logging/destinations');
const destination = new ApiDestination({
  apiClient,
  jobId,
  maxBatchSize: 10,
  flushInterval: 2000,
  useBatchEndpoint: true
});
await destination.write('info', 'message', metadata);
await destination.flush();
await destination.close();
```

The old `SetupLogBatcher` is maintained for backward compatibility but internally uses the new destination-based implementation.

## Next Steps

- **LogManager** (Task #1) - Coordinates multiple destinations
- **Unit Tests** (Task #7) - Comprehensive test coverage for all destinations
