const ApiClient = require('./api-client');
const Executor = require('./executor');
const config = require('./config');
const loggingConfig = require('./logging/config');
const logger = require('./logger');
const { formatDuration } = require('./utils/format');

// Timeout constants
const TIMEOUTS = {
  SHUTDOWN_DELAY_MS: 500, // Delay before shutdown
  ERROR_RETRY_DELAY_MS: 5000, // 5 seconds retry delay after errors
  HEARTBEAT_INTERVAL_MS: 20000, // 20 seconds for heartbeat
  PROGRESS_THROTTLE_MS: 100, // 100ms throttle (max 10 progress updates per second)
  MIN_REQUEST_INTERVAL_MS: 1000, // Minimum 1 second between API requests
};

class RalphAgent {
  constructor() {
    // Agent ID for multi-agent support (from centralized logging config)
    this.agentId = loggingConfig.agentId;

    this.apiClient = new ApiClient(this.agentId);
    this.executor = new Executor(this.apiClient);
    this.isRunning = false;
    this.currentJob = null;
    this.heartbeatInterval = null;
    this.jobStartTime = null; // Track when job started for elapsed time

    // Rate limiting state
    this.consecutiveErrors = 0;
    this.lastRequestTime = 0;
    this.minRequestInterval = TIMEOUTS.MIN_REQUEST_INTERVAL_MS;

    // Progress throttling state
    this.lastProgressUpdate = 0;
  }

  /**
   * Start the agent
   */
  async start() {
    this.isRunning = true;

    // Set agent ID in logger context
    logger.setAgentId(this.agentId);

    logger.info('Ralph Agent starting...');
    logger.info(`Agent ID: ${this.agentId}`);
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
        logger.error('Failed to mark job as failed during shutdown: ' + error.message);
      }
    }

    logger.info('Ralph Agent stopped');
    // Give async operations time to complete before exiting
    setTimeout(() => process.exit(0), TIMEOUTS.SHUTDOWN_DELAY_MS);
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
          TIMEOUTS.ERROR_RETRY_DELAY_MS * Math.pow(2, this.consecutiveErrors - 1),
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
    this.jobStartTime = Date.now(); // Track start time for elapsed time calculation

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`Processing Job #${job.id}`, {
      jobType: job.job_type,
      taskTitle: job.task_title,
      projectName: job.project?.name,
      hasPrompt: !!job.prompt,
      promptLength: job.prompt?.length || 0
    });
    logger.info('═══════════════════════════════════════════════════════════');

    // Set logger context so internal logs are sent to UI (Phase 3: with global context)
    logger.setJobContext(job.id, this.apiClient, {
      jobType: job.job_type,
      taskTitle: job.task_title,
      projectId: job.project?.id,
      projectName: job.project?.name
    });

    try {
      // Mark job as running
      logger.debug('Marking job as running...');
      await this.apiClient.markJobRunning(job.id);
      logger.debug('Job marked as running in API');

      // Send initial status event
      logger.debug('Sending initial status event to UI...');
      await this.apiClient.sendStatusEvent(job.id, 'job_claimed', `Starting: ${job.task_title}`);

      // Start heartbeat to keep job alive
      logger.debug('Starting heartbeat timer...');
      this.startHeartbeat(job.id);

      // Reset progress throttle for new job
      this.lastProgressUpdate = 0;

      // Execute the job with progress callback
      logger.info('Beginning job execution...');
      const result = await this.executor.execute(job, async (chunk) => {
        // Throttle progress updates to prevent flooding (max 10 updates/sec)
        const now = Date.now();
        if (now - this.lastProgressUpdate < TIMEOUTS.PROGRESS_THROTTLE_MS) {
          return; // Skip this update
        }
        this.lastProgressUpdate = now;

        // Send progress update to server (best-effort, don't fail job on error)
        try {
          await this.apiClient.sendProgress(job.id, chunk);
        } catch (error) {
          logger.debug(`Progress update failed for job #${job.id}: ${error.message}`);
        }
      });

      logger.info('Job execution completed, processing results...');

      // Mark job as completed
      logger.info('Marking job as completed in API...');
      await this.apiClient.markJobCompleted(job.id, result);

      const executionTime = Date.now() - this.jobStartTime;
      logger.info('═══════════════════════════════════════════════════════════');
      logger.info(`✓ Job #${job.id} completed successfully`, {
        executionTimeMs: executionTime,
        executionTime: formatDuration(executionTime)
      });
      logger.info('═══════════════════════════════════════════════════════════');
    } catch (error) {
      const executionTime = Date.now() - this.jobStartTime;
      logger.error('═══════════════════════════════════════════════════════════');
      logger.error(`✗ Job #${job.id} failed after ${formatDuration(executionTime)}`, {
        error: error.message,
        category: error.category,
        hasPartialOutput: !!error.partialOutput
      });
      logger.error('═══════════════════════════════════════════════════════════');

      // Mark job as failed (pass full error object to include categorization)
      logger.info('Marking job as failed in API...');
      await this.apiClient.markJobFailed(
        job.id,
        error,  // Pass full error object instead of just message
        error.partialOutput || null
      );

      logger.error(`Job #${job.id} marked as failed in API`);
    } finally {
      // Stop heartbeat immediately to prevent race conditions
      this.stopHeartbeat();
      logger.info('Heartbeat stopped');

      // Clear logger context (flush remaining batched logs)
      logger.info('Flushing remaining logs to API...');
      await logger.clearJobContext();
      logger.info('Logger context cleared');

      // Clear current job reference and reset time tracking
      this.currentJob = null;
      this.jobStartTime = null;
    }
  }


  /**
   * Start heartbeat for job
   * @param {number} jobId - Job ID
   */
  startHeartbeat(jobId) {
    // Send heartbeat every 20 seconds to maintain online status (backend offline threshold: 35s)
    this.heartbeatInterval = setInterval(async () => {
      try {
        // Calculate elapsed time
        const elapsed = Date.now() - this.jobStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);

        // Send heartbeat to update claimed_at
        await this.apiClient.sendHeartbeat(jobId);

        // Send status event with elapsed time
        await this.apiClient.sendStatusEvent(
          jobId,
          'heartbeat',
          `Still working... (${minutes}m ${seconds}s elapsed)`,
          { elapsed_ms: elapsed }
        );
      } catch (err) {
        logger.warn('Heartbeat failed: ' + err.message);
      }
    }, TIMEOUTS.HEARTBEAT_INTERVAL_MS);
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
      logger.error('╔══════════════════════════════════════════════════════════');
      logger.error('║ UNCAUGHT EXCEPTION - Agent will shutdown');
      logger.error('║ Message: ' + (error?.message || error));
      logger.error('║ Stack: ' + (error?.stack || 'no stack'));
      logger.error('╚══════════════════════════════════════════════════════════');
      console.error('UNCAUGHT EXCEPTION:', error);
      this.stop();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('╔══════════════════════════════════════════════════════════');
      logger.error('║ UNHANDLED REJECTION - Agent will shutdown');
      logger.error('║ Reason: ' + (reason?.message || reason));
      logger.error('║ Stack: ' + (reason?.stack || 'no stack'));
      logger.error('╚══════════════════════════════════════════════════════════');
      console.error('UNHANDLED REJECTION:', reason);
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
