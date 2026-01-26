const BaseDestination = require('./base-destination');
const {
  formatMessage,
  formatLevel,
  formatMetadata,
  redactSensitiveData,
  formatConsoleData
} = require('../formatter');

/**
 * ConsoleDestination - Outputs logs to console (stdout/stderr)
 *
 * Formats logs for human-readable console output with optional colors.
 * Supports both pretty (formatted) and JSON output modes.
 * Does not buffer - writes immediately for real-time visibility.
 */
class ConsoleDestination extends BaseDestination {
  /**
   * Create a new console destination
   * @param {Object} [config={}] - Configuration options
   * @param {boolean} [config.colors=true] - Enable colored output
   * @param {string} [config.format='pretty'] - Output format: 'pretty' or 'json'
   * @param {string} [config.minLevel='info'] - Minimum log level to output
   */
  constructor(config = {}) {
    super(config);

    this.colors = config.colors !== false;
    this.format = config.format || 'pretty';
    this.minLevel = config.minLevel || 'info';

    // Log level priorities for filtering
    this.levelPriorities = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }

  /**
   * Check if this destination should log at the given level
   * @param {string} level - Log level to check
   * @returns {boolean} True if should log
   */
  shouldLog(level) {
    const levelPriority = this.levelPriorities[level];
    const minPriority = this.levelPriorities[this.minLevel];

    if (levelPriority === undefined || minPriority === undefined) {
      return false;
    }

    return levelPriority <= minPriority;
  }

  /**
   * Write a log entry to console
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} [metadata={}] - Structured metadata
   * @returns {Promise<void>}
   */
  async write(level, message, metadata = {}) {
    if (!this.shouldLog(level)) {
      return;
    }

    try {
      // Redact sensitive data before output
      const safeMessage = redactSensitiveData(message);
      const safeMetadata = redactSensitiveData(metadata);

      let output;

      if (this.format === 'json') {
        output = this.formatJson(level, safeMessage, safeMetadata);
      } else {
        output = this.formatPretty(level, safeMessage, safeMetadata);
      }

      // Write to stderr for errors, stdout for everything else
      if (level === 'error') {
        console.error(output);
      } else {
        console.log(output);
      }
    } catch (error) {
      this.handleError(error, level, message);
    }
  }

  /**
   * Format log entry as JSON
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} metadata - Log metadata
   * @returns {string} JSON formatted log
   * @private
   */
  formatJson(level, message, metadata) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };

    // Add metadata if present
    if (metadata && Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }

    return formatMetadata(entry, { indent: 0 });
  }

  /**
   * Format log entry for pretty console output
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} metadata - Log metadata
   * @returns {string} Pretty formatted log
   * @private
   */
  formatPretty(level, message, metadata) {
    const timestamp = new Date().toISOString();
    const formattedLevel = formatLevel(level, {
      colors: this.colors,
      uppercase: true
    });

    // Format message with metadata inline
    const formattedMessage = formatMessage(message, metadata, {
      includeMetadata: true,
      maxFieldLength: 100
    });

    // Build output line
    let output = `[${timestamp}] ${formattedLevel} ${formattedMessage}`;

    // Add detailed metadata if present (excluding fields already shown inline)
    const detailedData = formatConsoleData(metadata, {
      indent: '  ',
      maxKeys: 20,
      maxValueLength: 200
    });

    if (detailedData) {
      output += detailedData;
    }

    return output;
  }

  /**
   * Handle errors during console writing
   * Attempts to output error to stderr as last resort
   * @param {Error} error - The error that occurred
   * @param {string} level - Log level of failed write
   * @param {string} message - Log message of failed write
   * @protected
   */
  handleError(error, level, message) {
    try {
      // Try to output a minimal error message
      console.error(`[ConsoleDestination Error] Failed to write log: ${error.message}`);
    } catch {
      // If even this fails, give up silently
    }
  }
}

module.exports = ConsoleDestination;
