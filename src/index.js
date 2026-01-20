const ApiClient = require('./api-client');
const Executor = require('./executor');
const config = require('./config');
const logger = require('./logger');

class RalphAgent {
  constructor() {
    this.apiClient = new ApiClient();
    this.executor = new Executor();
    this.isRunning = false;
    this.currentJob = null;
    this.heartbeatInterval = null;
  }

  /**
   * Start the agent
   */
  async start() {
    this.isRunning = true;

    logger.info('Ralph Agent starting...');
    logger.info(`API URL: ${config.apiUrl}`);
    logger.info(`Poll interval: ${config.pollInterval}ms`);

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

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // If currently executing a job, mark it as failed
    if (this.currentJob) {
      logger.warn(`Marking job #${this.currentJob.id} as failed due to shutdown`);
      await this.apiClient.markJobFailed(
        this.currentJob.id,
        'Agent shutdown during execution'
      );
    }

    logger.info('Ralph Agent stopped');
    process.exit(0);
  }

  /**
   * Main polling loop
   */
  async pollLoop() {
    while (this.isRunning) {
      try {
        // Check for next job (long polling - server waits up to 30s)
        const job = await this.apiClient.getNextJob();

        if (job) {
          await this.processJob(job);
          // After processing, immediately poll for next job
        } else {
          // No jobs available after long poll timeout
          // Immediately reconnect (no sleep needed with long polling)
        }
      } catch (error) {
        logger.error('Error in poll loop', error.message);

        // Wait a bit before retrying on error
        await this.sleep(5000); // 5 seconds on error
      }
    }
  }

  /**
   * Process a job
   * @param {Object} job - Job object from API
   */
  async processJob(job) {
    this.currentJob = job;

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
          logger.warn('Failed to send progress update', error.message);
          // Don't fail the job if progress update fails
        }
      });

      // Stop heartbeat
      this.stopHeartbeat();

      // Mark job as completed
      await this.apiClient.markJobCompleted(job.id, result);

      logger.info(`Job #${job.id} completed successfully`);
    } catch (error) {
      // Stop heartbeat
      this.stopHeartbeat();

      // Mark job as failed
      await this.apiClient.markJobFailed(
        job.id,
        error.message,
        error.partialOutput || null
      );

      logger.error(`Job #${job.id} failed`, error.message);
    } finally {
      this.currentJob = null;
    }
  }

  /**
   * Start heartbeat for job
   * @param {number} jobId - Job ID
   */
  startHeartbeat(jobId) {
    // Send heartbeat every 60 seconds to prevent timeout
    this.heartbeatInterval = setInterval(() => {
      this.apiClient.sendHeartbeat(jobId).catch(err => {
        logger.warn('Heartbeat failed', err.message);
      });
    }, 60000); // 60 seconds
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
