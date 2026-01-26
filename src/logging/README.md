# Logging Configuration

This directory contains centralized logging configuration for the Ralph Agent.

## Files

### `config.js`

Central configuration module that consolidates all logging-related settings:

- **Console Output Settings**: `logLevel`, `consoleColors`, `consoleFormat`
- **Log Batching Settings**: `maxBatchSize`, `flushInterval`, `useBatchEndpoint`
- **Agent Identification**: `agentId`

All settings are read from environment variables with sensible defaults and validation.

### `formatter.js`

Shared formatting utilities for log output:

- Message formatting and redaction
- Metadata formatting
- Color codes and styling

## Usage

### Importing Configuration

```javascript
const loggingConfig = require('./logging/config');

console.log(loggingConfig.logLevel);        // 'info'
console.log(loggingConfig.consoleColors);   // true
console.log(loggingConfig.maxBatchSize);    // 10
```

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RALPH_LOG_LEVEL` | string | `info` | Log level: error, warn, info, debug |
| `RALPH_CONSOLE_COLORS` | boolean | `true` | Enable/disable colored output |
| `RALPH_CONSOLE_FORMAT` | string | `pretty` | Console format: pretty, json |
| `RALPH_AGENT_ID` | string | `agent-default` | Agent identifier for multi-agent mode |
| `RALPH_MAX_BATCH_SIZE` | number | `10` | Max logs to batch before flush |
| `RALPH_FLUSH_INTERVAL` | number | `2000` | Milliseconds between auto-flushes |
| `RALPH_USE_BATCH_ENDPOINT` | boolean | `true` | Use batch API endpoint |

### Validation

The configuration module validates all values:

- **Log Level**: Must be one of `error`, `warn`, `info`, `debug` (falls back to `info`)
- **Console Format**: Must be one of `pretty`, `json` (falls back to `pretty`)
- **Numeric Values**: Must be positive integers (falls back to defaults)
- **Boolean Values**: Treats `false`, `0`, and empty string as false

Invalid values trigger a warning and use the default value.

### Immutability

The configuration object is frozen to prevent accidental modifications:

```javascript
loggingConfig.logLevel = 'debug'; // Fails silently in non-strict mode
console.log(loggingConfig.logLevel); // Still 'info'
```

## Migration Notes

Previously, logging settings were scattered across multiple files:

- `src/config.js` - logLevel, consoleColors, consoleFormat
- `src/setup-log-batcher.js` - maxBatchSize, flushInterval, useBatchEndpoint
- `src/index.js` - agentId

Now all settings are centralized in `src/logging/config.js`.

### Backward Compatibility

For backward compatibility, `src/config.js` re-exports the console-related settings:

```javascript
const config = require('./config');
console.log(config.logLevel); // Still works
```

However, new code should import directly from `logging/config`:

```javascript
const loggingConfig = require('./logging/config');
console.log(loggingConfig.logLevel); // Preferred
```
