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
      timeout: 30000 // 30 second timeout
    });
  }

  /**
   * Poll for next available job
   * @returns {Promise<Object|null>} Job object or null if no jobs available
   */
  async getNextJob() {
    try {
      logger.debug('Polling for next job...');
      const response = await this.client.get('/api/v1/ralph/jobs/next');

      if (response.status === 204) {
        // No jobs available
        return null;
      }

      if (response.data && response.data.success) {
        logger.info(`Claimed job #${response.data.job.id} - ${response.data.job.task_title}`);
        return response.data.job;
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
      await this.client.patch(`/api/v1/ralph/jobs/${jobId}`, {
        status: 'completed',
        output: result.output,
        summary: result.summary,
        branch_name: result.branchName,
        execution_time_ms: result.executionTimeMs
      });
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
}

module.exports = ApiClient;
