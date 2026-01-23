const config = require('./config');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[config.logLevel] || LOG_LEVELS.info;

// Job context for API logging (set when job starts)
let jobContext = {
  jobId: null,
  apiClient: null
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
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

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
    if (jobContext.apiClient && jobContext.jobId && (level === 'info' || level === 'error')) {
      const formattedMessage = formatMessage(safeMessage, data);
      jobContext.apiClient.addSetupLog(jobContext.jobId, level, formattedMessage)
        .catch(() => {
          // Silently fail - this is best-effort and we don't want to create circular logging
        });
    }
  }
}

module.exports = {
  error: (msg, data) => log('error', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  info: (msg, data) => log('info', msg, data),
  debug: (msg, data) => log('debug', msg, data),

  /**
   * Set job context for API logging
   * When set, info and error logs will be sent to the API's "Instance Setup Logs"
   * @param {number} jobId - Job ID
   * @param {Object} apiClient - API client instance
   */
  setJobContext: (jobId, apiClient) => {
    jobContext.jobId = jobId;
    jobContext.apiClient = apiClient;
  },

  /**
   * Clear job context (called when job completes)
   */
  clearJobContext: () => {
    jobContext.jobId = null;
    jobContext.apiClient = null;
  }
};
