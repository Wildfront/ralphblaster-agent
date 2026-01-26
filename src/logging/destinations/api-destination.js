const BatchedDestination = require('./batched-destination');
const ApiDestinationUnbatched = require('./api-destination-unbatched');

/**
 * ApiDestination - Sends logs to API with batching
 *
 * Provides API-based logging with automatic batching to reduce overhead.
 * Wraps ApiDestinationUnbatched with BatchedDestination for efficient sending.
 * Batches multiple log entries and flushes automatically based on buffer size or time interval.
 *
 * This is a convenience factory that creates a properly configured batched API destination.
 */
class ApiDestination extends BatchedDestination {
  /**
   * Create a new batched API destination
   * @param {Object} config - Configuration options
   * @param {Object} config.apiClient - API client with addSetupLog() and addSetupLogBatch() methods
   * @param {number} config.jobId - Job ID to associate logs with
   * @param {number} [config.maxBatchSize=10] - Maximum logs to buffer before flushing
   * @param {number} [config.flushInterval=2000] - Interval in ms to auto-flush
   * @param {boolean} [config.useBatchEndpoint=true] - Whether to use batch endpoint
   */
  constructor(config) {
    // Create unbatched API destination
    const unbatchedDestination = new ApiDestinationUnbatched({
      apiClient: config.apiClient,
      jobId: config.jobId,
      useBatchEndpoint: config.useBatchEndpoint
    });

    // Wrap it with batching
    super(unbatchedDestination, {
      maxBatchSize: config.maxBatchSize,
      flushInterval: config.flushInterval,
      useBatchSend: config.useBatchEndpoint
    });
  }
}

module.exports = ApiDestination;
