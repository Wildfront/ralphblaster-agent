const ApiClient = require('./api-client');
const Executor = require('./executor');
const config = require('./config');
const logger = require('./logger');
const { formatDuration } = require('./utils/format');

// Timing constants
const SHUTDOWN_DELAY_MS = 500;
const ERROR_RETRY_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60000;

class RalphAgent {
  constructor() {
    // Agent ID for multi-agent support
    this.agentId = process.env.RALPH_AGENT_ID || 'agent-default';

    this.apiClient = new ApiClient(this.agentId);
    this.executor = new Executor(this.apiClient);
    this.isRunning = false;
    this.currentJob = null;
    this.heartbeatInterval = null;
    this.jobCompleting = false; // Flag to prevent heartbeat race conditions
    this.jobStartTime = null; // Track when job started for elapsed time

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
      logger.info('Marking job as running...');
      await this.apiClient.markJobRunning(job.id);
      logger.info('Job marked as running in API');

      // Send initial status event
      logger.info('Sending initial status event to UI...');
      await this.apiClient.sendStatusEvent(job.id, 'job_claimed', `Starting: ${job.task_title}`);

      // Start heartbeat to keep job alive
      logger.info('Starting heartbeat timer...');
      this.startHeartbeat(job.id);

      // Execute the job with progress callback
      logger.info('Beginning job execution...');
      const result = await this.executor.execute(job, async (chunk) => {
        // Send progress update to server
        try {
          await this.apiClient.sendProgress(job.id, chunk);
        } catch (error) {
          logger.warn(`Failed to send progress update for job #${job.id}: ${error.message}`);
          // Don't fail the job if progress update fails
        }
      });

      logger.info('Job execution completed, processing results...');

      // Set flag to prevent heartbeat race conditions, then stop heartbeat
      this.jobCompleting = true;
      this.stopHeartbeat();
      logger.info('Heartbeat stopped');

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

      // Set flag to prevent heartbeat race conditions, then stop heartbeat
      this.jobCompleting = true;
      this.stopHeartbeat();

      // Mark job as failed (pass full error object to include categorization)
      logger.info('Marking job as failed in API...');
      await this.apiClient.markJobFailed(
        job.id,
        error,  // Pass full error object instead of just message
        error.partialOutput || null
      );

      logger.error(`Job #${job.id} marked as failed in API`);
    } finally {
      // Clear logger context (flush remaining batched logs)
      logger.info('Flushing remaining logs to API...');
      await logger.clearJobContext();
      logger.info('Logger context cleared');

      // Clear current job reference and reset completion flag
      this.currentJob = null;
      this.jobCompleting = false;
      this.jobStartTime = null;
    }
  }


  /**
   * Start heartbeat for job
   * @param {number} jobId - Job ID
   */
  startHeartbeat(jobId) {
    // Send heartbeat every 60 seconds to prevent timeout
    this.heartbeatInterval = setInterval(async () => {
      // Check if job is completing to prevent race conditions
      if (this.jobCompleting) {
        logger.debug('Skipping heartbeat - job is completing');
        return;
      }

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
      logger.error('Uncaught exception: ' + (error?.message || error));
      console.error(error); // Also log full error with stack trace
      this.stop();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection: ' + (reason?.message || reason));
      console.error(reason); // Also log full reason with stack trace
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
