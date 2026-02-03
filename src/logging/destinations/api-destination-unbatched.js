const BaseDestination = require('./base-destination');

/**
 * ApiDestinationUnbatched - Sends individual logs to API
 *
 * Provides direct API logging without batching. Designed to be wrapped by
 * BatchedDestination for efficient batched sending.
 *
 * This class should NOT be used directly - use ApiDestination (which wraps
 * this with BatchedDestination) for production use.
 *
 * Supports both single log and batch log endpoints:
 * - write() - sends single log via apiClient.addSetupLog()
 * - sendBatch() - sends multiple logs via apiClient.addSetupLogBatch()
 */
class ApiDestinationUnbatched extends BaseDestination {
  /**
   * Create a new unbatched API destination
   * @param {Object} config - Configuration options
   * @param {Object} config.apiClient - API client with addSetupLog() and addSetupLogBatch() methods
   * @param {number} config.jobId - Job ID to associate logs with
   * @param {boolean} [config.useBatchEndpoint=true] - Whether to use batch endpoint for sendBatch()
   */
  constructor(config) {
    super(config);

    if (!config.apiClient) {
      throw new Error('ApiDestinationUnbatched requires apiClient in config');
    }
    if (config.jobId === undefined || config.jobId === null) {
      throw new Error('ApiDestinationUnbatched requires jobId in config');
    }

    this.apiClient = config.apiClient;
    this.jobId = config.jobId;
    this.useBatchEndpoint = config.useBatchEndpoint !== false;
  }

  /**
   * Write a single log entry to the API
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} [metadata={}] - Structured metadata
   * @returns {Promise<void>}
   */
  async write(level, message, metadata = {}) {
    try {
      await this.apiClient.addSetupLog(
        this.jobId,
        level,
        message,
        metadata && Object.keys(metadata).length > 0 ? metadata : null
      );
    } catch (error) {
      this.handleError(error, level, message);
    }
  }

  /**
   * Send multiple log entries in a single batch API call
   * This is called by BatchedDestination when flushing buffered logs.
   * @param {Array<Object>} logs - Array of log entries with {timestamp, level, message, metadata}
   * @returns {Promise<void>}
   */
  async sendBatch(logs) {
    if (logs.length === 0) return;

    try {
      if (this.useBatchEndpoint && this.apiClient.addSetupLogBatch) {
        // Use efficient batch endpoint
        await this.apiClient.addSetupLogBatch(this.jobId, logs);
      } else {
        // Fall back to individual sends
        await this.sendIndividually(logs);
      }
    } catch (error) {
      // Re-throw to let BatchedDestination handle fallback
      throw error;
    }
  }

  /**
   * Send logs individually
   * Used as fallback when batch endpoint fails or is unavailable.
   * @param {Array<Object>} logs - Array of log entries
   * @returns {Promise<void>}
   * @private
   */
  async sendIndividually(logs) {
    const promises = logs.map(log =>
      this.apiClient.addSetupLog(this.jobId, log.level, log.message, log.metadata)
        .catch((error) => {
          // Silently fail individual logs to prevent cascading errors
          this.handleError(error, log.level, log.message);
        })
    );

    await Promise.all(promises);
  }

  /**
   * Handle errors during API operations
   * Silently fails to prevent cascading errors, but could be enhanced
   * to report to a fallback destination (e.g., console or file)
   * @param {Error} error - The error that occurred
   * @param {string} level - Log level of failed write
   * @param {string} message - Log message of failed write
   * @protected
   */
  handleError(error, level, message) {
    // Silently fail - setup logs are best-effort and shouldn't disrupt job execution
    // Logging errors about logging would create cascading failures and noise
    // If API logging fails, the job continues unaffected
    // console.error(`[ApiDestination Error] Failed to send log: ${error.message}`);
  }
}

module.exports = ApiDestinationUnbatched;
