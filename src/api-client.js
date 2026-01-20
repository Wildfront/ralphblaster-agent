const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

class ApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 65000 // 65 second timeout (server max is 60s + buffer)
    });
  }

  /**
   * Poll for next available job (with long polling)
   * @returns {Promise<Object|null>} Job object or null if no jobs available
   */
  async getNextJob() {
    try {
      logger.debug('Long polling for next job (timeout: 30s)...');
      const response = await this.client.get('/api/v1/ralph/jobs/next', {
        params: { timeout: 30 } // Server waits up to 30s for job
      });

      if (response.status === 204) {
        // No jobs available
        return null;
      }

      if (response.data && response.data.success) {
        const job = response.data.job;

        // Validate job object
        const validationError = this.validateJob(job);
        if (validationError) {
          logger.error(`Invalid job received from API: ${validationError}`);
          return null;
        }

        logger.info(`Claimed job #${job.id} - ${job.task_title}`);
        return job;
      }

      logger.warn('Unexpected response from API', response.data);
      return null;
    } catch (error) {
      if (error.response?.status === 204) {
        // No jobs available
        return null;
      }

      if (error.response?.status === 403) {
        logger.error('API token lacks ralph_agent permission');
        throw new Error('Invalid API token permissions');
      }

      if (error.code === 'ECONNREFUSED') {
        logger.error(`Cannot connect to API at ${config.apiUrl}`);
        return null;
      }

      logger.error('Error fetching next job', error.message);
      return null;
    }
  }

  /**
   * Update job status to running
   * @param {number} jobId - Job ID
   */
  async markJobRunning(jobId) {
    try {
      await this.client.patch(`/api/v1/ralph/jobs/${jobId}`, {
        status: 'running'
      });
      logger.info(`Job #${jobId} marked as running`);
    } catch (error) {
      logger.error(`Error marking job #${jobId} as running`, error.message);
      throw error;
    }
  }

  /**
   * Update job status to completed
   * @param {number} jobId - Job ID
   * @param {Object} result - Job result containing output, summary, etc.
   */
  async markJobCompleted(jobId, result) {
    try {
      const payload = {
        status: 'completed',
        output: result.output,
        execution_time_ms: result.executionTimeMs
      };

      // Add job-type specific fields
      if (result.prdContent) {
        payload.prd_content = result.prdContent;
      }
      if (result.summary) {
        payload.summary = result.summary;
      }
      if (result.branchName) {
        payload.branch_name = result.branchName;
      }

      await this.client.patch(`/api/v1/ralph/jobs/${jobId}`, payload);
      logger.info(`Job #${jobId} marked as completed`);
    } catch (error) {
      logger.error(`Error marking job #${jobId} as completed`, error.message);
      throw error;
    }
  }

  /**
   * Update job status to failed
   * @param {number} jobId - Job ID
   * @param {string} errorMessage - Error message
   * @param {string} partialOutput - Partial output if any
   */
  async markJobFailed(jobId, errorMessage, partialOutput = null) {
    try {
      await this.client.patch(`/api/v1/ralph/jobs/${jobId}`, {
        status: 'failed',
        error: errorMessage,
        output: partialOutput
      });
      logger.info(`Job #${jobId} marked as failed`);
    } catch (error) {
      logger.error(`Error marking job #${jobId} as failed`, error.message);
      // Don't throw - we want to continue even if this fails
    }
  }

  /**
   * Send heartbeat to keep job alive (updates claimed_at)
   * @param {number} jobId - Job ID
   */
  async sendHeartbeat(jobId) {
    try {
      await this.client.patch(`/api/v1/ralph/jobs/${jobId}`, {
        status: 'running'
      });
      logger.debug(`Heartbeat sent for job #${jobId}`);
    } catch (error) {
      logger.warn(`Error sending heartbeat for job #${jobId}`, error.message);
    }
  }

  /**
   * Send progress update for job (streaming Claude output)
   * @param {number} jobId - Job ID
   * @param {string} chunk - Output chunk
   */
  async sendProgress(jobId, chunk) {
    try {
      await this.client.patch(`/api/v1/ralph/jobs/${jobId}/progress`, {
        chunk: chunk
      });
      logger.debug(`Progress sent for job #${jobId}`);
    } catch (error) {
      logger.warn(`Error sending progress for job #${jobId}`, error.message);
    }
  }

  /**
   * Validate job object from API
   * @param {Object} job - Job object to validate
   * @returns {string|null} Error message if invalid, null if valid
   */
  validateJob(job) {
    // Basic structure validation
    if (!job || typeof job !== 'object') {
      return 'Job is null or not an object';
    }

    // Required fields
    if (typeof job.id !== 'number' || job.id <= 0) {
      return 'Job ID is missing or invalid';
    }

    if (typeof job.job_type !== 'string' || !job.job_type.trim()) {
      return 'Job type is missing or invalid';
    }

    // Validate job_type is one of the known types
    const validJobTypes = ['prd_generation', 'code_execution'];
    if (!validJobTypes.includes(job.job_type)) {
      return `Unknown job type: ${job.job_type}`;
    }

    if (typeof job.task_title !== 'string' || !job.task_title.trim()) {
      return 'Task title is missing or invalid';
    }

    // Validate prompt if present (can be null/empty for legacy clients)
    if (job.prompt !== null && job.prompt !== undefined && typeof job.prompt !== 'string') {
      return 'Prompt must be a string or null';
    }

    // For code_execution jobs, validate project
    if (job.job_type === 'code_execution') {
      if (!job.project || typeof job.project !== 'object') {
        return 'Project object is required for code_execution jobs';
      }

      if (typeof job.project.system_path !== 'string' || !job.project.system_path.trim()) {
        return 'Project system_path is missing or invalid';
      }
    }

    // For prd_generation jobs, validate project if present
    if (job.job_type === 'prd_generation' && job.project) {
      if (typeof job.project !== 'object') {
        return 'Project must be an object if provided';
      }

      if (job.project.system_path !== null &&
          job.project.system_path !== undefined &&
          typeof job.project.system_path !== 'string') {
        return 'Project system_path must be a string if provided';
      }
    }

    return null; // Valid
  }
}

module.exports = ApiClient;
