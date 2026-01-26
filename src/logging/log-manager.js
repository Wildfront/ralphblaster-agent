/**
 * LogManager - Coordinates multiple log destinations
 *
 * Acts as the main logging coordinator that routes log calls to all registered
 * destinations (console, file, API, etc.) in parallel. Manages destination
 * lifecycle and handles per-destination errors gracefully.
 *
 * Key features:
 * - Dependency injection - destinations passed in, not created internally
 * - Destination-agnostic - doesn't know about specific destination types
 * - Parallel writes - logs to all destinations concurrently
 * - Graceful error handling - destination failures don't affect other destinations
 * - Context management - setJobContext/clearJobContext configures all destinations
 * - Lifecycle management - setup, flush, and teardown coordination
 *
 * Example usage:
 * ```javascript
 * const { ConsoleDestination, ApiDestination } = require('./destinations');
 * const loggingConfig = require('./config');
 *
 * const manager = new LogManager([
 *   new ConsoleDestination({ colors: loggingConfig.consoleColors }),
 *   new ApiDestination({ apiClient, jobId })
 * ]);
 *
 * await manager.info('Server started', { port: 3000 });
 * await manager.close();
 * ```
 */

class LogManager {
  /**
   * Create a new LogManager
   * @param {Array<BaseDestination>} destinations - Array of log destinations to coordinate
   * @param {Object} [config={}] - Manager configuration
   * @param {string} [config.agentId=null] - Agent ID for multi-agent support
   */
  constructor(destinations = [], config = {}) {
    if (!Array.isArray(destinations)) {
      throw new Error('LogManager requires an array of destinations');
    }

    this.destinations = destinations;
    this.agentId = config.agentId || null;
    this.jobContext = {
      jobId: null,
      globalContext: {}
    };
    this.isShuttingDown = false;
  }

  /**
   * Write a log entry to all destinations
   * Routes the log to all destinations in parallel, handling errors gracefully.
   * Failed destinations don't affect other destinations.
   * @param {string} level - Log level ('error', 'warn', 'info', 'debug')
   * @param {string} message - Log message
   * @param {Object} [data={}] - Structured metadata
   * @returns {Promise<void>}
   * @private
   */
  async write(level, message, data = {}) {
    // Merge global context with log data
    const enrichedData = { ...this.jobContext.globalContext, ...data };

    // Add agent ID to metadata if set
    if (this.agentId) {
      enrichedData.agentId = this.agentId;
    }

    // Add job ID to metadata if set
    if (this.jobContext.jobId) {
      enrichedData.jobId = this.jobContext.jobId;
    }

    // Write to all destinations in parallel
    const writePromises = this.destinations.map(destination => {
      // Check if destination should handle this log level
      if (destination.shouldLog && !destination.shouldLog(level)) {
        return Promise.resolve();
      }

      // Write to destination, catching errors to prevent cascading failures
      return destination.write(level, message, enrichedData)
        .catch(error => {
          // Let destination handle its own errors
          if (typeof destination.handleError === 'function') {
            destination.handleError(error, level, message);
          }
        });
    });

    // Wait for all writes to complete (or fail gracefully)
    await Promise.all(writePromises);
  }

  /**
   * Log an error message
   * Logs to all destinations that accept error level.
   * @param {string} message - Error message
   * @param {Object} [data={}] - Optional structured metadata
   * @returns {Promise<void>}
   * @example
   *   await manager.error('Database connection failed', { error: err.message })
   */
  async error(message, data = {}) {
    await this.write('error', message, data);
  }

  /**
   * Log a warning message
   * Logs to all destinations that accept warn level.
   * @param {string} message - Warning message
   * @param {Object} [data={}] - Optional structured metadata
   * @returns {Promise<void>}
   * @example
   *   await manager.warn('Disk space low', { available: '5%' })
   */
  async warn(message, data = {}) {
    await this.write('warn', message, data);
  }

  /**
   * Log an info message
   * Logs to all destinations that accept info level.
   * @param {string} message - Info message
   * @param {Object} [data={}] - Optional structured metadata
   * @returns {Promise<void>}
   * @example
   *   await manager.info('Server started', { port: 3000 })
   */
  async info(message, data = {}) {
    await this.write('info', message, data);
  }

  /**
   * Log a debug message
   * Logs to all destinations that accept debug level.
   * @param {string} message - Debug message
   * @param {Object} [data={}] - Optional structured metadata
   * @returns {Promise<void>}
   * @example
   *   await manager.debug('Request received', { headers, body })
   */
  async debug(message, data = {}) {
    await this.write('debug', message, data);
  }

  /**
   * Set agent ID for multi-agent support
   * Adds agent ID to all subsequent logs across all destinations.
   * @param {string} id - Agent ID (e.g., 'agent-1', 'agent-2')
   */
  setAgentId(id) {
    this.agentId = id;
  }

  /**
   * Set job context for logging
   * Configures all destinations with job context. The job ID will be
   * included in all subsequent logs.
   * @param {number} jobId - Job ID to associate with logs
   * @param {Object} [context={}] - Optional global context to add to all logs
   * @example
   *   manager.setJobContext(123, { component: 'worktree' })
   */
  setJobContext(jobId, context = {}) {
    this.jobContext.jobId = jobId;
    this.jobContext.globalContext = context;

    // Notify destinations of context change (if they support it)
    this.destinations.forEach(destination => {
      if (typeof destination.setJobContext === 'function') {
        destination.setJobContext(jobId, context);
      }
    });
  }

  /**
   * Clear job context
   * Clears the job context and flushes all destinations to ensure
   * no logs are lost. Call this when a job completes.
   * @returns {Promise<void>}
   */
  async clearJobContext() {
    // Flush all destinations before clearing context
    await this.flush();

    this.jobContext.jobId = null;
    this.jobContext.globalContext = {};

    // Notify destinations of context clear (if they support it)
    const clearPromises = this.destinations.map(destination => {
      if (typeof destination.clearJobContext === 'function') {
        return destination.clearJobContext().catch(() => {
          // Silently handle errors during context clear
        });
      }
      return Promise.resolve();
    });

    await Promise.all(clearPromises);
  }

  /**
   * Set global context that will be included in all subsequent logs
   * @param {string|Object} keyOrContext - Key name or object with multiple keys
   * @param {*} [value] - Value (only if first param is a string)
   * @example
   *   manager.setContext('component', 'worktree')
   *   manager.setContext({ component: 'worktree', operation: 'create' })
   */
  setContext(keyOrContext, value) {
    if (typeof keyOrContext === 'object') {
      this.jobContext.globalContext = {
        ...this.jobContext.globalContext,
        ...keyOrContext
      };
    } else {
      this.jobContext.globalContext[keyOrContext] = value;
    }
  }

  /**
   * Create a child logger with additional context
   * Context is additive - child inherits parent context and adds its own.
   * @param {Object} context - Additional context for this child logger
   * @returns {Object} Child logger with all parent methods
   * @example
   *   const worktreeLogger = manager.child({ component: 'worktree' })
   *   await worktreeLogger.info('Creating worktree') // Includes component: 'worktree'
   */
  child(context) {
    const childContext = { ...this.jobContext.globalContext, ...context };

    return {
      error: (msg, data) => this.write('error', msg, { ...childContext, ...data }),
      warn: (msg, data) => this.write('warn', msg, { ...childContext, ...data }),
      info: (msg, data) => this.write('info', msg, { ...childContext, ...data }),
      debug: (msg, data) => this.write('debug', msg, { ...childContext, ...data }),
      event: (eventType, data) => this.event(eventType, { ...childContext, ...data }),
      startTimer: (operation) => this.startTimer(operation, childContext),
      measure: (operation, fn) => this.measure(operation, fn, childContext),
      child: (additionalContext) => this.child({ ...childContext, ...additionalContext })
    };
  }

  /**
   * Log a semantic event with structured metadata
   * Automatically determines log level based on action (failed/error = error, else info).
   * @param {string} eventType - Event type in format 'category.action' (e.g., 'worktree.created')
   * @param {Object} [data={}] - Additional event data
   * @returns {Promise<void>}
   * @example
   *   await manager.event('worktree.created', { path: '/path/to/worktree', duration: 3200 })
   */
  async event(eventType, data = {}) {
    const [category, action] = eventType.split('.');
    const eventData = {
      eventType,
      category,
      action,
      ...data
    };

    // Determine level based on action
    const level = action === 'failed' || action === 'error' ? 'error' : 'info';

    // Format message from action
    const message = action ? action.charAt(0).toUpperCase() + action.slice(1) : eventType;

    await this.write(level, message, eventData);
  }

  /**
   * Start a performance timer for an operation
   * Returns a timer object with a done() method to log completion with duration.
   * @param {string} operation - Operation name (e.g., 'worktree.create')
   * @param {Object} [initialContext={}] - Initial context for the operation
   * @returns {Object} Timer object with done() method
   * @example
   *   const timer = manager.startTimer('worktree.create')
   *   // ... do work ...
   *   timer.done({ path: '/path/to/worktree' }) // Logs duration automatically
   */
  startTimer(operation, initialContext = {}) {
    const startTime = Date.now();

    return {
      done: async (data = {}) => {
        const duration = Date.now() - startTime;
        await this.event(`${operation}.complete`, {
          ...initialContext,
          ...data,
          duration,
          durationMs: duration
        });
        return duration;
      }
    };
  }

  /**
   * Measure and log an async operation automatically
   * Logs operation start, measures duration, and logs completion with success status.
   * @param {string} operation - Operation name (e.g., 'prd.conversion')
   * @param {Function} fn - Async function to measure
   * @param {Object} [context={}] - Additional context
   * @returns {Promise<*>} Result of the async function
   * @example
   *   const result = await manager.measure('prd.conversion', async () => {
   *     return await convertPRD(job)
   *   })
   *   // Logs: prd.conversion.started, then prd.conversion.complete with duration
   */
  async measure(operation, fn, context = {}) {
    await this.event(`${operation}.started`, context);
    const timer = this.startTimer(operation, context);

    try {
      const result = await fn();
      await timer.done({ success: true });
      return result;
    } catch (error) {
      await timer.done({ success: false, error: error.message });
      throw error;
    }
  }

  /**
   * Flush all buffered logs across all destinations
   * Ensures all pending logs are written immediately.
   * Safe to call multiple times.
   * @returns {Promise<void>}
   */
  async flush() {
    const flushPromises = this.destinations.map(destination => {
      if (typeof destination.flush === 'function') {
        return destination.flush().catch(error => {
          // Let destination handle its own flush errors
          if (typeof destination.handleError === 'function') {
            destination.handleError(error, 'error', 'Failed to flush destination');
          }
        });
      }
      return Promise.resolve();
    });

    await Promise.all(flushPromises);
  }

  /**
   * Close all destinations and release resources
   * Flushes all pending logs, stops timers, closes connections, etc.
   * Call this during shutdown to ensure no logs are lost.
   * @returns {Promise<void>}
   */
  async close() {
    this.isShuttingDown = true;

    const closePromises = this.destinations.map(destination => {
      if (typeof destination.close === 'function') {
        return destination.close().catch(error => {
          // Let destination handle its own close errors
          if (typeof destination.handleError === 'function') {
            destination.handleError(error, 'error', 'Failed to close destination');
          }
        });
      }
      return Promise.resolve();
    });

    await Promise.all(closePromises);
  }

  /**
   * Add a destination to the manager
   * Useful for dynamically adding destinations after initialization.
   * @param {BaseDestination} destination - Destination to add
   */
  addDestination(destination) {
    if (!destination) {
      throw new Error('Cannot add null or undefined destination');
    }

    this.destinations.push(destination);

    // If we have active context, notify the new destination
    if (this.jobContext.jobId && typeof destination.setJobContext === 'function') {
      destination.setJobContext(this.jobContext.jobId, this.jobContext.globalContext);
    }
  }

  /**
   * Remove a destination from the manager
   * Flushes and closes the destination before removing it.
   * @param {BaseDestination} destination - Destination to remove
   * @returns {Promise<void>}
   */
  async removeDestination(destination) {
    const index = this.destinations.indexOf(destination);
    if (index === -1) {
      return;
    }

    // Close the destination before removing
    if (typeof destination.close === 'function') {
      await destination.close().catch(() => {
        // Silently handle close errors during removal
      });
    }

    this.destinations.splice(index, 1);
  }

  /**
   * Get count of registered destinations
   * Useful for testing and debugging.
   * @returns {number} Number of destinations
   */
  getDestinationCount() {
    return this.destinations.length;
  }
}

module.exports = LogManager;
