const loggingConfig = require('./logging/config');
const SetupLogBatcher = require('./setup-log-batcher');
const LogManager = require('./logging/log-manager');
const { ConsoleDestination } = require('./logging/destinations');

// Create console destination with centralized config
const consoleDestination = new ConsoleDestination({
  colors: loggingConfig.consoleColors,
  format: loggingConfig.consoleFormat,
  minLevel: loggingConfig.logLevel
});

// Initialize LogManager with console destination
// API destination will be added dynamically when job context is set
const logManager = new LogManager([consoleDestination], {
  agentId: loggingConfig.agentId
});

// Legacy job context tracking for backward compatibility
// This tracks the SetupLogBatcher for the clearJobContext API
let legacyJobContext = {
  batcher: null
};

/**
 * Internal log function that delegates to LogManager
 * Maintains backward compatibility with the existing logging API
 * @param {string} level - Log level ('error', 'warn', 'info', 'debug')
 * @param {string} message - Log message to output
 * @param {Object|null} data - Optional structured metadata to include
 * @private
 */
function log(level, message, data = null) {
  // Delegate to LogManager (non-blocking)
  logManager[level](message, data || {}).catch(() => {
    // Silently handle errors to prevent cascading failures
  });

  // For error level, also trigger immediate flush on legacy batcher if present
  if (level === 'error' && legacyJobContext.batcher) {
    legacyJobContext.batcher.flush().catch(() => {}); // Best-effort immediate flush
  }
}

module.exports = {
  /**
   * Log an error message (level 0 - always visible)
   * Used for critical errors requiring immediate attention.
   * Sent to API if job context is set, and flushed immediately (doesn't wait for batch).
   * @param {string} msg - Error message
   * @param {Object} [data] - Optional structured metadata
   * @example
   *   logger.error('Database connection failed', { error: err.message })
   */
  error: (msg, data) => log('error', msg, data),

  /**
   * Log a warning message (level 1)
   * Used for concerning conditions that should be reviewed but aren't critical.
   * Warning logs are NOT sent to the API (local only).
   * @param {string} msg - Warning message
   * @param {Object} [data] - Optional structured metadata
   * @example
   *   logger.warn('Disk space low', { available: '5%' })
   */
  warn: (msg, data) => log('warn', msg, data),

  /**
   * Log an info message (level 2 - default)
   * Used for general operational information.
   * Sent to API if job context is set.
   * @param {string} msg - Info message
   * @param {Object} [data] - Optional structured metadata
   * @example
   *   logger.info('Server started', { port: 3000 })
   */
  info: (msg, data) => log('info', msg, data),

  /**
   * Log a debug message (level 3 - most verbose)
   * Used for detailed debugging information.
   * Debug logs are NOT sent to the API (local only).
   * @param {string} msg - Debug message
   * @param {Object} [data] - Optional structured metadata
   * @example
   *   logger.debug('Request received', { headers, body })
   */
  debug: (msg, data) => log('debug', msg, data),

  /**
   * Set agent ID for multi-agent support
   * @param {string} id - Agent ID (e.g., 'agent-1', 'agent-2')
   */
  setAgentId: (id) => {
    logManager.setAgentId(id);
  },

  /**
   * Set job context for API logging
   * When set, info and error logs will be sent to the API's "Instance Setup Logs"
   * Uses batching to reduce API overhead (flushes every 2s or when 10 logs buffered)
   * @param {number} jobId - Job ID
   * @param {Object} apiClient - API client instance
   * @param {Object} context - Optional global context to add to all logs (Phase 3)
   */
  setJobContext: (jobId, apiClient, context = {}) => {
    // Set job context in LogManager
    logManager.setJobContext(jobId, context);

    // Create legacy batcher for backward compatibility
    // This is kept for the immediate flush on error behavior
    legacyJobContext.batcher = new SetupLogBatcher(apiClient, jobId, {
      maxBatchSize: loggingConfig.maxBatchSize,
      flushInterval: loggingConfig.flushInterval,
      useBatchEndpoint: loggingConfig.useBatchEndpoint
    });
  },

  /**
   * Clear job context (called when job completes)
   * Ensures all buffered logs are flushed before shutdown
   */
  clearJobContext: async () => {
    // Shutdown legacy batcher and flush remaining logs
    if (legacyJobContext.batcher) {
      await legacyJobContext.batcher.shutdown();
      legacyJobContext.batcher = null;
    }

    // Clear job context in LogManager
    await logManager.clearJobContext();
  },

  // ===== Phase 3: Enhanced Structured Logging =====

  /**
   * Set global context that will be included in all subsequent logs
   * @param {string|Object} keyOrContext - Key name or object with multiple keys
   * @param {*} value - Value (only if first param is a string)
   * @example
   *   logger.setContext('component', 'worktree')
   *   logger.setContext({ component: 'worktree', operation: 'create' })
   */
  setContext: (keyOrContext, value) => {
    logManager.setContext(keyOrContext, value);
  },

  /**
   * Create a child logger with additional context
   * Context is additive - child inherits parent context and adds its own
   * @param {Object} context - Additional context for this child logger
   * @returns {Object} Child logger with all parent methods
   * @example
   *   const worktreeLogger = logger.child({ component: 'worktree' })
   *   worktreeLogger.info('Creating worktree') // Includes component: 'worktree'
   */
  child: (context) => {
    return logManager.child(context);
  },

  /**
   * Log a semantic event with structured metadata
   * @param {string} eventType - Event type in format 'category.action' (e.g., 'worktree.created')
   * @param {Object} data - Additional event data
   * @example
   *   logger.event('worktree.created', { path: '/path/to/worktree', duration: 3200 })
   */
  event: (eventType, data = {}) => {
    logManager.event(eventType, data).catch(() => {
      // Silently handle errors to prevent cascading failures
    });
  },

  /**
   * Start a performance timer for an operation
   * @param {string} operation - Operation name (e.g., 'worktree.create')
   * @param {Object} initialContext - Initial context for the operation
   * @returns {Object} Timer object with done() method
   * @example
   *   const timer = logger.startTimer('worktree.create')
   *   // ... do work ...
   *   timer.done({ path: '/path/to/worktree' }) // Logs duration automatically
   */
  startTimer: (operation, initialContext = {}) => {
    return logManager.startTimer(operation, initialContext);
  },

  /**
   * Measure and log an async operation automatically
   * @param {string} operation - Operation name (e.g., 'prd.conversion')
   * @param {Function} fn - Async function to measure
   * @param {Object} context - Additional context
   * @returns {Promise<*>} Result of the async function
   * @example
   *   const result = await logger.measure('prd.conversion', async () => {
   *     return await convertPRD(job)
   *   })
   *   // Logs: prd.conversion.started, then prd.conversion.complete with duration
   */
  measure: async (operation, fn, context = {}) => {
    return await logManager.measure(operation, fn, context);
  },

  // ===== Direct Access to LogManager =====

  /**
   * Get the underlying LogManager instance
   * Useful for advanced use cases like adding/removing destinations dynamically
   * @returns {LogManager} The LogManager instance
   * @example
   *   const manager = logger.getManager()
   *   manager.addDestination(new FileDestination({ path: '/var/log/app.log' }))
   */
  getManager: () => logManager
};
