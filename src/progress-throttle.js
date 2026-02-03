/**
 * ProgressThrottle - Adaptive throttling for progress updates
 *
 * Adjusts throttle interval based on update rate:
 * - Low rate (<5/sec): 100ms throttle (responsive)
 * - Medium rate (5-20/sec): 200ms throttle (balanced)
 * - High rate (>20/sec): 500ms throttle (reduced load)
 *
 * This prevents API overload during high-output jobs while maintaining
 * responsiveness for low-output jobs.
 */
class ProgressThrottle {
  constructor() {
    // Sliding window for rate calculation (5 seconds)
    this.WINDOW_MS = 5000;

    // Throttle intervals based on rate
    this.INTERVALS = {
      MIN: 100,    // Low rate: minimal throttling
      MEDIUM: 200, // Medium rate: moderate throttling
      MAX: 500     // High rate: aggressive throttling
    };

    // Rate thresholds (updates per second)
    this.RATE_THRESHOLDS = {
      LOW: 5,      // Below 5 updates/sec = low rate
      MEDIUM: 20   // Above 20 updates/sec = high rate
    };

    // Tracking state
    this.recentUpdates = [];  // Timestamps of recent updates
    this.lastUpdate = 0;      // Timestamp of last update
  }

  /**
   * Get current throttle interval based on recent update rate
   * @returns {number} Throttle interval in milliseconds
   */
  getInterval() {
    const now = Date.now();

    // Clean up old updates (beyond 5-second window)
    this.recentUpdates = this.recentUpdates.filter(
      timestamp => now - timestamp < this.WINDOW_MS
    );

    // If no recent updates, use minimum interval
    if (this.recentUpdates.length === 0) {
      return this.INTERVALS.MIN;
    }

    // Calculate actual time span of recent updates
    const oldestUpdate = Math.min(...this.recentUpdates);
    const timeSpanMs = now - oldestUpdate;

    // If all updates happened very recently (< 1 second), use that time span
    // Otherwise use the full window for rate calculation
    const effectiveWindowMs = Math.max(timeSpanMs, 1000); // At least 1 second
    const effectiveWindowSeconds = effectiveWindowMs / 1000;

    // Calculate updates per second based on effective window
    const updatesPerSecond = this.recentUpdates.length / effectiveWindowSeconds;

    // Determine interval based on rate
    if (updatesPerSecond > this.RATE_THRESHOLDS.MEDIUM) {
      return this.INTERVALS.MAX; // High rate: aggressive throttling
    } else if (updatesPerSecond > this.RATE_THRESHOLDS.LOW) {
      return this.INTERVALS.MEDIUM; // Medium rate: moderate throttling
    } else {
      return this.INTERVALS.MIN; // Low rate: minimal throttling
    }
  }

  /**
   * Check if update should be throttled
   * @returns {boolean} True if should throttle (skip), false if should allow
   */
  shouldThrottle() {
    const now = Date.now();
    const interval = this.getInterval();
    const timeSinceLastUpdate = now - this.lastUpdate;

    return timeSinceLastUpdate < interval;
  }

  /**
   * Record an update (call this when sending an update)
   */
  recordUpdate() {
    const now = Date.now();
    this.recentUpdates.push(now);
    this.lastUpdate = now;

    // Cleanup old updates to prevent memory growth
    this.recentUpdates = this.recentUpdates.filter(
      timestamp => now - timestamp < this.WINDOW_MS
    );
  }
}

module.exports = ProgressThrottle;
