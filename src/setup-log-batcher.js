const logger = require('./logger');

/**
 * Batches setup logs to reduce API call overhead
 * Automatically flushes when buffer is full or at regular intervals
 */
class SetupLogBatcher {
  constructor(apiClient, jobId, config = {}) {
    this.apiClient = apiClient;
    this.jobId = jobId;
    this.buffer = [];

    // Configuration
    this.maxBatchSize = config.maxBatchSize || 10;
    this.flushInterval = config.flushInterval || 2000; // 2 seconds
    this.useBatchEndpoint = config.useBatchEndpoint !== false; // Default true

    // Start automatic flush timer
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);

    // Track if we're shutting down
    this.isShuttingDown = false;
  }

  /**
   * Add a log entry to the buffer
   * @param {string} level - Log level ('info' or 'error')
   * @param {string} message - Log message
   * @param {Object} metadata - Optional structured metadata (Phase 3)
   */
  add(level, message, metadata = null) {
    if (this.isShuttingDown) {
      // If shutting down, send immediately without batching
      this.apiClient.addSetupLog(this.jobId, level, message, metadata).catch(() => {});
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      message: message
    };

    // Add metadata if present (Phase 3)
    if (metadata && Object.keys(metadata).length > 0) {
      logEntry.metadata = metadata;
    }

    this.buffer.push(logEntry);

    // Flush if buffer is full
    if (this.buffer.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Flush buffered logs to API
   * Tries batch endpoint first, falls back to individual sends
   */
  async flush() {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      if (this.useBatchEndpoint && this.apiClient.addSetupLogBatch) {
        // Try batch endpoint (more efficient)
        await this.apiClient.addSetupLogBatch(this.jobId, batch);
        logger.debug(`Flushed ${batch.length} setup logs (batched)`);
      } else {
        // Fall back to individual sends
        await this.sendIndividually(batch);
      }
    } catch (error) {
      // If batch endpoint fails, try individual sends as fallback
      logger.debug(`Batch send failed, falling back to individual sends: ${error.message}`);
      await this.sendIndividually(batch);
    }
  }

  /**
   * Send logs individually (fallback method)
   * @param {Array} logs - Array of log entries
   */
  async sendIndividually(logs) {
    const promises = logs.map(log =>
      this.apiClient.addSetupLog(this.jobId, log.level, log.message, log.metadata)
        .catch(() => {}) // Silently fail individual logs
    );

    await Promise.all(promises);
    logger.debug(`Flushed ${logs.length} setup logs (individual)`);
  }

  /**
   * Shutdown the batcher and flush remaining logs
   * Call this when job completes
   */
  async shutdown() {
    this.isShuttingDown = true;

    // Stop automatic flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining logs
    await this.flush();
  }

  /**
   * Get current buffer size (for testing/debugging)
   */
  getBufferSize() {
    return this.buffer.length;
  }
}

module.exports = SetupLogBatcher;
