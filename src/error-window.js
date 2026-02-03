/**
 * ErrorWindow - Time-window based error rate tracking for circuit breaker
 *
 * Tracks errors over a sliding time window and determines if error rate
 * exceeds acceptable thresholds. This allows:
 * - Recovery from transient errors (old errors age out)
 * - Better detection of sustained failures
 * - Avoids premature shutdown on isolated error spikes
 *
 * Shutdown threshold: >50% error rate in last 60 seconds
 * Assumes ~5 second interval between requests
 */
class ErrorWindow {
  constructor() {
    // Sliding window for error tracking (60 seconds)
    this.WINDOW_MS = 60000;

    // Assumed request interval for rate calculation (5 seconds)
    this.REQUEST_INTERVAL_MS = 5000;

    // Shutdown threshold: error rate > 50%
    this.SHUTDOWN_THRESHOLD = 0.5;

    // Tracking state
    this.errors = []; // Timestamps of errors
  }

  /**
   * Record an error
   */
  addError() {
    const now = Date.now();
    this.errors.push(now);

    // Cleanup old errors to prevent memory growth
    this.cleanupOldErrors();
  }

  /**
   * Check if agent should shutdown based on error rate
   * @returns {boolean} True if should shutdown
   */
  shouldShutdown() {
    this.cleanupOldErrors();

    const errorCount = this.errors.length;

    // No errors = no shutdown
    if (errorCount === 0) {
      return false;
    }

    // Calculate expected number of requests in window
    const windowSeconds = this.WINDOW_MS / 1000;
    const requestIntervalSeconds = this.REQUEST_INTERVAL_MS / 1000;
    const estimatedRequests = windowSeconds / requestIntervalSeconds;

    // Calculate error rate
    const errorRate = errorCount / estimatedRequests;

    // Shutdown if error rate exceeds threshold
    return errorRate > this.SHUTDOWN_THRESHOLD;
  }

  /**
   * Get current error count (within window)
   * @returns {number} Number of errors in window
   */
  getErrorCount() {
    this.cleanupOldErrors();
    return this.errors.length;
  }

  /**
   * Remove errors outside the time window
   * @private
   */
  cleanupOldErrors() {
    const now = Date.now();
    this.errors = this.errors.filter(
      timestamp => now - timestamp < this.WINDOW_MS
    );
  }
}

module.exports = ErrorWindow;
