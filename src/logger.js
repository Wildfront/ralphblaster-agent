const config = require('./config');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[config.logLevel] || LOG_LEVELS.info;

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

function log(level, message, data = null) {
  if (LOG_LEVELS[level] <= currentLevel) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    // Redact sensitive data from message
    const safeMessage = redactSensitiveData(message);

    if (data) {
      // Redact and stringify data
      const redactedData = redactSensitiveData(data);
      console.log(prefix, safeMessage, safeStringify(redactedData));
    } else {
      console.log(prefix, safeMessage);
    }
  }
}

module.exports = {
  error: (msg, data) => log('error', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  info: (msg, data) => log('info', msg, data),
  debug: (msg, data) => log('debug', msg, data)
};
