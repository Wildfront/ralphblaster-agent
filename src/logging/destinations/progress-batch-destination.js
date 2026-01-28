const BatchedDestination = require('./batched-destination');
const ProgressBatchDestinationUnbatched = require('./progress-batch-destination-unbatched');

/**
 * ProgressBatchDestination - Sends progress updates to API with batching
 *
 * Provides API-based progress logging with automatic batching to reduce overhead.
 * Wraps ProgressBatchDestinationUnbatched with BatchedDestination for efficient sending.
 * Batches multiple log entries and flushes automatically based on buffer size or time interval.
 *
 * This is used to send real-time job output to the UI instead of writing to log files.
 * The Rails server broadcasts these updates immediately to connected browsers.
 *
 * This is a convenience factory that creates a properly configured batched progress destination.
 */
class ProgressBatchDestination extends BatchedDestination {
  /**
   * Create a new batched progress destination
   * @param {Object} config - Configuration options
   * @param {Object} config.apiClient - API client with sendProgress() and flushProgressBuffer() methods
   * @param {number} config.jobId - Job ID to associate progress updates with
   * @param {number} [config.maxBatchSize=10] - Maximum logs to buffer before flushing
   * @param {number} [config.flushInterval=2000] - Interval in ms to auto-flush
   */
  constructor(config) {
    // Create unbatched progress destination
    const unbatchedDestination = new ProgressBatchDestinationUnbatched({
      apiClient: config.apiClient,
      jobId: config.jobId
    });

    // Wrap it with batching
    super(unbatchedDestination, {
      maxBatchSize: config.maxBatchSize || 10,
      flushInterval: config.flushInterval || 2000,
      useBatchSend: true
    });
  }
}

module.exports = ProgressBatchDestination;
