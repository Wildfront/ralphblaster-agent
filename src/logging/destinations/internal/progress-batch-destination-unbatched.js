const BaseDestination = require('../base-destination');

/**
 * ProgressBatchDestinationUnbatched - Sends progress updates to API
 *
 * Provides direct API progress logging without batching. Designed to be wrapped by
 * BatchedDestination for efficient batched sending.
 *
 * This class should NOT be used directly - use ProgressBatchDestination (which wraps
 * this with BatchedDestination) for production use.
 *
 * Uses the apiClient's built-in progress batching system:
 * - write() - sends single chunk via apiClient.sendProgress() (which batches internally)
 * - sendBatch() - flushes entire batch via apiClient.flushProgressBuffer()
 */
class ProgressBatchDestinationUnbatched extends BaseDestination {
  /**
   * Create a new unbatched progress destination
   * @param {Object} config - Configuration options
   * @param {Object} config.apiClient - API client with sendProgress() and flushProgressBuffer() methods
   * @param {number} config.jobId - Job ID to associate progress updates with
   */
  constructor(config) {
    super(config);

    if (!config.apiClient) {
      throw new Error('ProgressBatchDestinationUnbatched requires apiClient in config');
    }
    if (config.jobId === undefined || config.jobId === null) {
      throw new Error('ProgressBatchDestinationUnbatched requires jobId in config');
    }

    this.apiClient = config.apiClient;
    this.jobId = config.jobId;
  }

  /**
   * Write a single log entry as progress update to the API
   * Note: The API client has its own internal batching, so this doesn't send immediately
   * @param {string} level - Log level (ignored for progress updates)
   * @param {string} message - Log message/chunk
   * @param {Object} [metadata={}] - Structured metadata (ignored for progress updates)
   * @returns {Promise<void>}
   */
  async write(level, message, metadata = {}) {
    try {
      // Send to API client's progress buffer (batches internally)
      await this.apiClient.sendProgress(this.jobId, message);
    } catch (error) {
      this.handleError(error, level, message);
    }
  }

  /**
   * Send multiple log entries in a single batch API call
   * This is called by BatchedDestination when flushing buffered logs.
   * Flushes the API client's internal progress buffer.
   * @param {Array<Object>} logs - Array of log entries with {timestamp, level, message, metadata}
   * @returns {Promise<void>}
   */
  async sendBatch(logs) {
    if (logs.length === 0) return;

    try {
      // First, send all chunks to the buffer
      for (const log of logs) {
        await this.apiClient.sendProgress(this.jobId, log.message);
      }

      // Then flush the buffer to send everything in one batch
      await this.apiClient.flushProgressBuffer(this.jobId);
    } catch (error) {
      // Re-throw to let BatchedDestination handle fallback
      throw error;
    }
  }

  /**
   * Handle errors during API operations
   * Silently fails to prevent cascading errors
   * @param {Error} error - The error that occurred
   * @param {string} level - Log level of failed write
   * @param {string} message - Log message of failed write
   * @protected
   */
  handleError(error, level, message) {
    // Silent failure to prevent cascading errors
    // Progress updates are best-effort
  }
}

module.exports = ProgressBatchDestinationUnbatched;
