const ApiClient = require('./api-client');
const Executor = require('./executor');
const config = require('./config');
const logger = require('./logger');

// Timing constants
const SHUTDOWN_DELAY_MS = 500;
const ERROR_RETRY_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60000;

class RalphAgent {
  constructor() {
    this.apiClient = new ApiClient();
    this.executor = new Executor(this.apiClient);
    this.isRunning = false;
    this.currentJob = null;
    this.heartbeatInterval = null;
    this.jobCompleting = false; // Flag to prevent heartbeat race conditions

    // Rate limiting state
    this.consecutiveErrors = 0;
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000; // Minimum 1s between requests
  }

  /**
   * Start the agent
   */
  async start() {
    this.isRunning = true;

    logger.info('Ralph Agent starting...');
    logger.info(`API URL: ${config.apiUrl}`);

    // Setup graceful shutdown
    this.setupShutdownHandlers();

    // Start polling loop
    await this.pollLoop();
  }

  /**
   * Stop the agent
   */
  async stop() {
    logger.info('Ralph Agent stopping...');
    this.isRunning = false;

    // Stop heartbeat first to prevent updates during shutdown
    this.stopHeartbeat();

    // Kill any running Claude process
    if (this.executor.currentProcess) {
      logger.warn('Terminating running Claude process');
      await this.executor.killCurrentProcess();
    }

    // If currently executing a job, mark it as failed
    if (this.currentJob) {
      logger.warn(`Marking job #${this.currentJob.id} as failed due to shutdown`);
      try {
        await this.apiClient.markJobFailed(
          this.currentJob.id,
          'Agent shutdown during execution'
        );
      } catch (error) {
        logger.error('Failed to mark job as failed during shutdown', error.message);
      }
    }

    logger.info('Ralph Agent stopped');
    // Give async operations time to complete before exiting
    setTimeout(() => process.exit(0), SHUTDOWN_DELAY_MS);
  }

  /**
   * Main polling loop with rate limiting and exponential backoff
   */
  async pollLoop() {
    while (this.isRunning) {
      try {
        // Enforce minimum interval between requests
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
          await this.sleep(this.minRequestInterval - timeSinceLastRequest);
        }
        this.lastRequestTime = Date.now();

        // Check for next job (long polling - server waits up to 30s)
        const job = await this.apiClient.getNextJob();

        // Reset error counter on successful API call
        this.consecutiveErrors = 0;

        if (job) {
          await this.processJob(job);
          // After processing, immediately poll for next job
        } else {
          // No jobs available after long poll timeout
          // Small delay before reconnecting to prevent hammering
          await this.sleep(1000); // 1s minimum between polls
        }
      } catch (error) {
        this.consecutiveErrors++;
        logger.error(`Error in poll loop (consecutive: ${this.consecutiveErrors})`, error.message);

        // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
        const backoffTime = Math.min(
          ERROR_RETRY_DELAY_MS * Math.pow(2, this.consecutiveErrors - 1),
          60000
        );

        logger.info(`Backing off for ${backoffTime}ms before retry`);
        await this.sleep(backoffTime);

        // Circuit breaker: Stop if too many consecutive errors
        if (this.consecutiveErrors >= 10) {
          logger.error('Too many consecutive errors (10+), shutting down');
          await this.stop();
        }
      }
    }
  }

  /**
   * Process a job
   * @param {Object} job - Job object from API
   */
  async processJob(job) {
    this.currentJob = job;
    this.jobCompleting = false;

    try {
      // Mark job as running
      await this.apiClient.markJobRunning(job.id);

      // Start heartbeat to keep job alive
      this.startHeartbeat(job.id);

      // Execute the job with progress callback
      const result = await this.executor.execute(job, async (chunk) => {
        // Send progress update to server
        try {
          await this.apiClient.sendProgress(job.id, chunk);
        } catch (error) {
          logger.warn(`Failed to send progress update for job #${job.id}`, error.message);
          // Don't fail the job if progress update fails
        }
      });

      // Set flag to prevent heartbeat race conditions, then stop heartbeat
      this.jobCompleting = true;
      this.stopHeartbeat();

      // Mark job as completed
      await this.apiClient.markJobCompleted(job.id, result);

      logger.info(`Job #${job.id} completed successfully`);
    } catch (error) {
      // Set flag to prevent heartbeat race conditions, then stop heartbeat
      this.jobCompleting = true;
      this.stopHeartbeat();

      // Mark job as failed (pass full error object to include categorization)
      await this.apiClient.markJobFailed(
        job.id,
        error,  // Pass full error object instead of just message
        error.partialOutput || null
      );

      logger.error(`Job #${job.id} failed`, error.message);
    } finally {
      // Clear current job reference and reset completion flag
      this.currentJob = null;
      this.jobCompleting = false;
    }
  }

  /**
   * Start heartbeat for job
   * @param {number} jobId - Job ID
   */
  startHeartbeat(jobId) {
    // Send heartbeat every 60 seconds to prevent timeout
    this.heartbeatInterval = setInterval(() => {
      // Check if job is completing to prevent race conditions
      if (this.jobCompleting) {
        logger.debug('Skipping heartbeat - job is completing');
        return;
      }

      this.apiClient.sendHeartbeat(jobId).catch(err => {
        logger.warn('Heartbeat failed', err.message);
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    process.on('SIGINT', () => {
      logger.info('Received SIGINT signal');
      this.stop();
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM signal');
      this.stop();
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      this.stop();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', reason);
      this.stop();
    });
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RalphAgent;
