/**
 * @deprecated This class is deprecated. Use ApiDestination from src/logging/destinations instead.
 *
 * SetupLogBatcher - Legacy batching implementation
 *
 * This class is maintained for backward compatibility but wraps the new
 * BatchedDestination and ApiDestinationUnbatched implementations internally.
 *
 * Migration guide:
 * ```javascript
 * // Old:
 * const SetupLogBatcher = require('./setup-log-batcher');
 * const batcher = new SetupLogBatcher(apiClient, jobId, config);
 * batcher.add('info', 'message', metadata);
 * await batcher.shutdown();
 *
 * // New:
 * const { ApiDestination } = require('./logging/destinations');
 * const destination = new ApiDestination({ apiClient, jobId, ...config });
 * await destination.write('info', 'message', metadata);
 * await destination.close();
 * ```
 *
 * Configuration values are typically provided from src/logging/config.js
 */

const BatchedDestination = require('./logging/destinations/batched-destination');
const ApiDestinationUnbatched = require('./logging/destinations/api-destination-unbatched');

class SetupLogBatcher {
  /**
   * Create a new SetupLogBatcher instance
   * @param {Object} apiClient - API client instance with addSetupLog() and optionally addSetupLogBatch() methods
   * @param {number} jobId - Job ID to associate logs with
   * @param {Object} [config] - Configuration options
   * @param {number} [config.maxBatchSize=10] - Maximum number of logs to buffer before flushing
   * @param {number} [config.flushInterval=2000] - Interval in ms to automatically flush buffered logs
   * @param {boolean} [config.useBatchEndpoint=true] - Whether to try batch endpoint first before falling back to individual sends
   */
  constructor(apiClient, jobId, config = {}) {
    // Store for backward compatibility
    this.apiClient = apiClient;
    this.jobId = jobId;
    this.maxBatchSize = config.maxBatchSize || 10;
    this.flushInterval = config.flushInterval || 2000;
    this.useBatchEndpoint = config.useBatchEndpoint !== false;
    this.isShuttingDown = false;

    // Use the new destination-based implementation internally
    const unbatchedDestination = new ApiDestinationUnbatched({
      apiClient,
      jobId,
      useBatchEndpoint: this.useBatchEndpoint
    });

    this._destination = new BatchedDestination(unbatchedDestination, {
      maxBatchSize: this.maxBatchSize,
      flushInterval: this.flushInterval,
      useBatchSend: this.useBatchEndpoint
    });
  }

  /**
   * Add a log entry to the buffer
   * If buffer is full (reaches maxBatchSize), automatically flushes.
   * If shutting down, sends immediately without batching.
   * @param {string} level - Log level ('info' or 'error')
   * @param {string} message - Log message
   * @param {Object} [metadata=null] - Optional structured metadata for filtering/searching
   */
  add(level, message, metadata = null) {
    // Delegate to the new destination implementation
    this._destination.write(level, message, metadata || {}).catch(() => {
      // Silently fail to maintain backward compatibility
    });
  }

  /**
   * Flush buffered logs to API
   * Tries batch endpoint first (if available), falls back to individual sends on error.
   * Safe to call when buffer is empty (no-op).
   * @returns {Promise<void>}
   */
  async flush() {
    await this._destination.flush();
  }

  /**
   * Shutdown the batcher and flush remaining logs
   * Stops the automatic flush timer and ensures all buffered logs are sent.
   * Call this when job completes to prevent log loss.
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.isShuttingDown = true;
    await this._destination.close();
  }

  /**
   * Get current buffer size (for testing/debugging)
   * @returns {number} Number of logs currently buffered
   */
  getBufferSize() {
    return this._destination.getBufferSize();
  }
}

module.exports = SetupLogBatcher;
