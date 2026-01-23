const config = require('./config');
const SetupLogBatcher = require('./setup-log-batcher');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[config.logLevel] || LOG_LEVELS.info;

// Agent ID for multi-agent support (set when agent starts)
let agentId = null;

// Job context for API logging (set when job starts)
let jobContext = {
  jobId: null,
  batcher: null,  // SetupLogBatcher instance for batched log sending
  globalContext: {}  // Global context added to all logs (Phase 3)
};

/**
 * Redact sensitive data from logs
 * @param {any} data - Data to redact
 * @returns {any} Redacted data
 */
function redactSensitiveData(data) {
  if (!data) return data;

  try {
    // Convert to string for pattern matching
    let dataStr = typeof data === 'string' ? data : JSON.stringify(data);

    // Redact common token patterns
    dataStr = dataStr
      .replace(/"Authorization":\s*"Bearer [^"]+"/g, '"Authorization": "Bearer [REDACTED]"')
      .replace(/Authorization:\s*Bearer\s+[^\s,}]+/g, 'Authorization: Bearer [REDACTED]')
      .replace(/RALPH_API_TOKEN=[^\s&]+/g, 'RALPH_API_TOKEN=[REDACTED]')
      .replace(/"apiToken":\s*"[^"]+"/g, '"apiToken": "[REDACTED]"')
      .replace(/"token":\s*"[^"]+"/g, '"token": "[REDACTED]"')
      .replace(/"api_token":\s*"[^"]+"/g, '"api_token": "[REDACTED]"')
      .replace(/Bearer\s+[A-Za-z0-9_-]{20,}/g, 'Bearer [REDACTED]');

    // Return in original format
    if (typeof data === 'string') {
      return dataStr;
    } else {
      try {
        return JSON.parse(dataStr);
      } catch {
        return dataStr; // Return string if can't parse back
      }
    }
  } catch (error) {
    // If redaction fails, return safe placeholder
    return '[REDACTION_ERROR]';
  }
}

/**
 * Safe JSON stringify that handles circular references
 * @param {*} obj - Object to stringify
 * @returns {string} JSON string or error message
 */
function safeStringify(obj) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (key, value) => {
      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    }, 2);
  } catch (error) {
    return `[Unable to stringify: ${error.message}]`;
  }
}

/**
 * Format message with optional data for display
 * @param {string} message - Log message
 * @param {*} data - Optional data to append
 * @param {boolean} includeMetadata - Include metadata in formatted message
 * @returns {string} Formatted message
 */
function formatMessage(message, data = null, includeMetadata = true) {
  if (!data) return message;

  // If data is a simple object, format it nicely
  if (typeof data === 'object' && data !== null) {
    // Extract display-worthy fields (not internal metadata)
    const displayFields = {};
    const metadataFields = ['component', 'operation', 'eventType', 'category', 'action', 'duration', 'durationMs'];

    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        // Skip internal fields unless includeMetadata is true
        if (!includeMetadata && metadataFields.includes(key)) continue;
        displayFields[key] = value;
      }
    }

    if (Object.keys(displayFields).length > 0) {
      const parts = [];

      // Show component first if present
      if (displayFields.component) {
        parts.push(`[${displayFields.component}]`);
        delete displayFields.component;
      }

      // Show duration nicely if present
      if (displayFields.duration || displayFields.durationMs) {
        const duration = displayFields.duration || displayFields.durationMs;
        parts.push(`(${formatDuration(duration)})`);
        delete displayFields.duration;
        delete displayFields.durationMs;
      }

      // Show remaining fields
      for (const [key, value] of Object.entries(displayFields)) {
        if (typeof value === 'string' && value.length > 50) {
          parts.push(`${key}: ${value.substring(0, 47)}...`);
        } else {
          parts.push(`${key}: ${value}`);
        }
      }

      if (parts.length > 0) {
        return `${message} ${parts.join(' ')}`;
      }
    }
  }

  return message;
}

/**
 * Format duration in human-readable form
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function log(level, message, data = null) {
  if (LOG_LEVELS[level] <= currentLevel) {
    const timestamp = new Date().toISOString();
    let prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    // Merge global context with log data (Phase 3)
    const enrichedData = data ? {...jobContext.globalContext, ...data} : {...jobContext.globalContext};
    const hasData = Object.keys(enrichedData).length > 0;

    // Add agent ID to prefix for multi-agent traceability
    if (agentId) {
      prefix += ` [${agentId}]`;
    }

    // Add job ID to prefix if processing a job
    if (jobContext.jobId) {
      prefix += ` [job-${jobContext.jobId}]`;
    }

    // Add component to prefix if present
    if (enrichedData.component) {
      prefix += ` [${enrichedData.component}]`;
    }

    // Redact sensitive data from message
    const safeMessage = redactSensitiveData(message);

    // Format for terminal output
    if (hasData) {
      // Redact and stringify data
      const redactedData = redactSensitiveData(enrichedData);
      console.log(prefix, safeMessage, safeStringify(redactedData));
    } else {
      console.log(prefix, safeMessage);
    }

    // Send to API if job context is set (for info and error levels only)
    // This makes internal logs visible in the UI's "Instance Setup Logs" section
    // Uses batching to reduce API overhead (10 logs -> 1 API call)
    if (jobContext.batcher && (level === 'info' || level === 'error')) {
      const formattedMessage = formatMessage(safeMessage, enrichedData);

      // Send structured metadata to API (Phase 3)
      jobContext.batcher.add(level, formattedMessage, enrichedData);
    }
  }
}

module.exports = {
  error: (msg, data) => log('error', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  info: (msg, data) => log('info', msg, data),
  debug: (msg, data) => log('debug', msg, data),

  /**
   * Set agent ID for multi-agent support
   * @param {string} id - Agent ID (e.g., 'agent-1', 'agent-2')
   */
  setAgentId: (id) => {
    agentId = id;
  },

  /**
   * Set job context for API logging
   * When set, info and error logs will be sent to the API's "Instance Setup Logs"
   * Uses batching to reduce API overhead (flushes every 2s or when 10 logs buffered)
   * @param {number} jobId - Job ID
   * @param {Object} apiClient - API client instance
   * @param {Object} context - Optional global context to add to all logs (Phase 3)
   */
  setJobContext: (jobId, apiClient, context = {}) => {
    jobContext.jobId = jobId;
    jobContext.globalContext = context;

    // Create batcher for efficient log sending
    jobContext.batcher = new SetupLogBatcher(apiClient, jobId, {
      maxBatchSize: 10,      // Flush when 10 logs buffered
      flushInterval: 2000,   // Flush every 2 seconds
      useBatchEndpoint: true // Try batch endpoint first, fall back to individual
    });
  },

  /**
   * Clear job context (called when job completes)
   * Ensures all buffered logs are flushed before shutdown
   */
  clearJobContext: async () => {
    // Shutdown batcher and flush remaining logs
    if (jobContext.batcher) {
      await jobContext.batcher.shutdown();
      jobContext.batcher = null;
    }

    jobContext.jobId = null;
    jobContext.globalContext = {};
  },

  // ===== Phase 3: Enhanced Structured Logging =====

  /**
   * Set global context that will be included in all subsequent logs
   * @param {string|Object} keyOrContext - Key name or object with multiple keys
   * @param {*} value - Value (only if first param is a string)
   * @example
   *   logger.setContext('component', 'worktree')
   *   logger.setContext({ component: 'worktree', operation: 'create' })
   */
  setContext: (keyOrContext, value) => {
    if (typeof keyOrContext === 'object') {
      jobContext.globalContext = {...jobContext.globalContext, ...keyOrContext};
    } else {
      jobContext.globalContext[keyOrContext] = value;
    }
  },

  /**
   * Create a child logger with additional context
   * Context is additive - child inherits parent context and adds its own
   * @param {Object} context - Additional context for this child logger
   * @returns {Object} Child logger with all parent methods
   * @example
   *   const worktreeLogger = logger.child({ component: 'worktree' })
   *   worktreeLogger.info('Creating worktree') // Includes component: 'worktree'
   */
  child: (context) => {
    const childContext = {...jobContext.globalContext, ...context};

    return {
      error: (msg, data) => log('error', msg, {...childContext, ...data}),
      warn: (msg, data) => log('warn', msg, {...childContext, ...data}),
      info: (msg, data) => log('info', msg, {...childContext, ...data}),
      debug: (msg, data) => log('debug', msg, {...childContext, ...data}),
      event: (eventType, data) => module.exports.event(eventType, {...childContext, ...data}),
      startTimer: (operation) => module.exports.startTimer(operation, childContext),
      measure: (operation, fn) => module.exports.measure(operation, fn, childContext),
      child: (additionalContext) => module.exports.child({...childContext, ...additionalContext})
    };
  },

  /**
   * Log a semantic event with structured metadata
   * @param {string} eventType - Event type in format 'category.action' (e.g., 'worktree.created')
   * @param {Object} data - Additional event data
   * @example
   *   logger.event('worktree.created', { path: '/path/to/worktree', duration: 3200 })
   */
  event: (eventType, data = {}) => {
    const [category, action] = eventType.split('.');
    const eventData = {
      eventType,
      category,
      action,
      ...data
    };

    // Determine level based on action
    const level = action === 'failed' || action === 'error' ? 'error' : 'info';

    // Format message from action
    const message = action ? action.charAt(0).toUpperCase() + action.slice(1) : eventType;

    log(level, message, eventData);
  },

  /**
   * Start a performance timer for an operation
   * @param {string} operation - Operation name (e.g., 'worktree.create')
   * @param {Object} initialContext - Initial context for the operation
   * @returns {Object} Timer object with done() method
   * @example
   *   const timer = logger.startTimer('worktree.create')
   *   // ... do work ...
   *   timer.done({ path: '/path/to/worktree' }) // Logs duration automatically
   */
  startTimer: (operation, initialContext = {}) => {
    const startTime = Date.now();

    return {
      done: (data = {}) => {
        const duration = Date.now() - startTime;
        module.exports.event(`${operation}.complete`, {
          ...initialContext,
          ...data,
          duration,
          durationMs: duration
        });
        return duration;
      }
    };
  },

  /**
   * Measure and log an async operation automatically
   * @param {string} operation - Operation name (e.g., 'prd.conversion')
   * @param {Function} fn - Async function to measure
   * @param {Object} context - Additional context
   * @returns {Promise<*>} Result of the async function
   * @example
   *   const result = await logger.measure('prd.conversion', async () => {
   *     return await convertPRD(job)
   *   })
   *   // Logs: prd.conversion.started, then prd.conversion.complete with duration
   */
  measure: async (operation, fn, context = {}) => {
    module.exports.event(`${operation}.started`, context);
    const timer = module.exports.startTimer(operation, context);

    try {
      const result = await fn();
      timer.done({success: true});
      return result;
    } catch (error) {
      timer.done({success: false, error: error.message});
      throw error;
    }
  }
};
