/**
 * Log Formatter Module
 *
 * Pure functions for log formatting without side effects.
 * All functions accept configuration parameters and are easily testable.
 */

const { formatDuration } = require('../utils/format');

// ANSI color codes for console output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

// Color by log level
const LEVEL_COLORS = {
  error: COLORS.red,
  warn: COLORS.yellow,
  info: COLORS.cyan,
  debug: COLORS.gray
};

/**
 * Truncate a string to specified length with ellipsis
 * Useful for preventing excessively long values in log output.
 * @param {string} str - String to truncate
 * @param {number} [maxLength=100] - Maximum length before truncation (includes ellipsis)
 * @returns {string} Truncated string with '...' suffix if truncated, original if shorter
 * @example
 *   truncateString('short') // 'short'
 *   truncateString('a very long string...', 10) // 'a very...'
 */
function truncateString(str, maxLength = 100) {
  if (typeof str !== 'string' || str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Redact sensitive data from logs
 * Automatically removes tokens, API keys, and credentials from log output.
 * Handles both string and object inputs, preserving original data structure.
 * @param {any} data - Data to redact (string, object, or other type)
 * @returns {any} Redacted data with sensitive patterns replaced with [REDACTED]
 * @example
 *   redactSensitiveData('Authorization: Bearer sk-1234') // 'Authorization: Bearer [REDACTED]'
 *   redactSensitiveData({ token: 'secret' }) // { token: '[REDACTED]' }
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
 * Safely stringify metadata handling circular references
 * Converts objects to JSON strings with protection against circular references.
 * Used for formatting structured log metadata for console/API output.
 * @param {*} obj - Object to stringify
 * @param {Object} [options={}] - Formatting options
 * @param {number} [options.indent=2] - Indentation level (0 for compact, 2 for pretty)
 * @returns {string} JSON string or error message if stringification fails
 * @example
 *   formatMetadata({ user: 'john' }) // '{\n  "user": "john"\n}'
 *   formatMetadata({ user: 'john' }, { indent: 0 }) // '{"user":"john"}'
 */
function formatMetadata(obj, options = {}) {
  const { indent = 2 } = options;
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
    }, indent);
  } catch (error) {
    return `[Unable to stringify: ${error.message}]`;
  }
}

/**
 * Format log level with optional color and prefix
 * Applies color coding and case formatting to log level strings.
 * @param {string} level - Log level (error, warn, info, debug)
 * @param {Object} [options={}] - Formatting options
 * @param {boolean} [options.colors=false] - Whether to apply ANSI color codes
 * @param {boolean} [options.uppercase=true] - Whether to uppercase the level
 * @returns {string} Formatted level string with optional color codes
 * @example
 *   formatLevel('error', { colors: true }) // '\x1b[31mERROR\x1b[0m'
 *   formatLevel('info', { uppercase: false }) // 'info'
 */
function formatLevel(level, options = {}) {
  const { colors = false, uppercase = true } = options;

  let formatted = uppercase ? level.toUpperCase() : level;

  if (colors) {
    const color = LEVEL_COLORS[level] || '';
    formatted = color + formatted + COLORS.reset;
  }

  return formatted;
}

/**
 * Format message with optional data for display
 * Extracts display-worthy fields and appends them to the message in human-readable format.
 * Handles special fields like component, duration, etc. with custom formatting.
 * @param {string} message - Log message
 * @param {*} data - Optional data to append (typically an object)
 * @param {Object} [options={}] - Formatting options
 * @param {boolean} [options.includeMetadata=true] - Include metadata fields in formatted message
 * @param {number} [options.maxFieldLength=50] - Max length for field values before truncation
 * @returns {string} Formatted message with appended data fields
 * @example
 *   formatMessage('Created', { component: 'worktree', duration: 3200 })
 *   // 'Created [worktree] (3.2s)'
 */
function formatMessage(message, data = null, options = {}) {
  const {
    includeMetadata = true,
    maxFieldLength = 50
  } = options;

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
        if (typeof value === 'string' && value.length > maxFieldLength) {
          parts.push(`${key}: ${truncateString(value, maxFieldLength)}`);
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
 * Format structured data for human-readable console output
 * Creates indented multi-line representation of object fields.
 * Skips component field (shown in prefix) and truncates long values.
 * @param {Object} data - Data object to format
 * @param {Object} [options={}] - Formatting options
 * @param {string} [options.indent='  '] - Indentation string for each line
 * @param {number} [options.maxKeys=20] - Maximum number of keys to display before showing count
 * @param {number} [options.maxValueLength=100] - Maximum length for values before truncation
 * @returns {string} Formatted multi-line string with newline prefix, or empty string
 * @example
 *   formatConsoleData({ userId: '123', email: 'user@example.com' })
 *   // '\n  userId: 123\n  email: user@example.com'
 */
function formatConsoleData(data, options = {}) {
  const {
    indent = '  ',
    maxKeys = 20,
    maxValueLength = 100
  } = options;

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return '';
  }

  const lines = [];

  // Skip component since it's already in the prefix
  const dataToShow = { ...data };
  delete dataToShow.component;

  // If too many keys, show count instead
  if (Object.keys(dataToShow).length > maxKeys) {
    return '\n' + indent + '[' + Object.keys(dataToShow).length + ' fields]';
  }

  // Format each key-value pair
  for (const [key, value] of Object.entries(dataToShow)) {
    if (value === null || value === undefined) continue;

    let formattedValue;
    if (typeof value === 'object') {
      // Nested objects - compact JSON on same line
      formattedValue = JSON.stringify(value);
    } else if (typeof value === 'string' && value.length > maxValueLength) {
      // Truncate long strings
      formattedValue = truncateString(value, maxValueLength);
    } else {
      formattedValue = String(value);
    }

    lines.push(`${indent}${key}: ${formattedValue}`);
  }

  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}

module.exports = {
  // Core formatting functions
  formatMessage,
  formatLevel,
  formatMetadata,
  redactSensitiveData,
  truncateString,
  formatConsoleData,

  // Export color constants for testing/external use
  COLORS,
  LEVEL_COLORS
};
