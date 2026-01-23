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
  batcher: null  // SetupLogBatcher instance for batched log sending
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
 * @returns {string} Formatted message
 */
function formatMessage(message, data = null) {
  if (!data) return message;

  // If data is a simple object with jobId, format it nicely
  if (typeof data === 'object' && data !== null) {
    const parts = [];
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        parts.push(`${key}: ${value}`);
      }
    }
    if (parts.length > 0) {
      return `${message} (${parts.join(', ')})`;
    }
  }

  return message;
}

function log(level, message, data = null) {
  if (LOG_LEVELS[level] <= currentLevel) {
    const timestamp = new Date().toISOString();
    let prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    // Add agent ID to prefix for multi-agent traceability
    if (agentId) {
      prefix += ` [${agentId}]`;
    }

    // Add job ID to prefix if processing a job
    if (jobContext.jobId) {
      prefix += ` [job-${jobContext.jobId}]`;
    }

    // Redact sensitive data from message
    const safeMessage = redactSensitiveData(message);

    // Format for terminal output
    if (data) {
      // Redact and stringify data
      const redactedData = redactSensitiveData(data);
      console.log(prefix, safeMessage, safeStringify(redactedData));
    } else {
      console.log(prefix, safeMessage);
    }

    // Send to API if job context is set (for info and error levels only)
    // This makes internal logs visible in the UI's "Instance Setup Logs" section
    // Uses batching to reduce API overhead (10 logs -> 1 API call)
    if (jobContext.batcher && (level === 'info' || level === 'error')) {
      const formattedMessage = formatMessage(safeMessage, data);
      jobContext.batcher.add(level, formattedMessage);
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
   */
  setJobContext: (jobId, apiClient) => {
    jobContext.jobId = jobId;

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
  }
};
