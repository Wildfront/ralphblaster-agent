const BaseDestination = require('./base-destination');

/**
 * BatchedDestination - Generic batching wrapper for any log destination
 *
 * Wraps any destination implementing the BaseDestination interface and adds batching
 * capabilities. This reduces overhead for destinations that benefit from batched sends
 * (e.g., network-based destinations like API, syslog, etc.).
 *
 * Key features:
 * - Buffers logs and sends in batches to reduce overhead
 * - Automatic flush on buffer size or time interval
 * - Immediate flush on shutdown to prevent log loss
 * - Graceful fallback to individual sends if batch send fails
 * - Composable - can wrap any destination that implements write()
 *
 * Example usage:
 * ```javascript
 * const apiDestination = new ApiDestination(config);
 * const batchedApi = new BatchedDestination(apiDestination, {
 *   maxBatchSize: 10,
 *   flushInterval: 2000
 * });
 * ```
 */
class BatchedDestination extends BaseDestination {
  /**
   * Create a new batched destination wrapper
   * @param {BaseDestination} destination - The underlying destination to wrap
   * @param {Object} [config={}] - Batching configuration
   * @param {number} [config.maxBatchSize=10] - Maximum logs to buffer before flushing
   * @param {number} [config.flushInterval=2000] - Interval in ms to auto-flush buffered logs
   * @param {boolean} [config.useBatchSend=true] - Whether to try batch sending (via sendBatch)
   */
  constructor(destination, config = {}) {
    super(config);

    if (!destination) {
      throw new Error('BatchedDestination requires a destination to wrap');
    }

    this.destination = destination;
    this.buffer = [];

    // Configuration
    this.maxBatchSize = config.maxBatchSize || 10;
    this.flushInterval = config.flushInterval || 2000; // 2 seconds
    this.useBatchSend = config.useBatchSend !== false; // Default true

    // Start automatic flush timer
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);

    // Track if we're shutting down
    this.isShuttingDown = false;
  }

  /**
   * Add a log entry to the buffer
   * If buffer is full, automatically flushes.
   * If shutting down, sends immediately without batching.
   * @param {string} level - Log level ('error', 'warn', 'info', 'debug')
   * @param {string} message - Log message
   * @param {Object} [metadata={}] - Structured metadata
   * @returns {Promise<void>}
   */
  async write(level, message, metadata = {}) {
    if (this.isShuttingDown) {
      // If shutting down, send immediately without batching
      try {
        await this.destination.write(level, message, metadata);
      } catch (error) {
        this.handleError(error, level, message);
      }
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined
    };

    this.buffer.push(logEntry);

    // Flush if buffer is full
    if (this.buffer.length >= this.maxBatchSize) {
      await this.flush();
    }
  }

  /**
   * Flush buffered logs to the wrapped destination
   * Tries batch send first (if destination supports it), falls back to individual sends.
   * Safe to call when buffer is empty (no-op).
   * @returns {Promise<void>}
   */
  async flush() {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      // Check if destination supports batch sending
      if (this.useBatchSend && typeof this.destination.sendBatch === 'function') {
        // Try batch send (more efficient)
        await this.destination.sendBatch(batch);
      } else {
        // Fall back to individual sends
        await this.sendIndividually(batch);
      }
    } catch (error) {
      // If batch send fails, try individual sends as fallback
      try {
        await this.sendIndividually(batch);
      } catch (fallbackError) {
        this.handleError(fallbackError, 'error', 'Failed to send buffered logs');
      }
    }
  }

  /**
   * Send logs individually (fallback method)
   * Used when batch sending fails or is unavailable.
   * Silently fails individual log sends to prevent cascading errors.
   * @param {Array<Object>} logs - Array of log entries with {timestamp, level, message, metadata}
   * @returns {Promise<void>}
   * @private
   */
  async sendIndividually(logs) {
    const promises = logs.map(log =>
      this.destination.write(log.level, log.message, log.metadata)
        .catch((error) => {
          this.handleError(error, log.level, log.message);
        })
    );

    await Promise.all(promises);
  }

  /**
   * Shutdown the batcher and flush remaining logs
   * Stops the automatic flush timer and ensures all buffered logs are sent.
   * @returns {Promise<void>}
   */
  async close() {
    this.isShuttingDown = true;

    // Stop automatic flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining logs
    await this.flush();

    // Close the wrapped destination
    if (this.destination && typeof this.destination.close === 'function') {
      await this.destination.close();
    }
  }

  /**
   * Get current buffer size (for testing/debugging)
   * @returns {number} Number of logs currently buffered
   */
  getBufferSize() {
    return this.buffer.length;
  }

  /**
   * Check if this destination should accept a log at the given level
   * Delegates to the wrapped destination
   * @param {string} level - Log level to check
   * @returns {boolean} True if this destination should handle this level
   */
  shouldLog(level) {
    return this.destination.shouldLog(level);
  }

  /**
   * Handle errors during batching operations
   * @param {Error} error - The error that occurred
   * @param {string} level - Log level of failed write
   * @param {string} message - Log message of failed write
   * @protected
   */
  handleError(error, level, message) {
    // Delegate to wrapped destination's error handling
    if (typeof this.destination.handleError === 'function') {
      this.destination.handleError(error, level, message);
    }
  }
}

module.exports = BatchedDestination;
