const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const packageJson = require('../package.json');

// Agent version from package.json
const AGENT_VERSION = packageJson.version;

// Timeout constants
const SERVER_LONG_POLL_TIMEOUT_S = 30; // Server waits up to 30s for job
const NETWORK_BUFFER_MS = 5000;        // 5s buffer for network latency
const LONG_POLLING_TIMEOUT_MS = (SERVER_LONG_POLL_TIMEOUT_S * 1000) + NETWORK_BUFFER_MS; // 35s
const REGULAR_API_TIMEOUT_MS = 15000;  // 15s for regular API calls
const BATCH_API_TIMEOUT_MS = 30000;    // 30s for batch operations

// API endpoint versions
const NEW_API_PREFIX = '/api/v1/rb';
const OLD_API_PREFIX = '/api/v1/ralph';

class ApiClient {
  constructor(agentId = 'agent-default') {
    this.agentId = agentId;
    this.useNewEndpoints = true; // Start with new endpoints, fall back if needed

    // Rate limiting backoff tracking per endpoint category
    this.rateLimitBackoff = {
      jobs: 0,      // /jobs/* endpoints
      progress: 0,  // /jobs/*/progress endpoints
      events: 0,    // /jobs/*/events endpoints
      metadata: 0   // /jobs/*/metadata endpoints
    };

    // Progress batching
    this.progressBuffer = new Map(); // jobId -> [{chunk, timestamp}, ...]
    this.progressTimers = new Map(); // jobId -> timer
    this.BATCH_INTERVAL_MS = 200; // Send batches every 200ms
    this.MAX_BATCH_SIZE = 50; // Max chunks per batch

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
      requestConfig.headers['X-Agent-ID'] = this.agentId;
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
   * Get endpoint category for rate limit tracking
   * @param {string} path - API path
   * @returns {string} Category name
   */
  getEndpointCategory(path) {
    if (path.includes('/progress')) return 'progress';
    if (path.includes('/events')) return 'events';
    if (path.includes('/metadata')) return 'metadata';
    return 'jobs';
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} True if should retry
   */
  isRetryableError(error) {
    if (!error.response) return true; // Network error - retry
    const status = error.response.status;
    // Retry on rate limits, timeouts, and server errors
    return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
  }

  /**
   * Make an API request with automatic retry and rate limit handling
   * @param {string} method - HTTP method (get, post, patch, etc.)
   * @param {string} path - Endpoint path (e.g., '/jobs/next' or '/jobs/{id}')
   * @param {Object} data - Request data (for POST/PATCH)
   * @param {Object} config - Axios config options
   * @param {number} maxRetries - Maximum retry attempts (default: 3)
   * @returns {Promise<Object>} Response object
   */
  async requestWithRetry(method, path, data = null, config = null, maxRetries = 3) {
    const category = this.getEndpointCategory(path);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Check if we're in backoff period for this endpoint category
        const backoffUntil = this.rateLimitBackoff[category] || 0;
        const now = Date.now();

        if (now < backoffUntil) {
          const waitMs = backoffUntil - now;
          logger.warn(`Rate limit backoff active for ${category}, waiting ${waitMs}ms`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }

        // Make the request using existing fallback logic
        return await this.requestWithFallback(method, path, data, config);

      } catch (error) {
        const isLastAttempt = attempt === maxRetries;

        // Handle rate limiting
        if (error.response?.status === 429) {
          // Get retry-after header (in seconds) or use exponential backoff
          const retryAfter = error.response.headers['retry-after'];
          const backoffMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : Math.min(1000 * Math.pow(2, attempt), 30000); // 1s, 2s, 4s, max 30s

          logger.warn(
            `Rate limited on ${path} (attempt ${attempt + 1}/${maxRetries + 1}), ` +
            `backing off ${backoffMs}ms`
          );

          // Set backoff for this endpoint category
          this.rateLimitBackoff[category] = Date.now() + backoffMs;

          if (!isLastAttempt) {
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
        }

        // Handle other retryable errors
        if (this.isRetryableError(error) && !isLastAttempt) {
          const backoffMs = 1000 * Math.pow(2, attempt); // Exponential: 1s, 2s, 4s
          logger.warn(
            `Retryable error on ${path} (${error.message}), ` +
            `retry ${attempt + 1}/${maxRetries + 1} after ${backoffMs}ms`
          );
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        // Not retryable or last attempt - throw
        throw error;
      }
    }
  }

  /**
   * Make an API request with automatic fallback from new to old endpoints
   * @param {string} method - HTTP method (get, post, patch, etc.)
   * @param {string} path - Endpoint path (e.g., '/jobs/next' or '/jobs/{id}')
   * @param {Object} data - Request data (for POST/PATCH)
   * @param {Object} config - Axios config options
   * @returns {Promise<Object>} Response object
   */
  async requestWithFallback(method, path, data = null, config = null) {
    const newEndpoint = `${NEW_API_PREFIX}${path}`;
    const oldEndpoint = `${OLD_API_PREFIX}${path}`;

    try {
      // Try new endpoint first
      const endpoint = this.useNewEndpoints ? newEndpoint : oldEndpoint;
      logger.debug(`API request: ${method.toUpperCase()} ${endpoint}`);

      // Build args array based on what's provided
      let args;
      if (data && config) {
        args = [endpoint, data, config];
      } else if (data) {
        args = [endpoint, data];
      } else if (config) {
        args = [endpoint, config];
      } else {
        args = [endpoint];
      }

      const response = await this.client[method](...args);

      // If we successfully used new endpoints, log once
      if (this.useNewEndpoints && endpoint === newEndpoint) {
        logger.debug('Using new /api/v1/rb/* endpoints');
      }

      return response;
    } catch (error) {
      // If we got a 404 and we were trying new endpoints, fall back to old
      if (error.response?.status === 404 && this.useNewEndpoints) {
        logger.info('New endpoint not found, falling back to legacy /api/v1/ralph/* endpoints');
        this.useNewEndpoints = false;

        // Retry with old endpoint - rebuild args array
        let args;
        if (data && config) {
          args = [oldEndpoint, data, config];
        } else if (data) {
          args = [oldEndpoint, data];
        } else if (config) {
          args = [oldEndpoint, config];
        } else {
          args = [oldEndpoint];
        }

        return await this.client[method](...args);
      }

      // Re-throw all other errors
      throw error;
    }
  }

  /**
   * Poll for next available job (with long polling)
   * @returns {Promise<Object|null>} Job object or null if no jobs available
   */
  async getNextJob() {
    try {
      logger.info(`Polling for next job (long poll timeout: ${SERVER_LONG_POLL_TIMEOUT_S}s)...`);
      const response = await this.requestWithFallback('get', '/jobs/next', null, {
        params: { timeout: SERVER_LONG_POLL_TIMEOUT_S }, // Server waits up to 30s for job
        timeout: LONG_POLLING_TIMEOUT_MS // Client waits up to 35s (30s + 5s buffer)
      });

      if (response.status === 204) {
        // No jobs available
        logger.info('No jobs available (HTTP 204)');
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

        logger.info(`✓ Claimed job #${job.id} - ${job.task_title}`);

        // Log full job details (upgraded from debug to info for visibility)
        logger.info('Job details:', {
          id: job.id,
          job_type: job.job_type,
          task_title: job.task_title,
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
        logger.info('No jobs available (HTTP 204)');
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

      logger.error('Error fetching next job: ' + error.message);
      return null;
    }
  }

  /**
   * Update job status to running
   * @param {number} jobId - Job ID
   */
  async markJobRunning(jobId) {
    try {
      await this.requestWithFallback('patch', `/jobs/${jobId}`, {
        status: 'running'
      });
      logger.info(`Job #${jobId} marked as running`);
    } catch (error) {
      logger.error(`Error marking job #${jobId} as running: ${error.message}`);
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

    // Security: Reject output containing null bytes (potential injection attack)
    if (output.includes('\0')) {
      logger.error('Output contains null bytes - rejecting for security');
      throw new Error('Output validation failed: null bytes detected');
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
    // Flush any remaining progress updates before marking complete
    await this.flushProgressBuffer(jobId);

    try {
      logger.debug(`Building completion payload for job #${jobId}...`, {
        hasOutput: !!result.output,
        outputLength: result.output?.length || 0,
        hasPrdContent: !!result.prdContent,
        prdContentLength: result.prdContent?.length || 0,
        hasSummary: !!result.summary,
        hasBranchName: !!result.branchName,
        hasGitActivity: !!result.gitActivity,
        executionTimeMs: result.executionTimeMs
      });

      const payload = {
        status: 'completed',
        // Phase 2.2: REMOVED output (already streamed via progress_batch)
        // Phase 2.2: REMOVED prd_content (already streamed via progress_batch)
        execution_time_ms: result.executionTimeMs
      };

      // Add job-type specific fields with validation
      if (result.summary) {
        logger.debug('Adding summary to payload', { length: result.summary.length });
        payload.summary = this.validateOutput(result.summary, 10000); // 10KB max
      }
      if (result.branchName) {
        // Validate branch name format following git branch naming rules:
        // - Must start with alphanumeric
        // - Can contain alphanumeric, dash, underscore
        // - Can contain forward slash for hierarchical names (e.g., feature/foo)
        // - Each segment must start with alphanumeric (not dash/slash)
        // - Max length 200 characters
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(result.branchName) ||
            result.branchName.length > 200) {
          logger.warn('Invalid branch name format, omitting from payload', { branchName: result.branchName });
        } else {
          logger.debug('Adding branch name to payload', { branchName: result.branchName });
          payload.branch_name = result.branchName;
        }
      }

      // Add git activity metadata
      if (result.gitActivity) {
        logger.debug('Adding git activity to payload', result.gitActivity);
        payload.git_activity = {
          commit_count: result.gitActivity.commitCount || 0,
          last_commit: result.gitActivity.lastCommit || null,
          changes: result.gitActivity.changes || null,
          pushed_to_remote: result.gitActivity.pushedToRemote || false,
          has_uncommitted_changes: result.gitActivity.hasUncommittedChanges || false
        };
      }

      logger.debug('Sending PATCH request to mark job as completed...', {
        endpoint: `/jobs/${jobId}`,
        payloadSize: JSON.stringify(payload).length
      });

      await this.requestWithRetry('patch', `/jobs/${jobId}`, payload, null, 3);
      logger.info(`✓ Job #${jobId} successfully marked as completed in API`);
    } catch (error) {
      logger.error(`✗ Failed to mark job #${jobId} as completed in API`, {
        error: error.message,
        statusCode: error.response?.status,
        responseData: error.response?.data,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
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
    // Flush any remaining progress updates before marking failed
    await this.flushProgressBuffer(jobId);

    try {
      // Support both Error objects and string messages for backward compatibility
      const errorMessage = typeof error === 'string' ? error : error.message || String(error);

      logger.debug('Building failure payload...', {
        errorMessage: errorMessage,
        errorType: typeof error,
        hasPartialOutput: !!(partialOutput || error.partialOutput),
        partialOutputLength: (partialOutput || error.partialOutput)?.length || 0
      });

      const payload = {
        status: 'failed',
        error: errorMessage,
        output: partialOutput || error.partialOutput || null
      };

      // Add error categorization if available (from enriched Error objects)
      if (typeof error === 'object' && error !== null) {
        if (error.category) {
          payload.error_category = error.category;
          logger.debug('Error category identified', { category: error.category });
        }
        if (error.technicalDetails) {
          payload.error_details = error.technicalDetails;
          logger.debug('Technical details available', {
            detailsLength: error.technicalDetails.length
          });
        }
        if (error.stack) {
          logger.debug('Error stack trace (first 5 lines):', {
            stack: error.stack.split('\n').slice(0, 5).join('\n')
          });
        }
      }

      logger.debug('Sending PATCH request to mark job as failed...', {
        endpoint: `/jobs/${jobId}`,
        errorCategory: payload.error_category || 'unknown',
        hasErrorDetails: !!payload.error_details
      });

      await this.requestWithRetry('patch', `/jobs/${jobId}`, payload, null, 3);
      logger.info(`✓ Job #${jobId} successfully marked as failed in API with category: ${payload.error_category || 'unknown'}`);
    } catch (apiError) {
      logger.error(`✗ Failed to mark job #${jobId} as failed in API (meta-failure!)`, {
        originalError: typeof error === 'string' ? error : error.message,
        apiError: apiError.message,
        statusCode: apiError.response?.status,
        responseData: apiError.response?.data
      });
      // Don't throw - we want to continue even if this fails
    }
  }

  /**
   * Send heartbeat to keep job alive (updates claimed_at)
   * Optionally includes status event data to reduce API calls
   * @param {number} jobId - Job ID
   * @param {Object} statusEvent - Optional {event_type, message, metadata}
   */
  async sendHeartbeat(jobId, statusEvent = null) {
    try {
      const payload = {
        status: 'running',
        heartbeat: true  // Distinguish from initial markJobRunning call
      };

      // Phase 1.2: Include status event if provided (reduces API calls by 50%)
      if (statusEvent) {
        payload.status_event = statusEvent;
      }

      await this.requestWithFallback('patch', `/jobs/${jobId}`, payload);
      logger.debug(`Heartbeat sent for job #${jobId}${statusEvent ? ' (with event)' : ''}`);
    } catch (error) {
      logger.warn(`Error sending heartbeat for job #${jobId}: ${error.message}`);
    }
  }

  /**
   * Send progress update for job (streaming Claude output)
   * Batches chunks for efficiency
   * @param {number} jobId - Job ID
   * @param {string} chunk - Output chunk
   * @param {Object} metadata - Optional metadata for milestones/events
   */
  async sendProgress(jobId, chunk, metadata = null) {
    // Initialize buffer for this job if needed
    if (!this.progressBuffer.has(jobId)) {
      this.progressBuffer.set(jobId, []);
    }

    // Add chunk to buffer with timestamp and optional metadata
    const buffer = this.progressBuffer.get(jobId);
    const entry = {
      chunk,
      timestamp: Date.now()
    };

    // Phase 2.3: Include metadata for milestones/events (reduces API calls)
    if (metadata && Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }

    buffer.push(entry);

    // Flush immediately if buffer is full
    if (buffer.length >= this.MAX_BATCH_SIZE) {
      await this.flushProgressBuffer(jobId);
      return;
    }

    // Otherwise, schedule batch send if not already scheduled
    if (!this.progressTimers.has(jobId)) {
      const timer = setTimeout(() => {
        this.flushProgressBuffer(jobId).catch(err => {
          logger.debug(`Error flushing progress buffer: ${err.message}`);
        });
      }, this.BATCH_INTERVAL_MS);
      this.progressTimers.set(jobId, timer);
    }
  }

  /**
   * Flush buffered progress updates for a job
   * @param {number} jobId - Job ID
   */
  async flushProgressBuffer(jobId) {
    // Clear timer if it exists
    const timer = this.progressTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.progressTimers.delete(jobId);
    }

    // Get buffer
    const buffer = this.progressBuffer.get(jobId);
    if (!buffer || buffer.length === 0) return;

    // Clear buffer immediately to prevent duplicates
    this.progressBuffer.set(jobId, []);

    try {
      // Send batched updates
      await this.requestWithRetry('post', `/jobs/${jobId}/progress_batch`, {
        updates: buffer
      }, null, 2);

      logger.debug(`Batched ${buffer.length} progress updates for job #${jobId}`);
    } catch (error) {
      logger.warn(`Error sending batched progress for job #${jobId}: ${error.message}`);
      // Don't throw - progress updates are best-effort
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
      // Use retry with 2 attempts for status events (best-effort)
      await this.requestWithRetry('post', `/jobs/${jobId}/events`, {
        event_type: eventType,
        message: message,
        metadata: metadata
      }, null, 2);
      logger.debug(`Status event sent for job #${jobId}: ${eventType} - ${message}`);
    } catch (error) {
      logger.warn(`Error sending status event for job #${jobId}: ${error.message}`);
      // Don't throw - status events are best-effort for UI visibility
    }
  }

  /**
   * Update job metadata (best-effort, doesn't fail job if unsuccessful)
   * @param {number} jobId - Job ID
   * @param {Object} metadata - Metadata object to merge
   */
  async updateJobMetadata(jobId, metadata) {
    // Validate metadata
    if (!metadata || typeof metadata !== 'object') {
      logger.warn('Invalid metadata: must be an object');
      return;
    }

    // Check metadata size to prevent sending excessively large payloads
    try {
      const metadataStr = JSON.stringify(metadata);
      if (metadataStr.length > 10000) {
        logger.warn(`Metadata too large (${metadataStr.length} bytes), truncating`);
        return;
      }
    } catch (error) {
      logger.warn(`Error serializing metadata: ${error.message}`);
      return;
    }

    try {
      await this.requestWithFallback('patch', `/jobs/${jobId}/metadata`, {
        metadata: metadata
      });
      logger.debug(`Metadata updated for job #${jobId}`, metadata);
    } catch (error) {
      logger.warn(`Error updating metadata for job #${jobId}: ${error.message}`);
      // Don't throw - metadata updates are best-effort
    }
  }

  /**
   * Add a setup log entry (appears in "Instance Setup Logs" section of UI)
   * Best-effort - doesn't fail job if unsuccessful
   * @param {number} jobId - Job ID
   * @param {string} level - Log level ('info' or 'error')
   * @param {string} message - Log message
   * @param {Object} metadata - Optional structured metadata (Phase 3)
   */
  async addSetupLog(jobId, level, message, metadata = null) {
    try {
      const payload = {
        level: level,
        message: message,
        timestamp: new Date().toISOString()
      };

      // Add metadata if present (Phase 3)
      if (metadata && Object.keys(metadata).length > 0) {
        payload.metadata = metadata;
      }

      await this.requestWithFallback('patch', `/jobs/${jobId}/setup_log`, payload);
      logger.debug(`Setup log sent for job #${jobId}: [${level}] ${message}`);
    } catch (error) {
      logger.debug(`Error sending setup log for job #${jobId}: ${error.message}`);
      // Don't throw - setup logs are best-effort for UI visibility
      // Silently fail to avoid disrupting job execution
    }
  }

  /**
   * Add multiple setup log entries in a single batch (more efficient)
   * Best-effort - doesn't fail job if unsuccessful
   * @param {number} jobId - Job ID
   * @param {Array} logs - Array of log objects with {timestamp, level, message}
   */
  async addSetupLogBatch(jobId, logs) {
    if (!logs || logs.length === 0) return;

    try {
      await this.requestWithFallback('post', `/jobs/${jobId}/setup_logs`, {
        logs: logs
      }, {
        timeout: BATCH_API_TIMEOUT_MS // 30s for batch operations
      });
      logger.debug(`Batch setup logs sent for job #${jobId}: ${logs.length} logs`);
    } catch (error) {
      logger.debug(`Error sending batch setup logs for job #${jobId}: ${error.message}`);
      // Don't throw - setup logs are best-effort for UI visibility
      // Silently fail to avoid disrupting job execution
      throw error; // Rethrow so batcher can fall back to individual sends
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
