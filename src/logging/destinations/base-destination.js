/**
 * BaseDestination - Abstract base class for log destinations
 *
 * Defines the common interface that all log destinations must implement.
 * Each destination handles writing logs to a specific output (console, file, API, etc.)
 * and manages its own lifecycle (initialization, flushing, cleanup).
 *
 * Destinations are pluggable and independent - they can be added or removed without
 * affecting other destinations.
 */
class BaseDestination {
  /**
   * Create a new log destination
   * @param {Object} [config={}] - Destination-specific configuration
   */
  constructor(config = {}) {
    this.config = config;
    this.isShuttingDown = false;
  }

  /**
   * Write a log entry to this destination
   * Must be implemented by subclasses.
   * @param {string} level - Log level ('error', 'warn', 'info', 'debug')
   * @param {string} message - Log message
   * @param {Object} [metadata={}] - Structured metadata for filtering/searching
   * @returns {Promise<void>}
   * @abstract
   */
  async write(level, message, metadata = {}) {
    throw new Error('write() must be implemented by subclass');
  }

  /**
   * Flush any buffered logs
   * Some destinations (like API batchers) buffer logs for efficiency.
   * This ensures all pending logs are written immediately.
   * @returns {Promise<void>}
   */
  async flush() {
    // Default implementation - no buffering
    // Override in subclasses that implement buffering
  }

  /**
   * Close the destination and release resources
   * Called during shutdown to clean up connections, streams, timers, etc.
   * Should call flush() to ensure no logs are lost.
   * @returns {Promise<void>}
   */
  async close() {
    this.isShuttingDown = true;
    await this.flush();
  }

  /**
   * Check if this destination should accept a log at the given level
   * Allows destinations to filter logs based on their own criteria.
   * @param {string} level - Log level to check
   * @returns {boolean} True if this destination should handle this level
   */
  shouldLog(level) {
    // Default: accept all levels
    // Override in subclasses to implement filtering
    return true;
  }

  /**
   * Handle errors that occur during write operations
   * Provides a consistent error handling strategy across destinations.
   * By default, errors are silently caught to prevent log failures from
   * disrupting the application.
   * @param {Error} error - The error that occurred
   * @param {string} level - Log level of the failed write
   * @param {string} message - Log message of the failed write
   * @protected
   */
  handleError(error, level, message) {
    // Silent by default to prevent cascading failures
    // Subclasses can override to implement error reporting
    // (e.g., console.error for console destination)
  }
}

module.exports = BaseDestination;
