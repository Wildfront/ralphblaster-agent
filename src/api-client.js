const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const packageJson = require('../package.json');

// Agent version from package.json
const AGENT_VERSION = packageJson.version;

// Timeout constants
const LONG_POLLING_TIMEOUT_MS = 65000; // 65s for long polling (server max 60s + buffer)
const REGULAR_API_TIMEOUT_MS = 15000;  // 15s for regular API calls

class ApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REGULAR_API_TIMEOUT_MS
    });

    // Add Authorization header via interceptor to prevent token exposure in logs
    this.client.interceptors.request.use((requestConfig) => {
      requestConfig.headers.Authorization = `Bearer ${config.apiToken}`;
      requestConfig.headers['X-Agent-Version'] = AGENT_VERSION;
      return requestConfig;
    });

    // Sanitize errors to prevent token leakage in stack traces
    this.client.interceptors.response.use(
      response => response,
      error => {
        // Remove auth header from error config before it gets logged
        if (error.config && error.config.headers) {
          error.config.headers.Authorization = 'Bearer [REDACTED]';
        }
        // Also redact from response config if present
        if (error.response && error.response.config && error.response.config.headers) {
          error.response.config.headers.Authorization = 'Bearer [REDACTED]';
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Poll for next available job (with long polling)
   * @returns {Promise<Object|null>} Job object or null if no jobs available
   */
  async getNextJob() {
    try {
      logger.debug('Long polling for next job (timeout: 30s)...');
      const response = await this.client.get('/api/v1/ralph/jobs/next', {
        params: { timeout: 30 }, // Server waits up to 30s for job
        timeout: LONG_POLLING_TIMEOUT_MS // Client waits up to 65s
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

        // Log full job details for debugging (especially useful in multi-agent scenarios)
        logger.debug('Job details:', {
          id: job.id,
          job_type: job.job_type,
          task_title: job.task_title,
          created_at: job.created_at,
          user_id: job.user_id,
          project_id: job.project?.id,
          project_name: job.project?.name,
          has_prompt: !!job.prompt,
          prompt_length: job.prompt?.length || 0
        });

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
   * Validate and truncate output to prevent excessive data transmission
   * @param {string} output - Output string to validate
   * @param {number} maxSize - Maximum size in bytes (default 10MB)
   * @returns {string} Validated/truncated output
   */
  validateOutput(output, maxSize = 10 * 1024 * 1024) {
    if (typeof output !== 'string') {
      return '';
    }

    if (output.length > maxSize) {
      logger.warn(`Output truncated from ${output.length} to ${maxSize} bytes`);
      return output.substring(0, maxSize) + '\n\n[OUTPUT TRUNCATED - EXCEEDED MAX SIZE]';
    }

    return output;
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
        output: this.validateOutput(result.output || ''),
        execution_time_ms: result.executionTimeMs
      };

      // Add job-type specific fields with validation
      if (result.prdContent) {
        payload.prd_content = this.validateOutput(result.prdContent);
      }
      if (result.summary) {
        payload.summary = this.validateOutput(result.summary, 10000); // 10KB max for summary
      }
      if (result.branchName) {
        // Validate branch name format
        if (!/^[a-zA-Z0-9/_-]{1,200}$/.test(result.branchName)) {
          logger.warn('Invalid branch name format, omitting from payload');
        } else {
          payload.branch_name = result.branchName;
        }
      }

      // Add git activity metadata
      if (result.gitActivity) {
        payload.git_activity = {
          commit_count: result.gitActivity.commitCount || 0,
          last_commit: result.gitActivity.lastCommit || null,
          changes: result.gitActivity.changes || null,
          pushed_to_remote: result.gitActivity.pushedToRemote || false,
          has_uncommitted_changes: result.gitActivity.hasUncommittedChanges || false
        };
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
   * @param {Error|string} error - Error object or error message
   * @param {string} partialOutput - Partial output if any
   */
  async markJobFailed(jobId, error, partialOutput = null) {
    try {
      // Support both Error objects and string messages for backward compatibility
      const errorMessage = typeof error === 'string' ? error : error.message || String(error);
      const payload = {
        status: 'failed',
        error: errorMessage,
        output: partialOutput || error.partialOutput || null
      };

      // Add error categorization if available (from enriched Error objects)
      if (typeof error === 'object' && error !== null) {
        if (error.category) {
          payload.error_category = error.category;
        }
        if (error.technicalDetails) {
          payload.error_details = error.technicalDetails;
        }
      }

      await this.client.patch(`/api/v1/ralph/jobs/${jobId}`, payload);
      logger.info(`Job #${jobId} marked as failed with category: ${payload.error_category || 'unknown'}`);
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
        status: 'running',
        heartbeat: true  // Distinguish from initial markJobRunning call
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
   * Send status event for job (structured progress updates for UI visibility)
   * @param {number} jobId - Job ID
   * @param {string} eventType - Event type (e.g., 'setup_started', 'file_modified', 'progress_update')
   * @param {string} message - Human-readable status message
   * @param {Object} metadata - Optional metadata (e.g., {filename: 'app.js', percentage: 50})
   */
  async sendStatusEvent(jobId, eventType, message, metadata = {}) {
    try {
      await this.client.post(`/api/v1/ralph/jobs/${jobId}/events`, {
        event_type: eventType,
        message: message,
        metadata: metadata
      });
      logger.debug(`Status event sent for job #${jobId}: ${eventType} - ${message}`);
    } catch (error) {
      logger.warn(`Error sending status event for job #${jobId}`, error.message);
      // Don't throw - status events are best-effort for UI visibility
    }
  }

  /**
   * Update job metadata (best-effort, doesn't fail job if unsuccessful)
   * @param {number} jobId - Job ID
   * @param {Object} metadata - Metadata object to merge
   */
  async updateJobMetadata(jobId, metadata) {
    try {
      await this.client.patch(`/api/v1/ralph/jobs/${jobId}/metadata`, {
        metadata: metadata
      });
      logger.debug(`Metadata updated for job #${jobId}`, metadata);
    } catch (error) {
      logger.warn(`Error updating metadata for job #${jobId}`, error.message);
      // Don't throw - metadata updates are best-effort
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
