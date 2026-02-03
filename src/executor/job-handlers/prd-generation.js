const fs = require('fs');
const path = require('path');
const logger = require('../../logger');
const ProgressParser = require('../../utils/progress-parser');

/**
 * PrdGenerationHandler - Handles PRD and Plan generation jobs
 *
 * This class encapsulates all PRD generation logic including:
 * - Standard PRD generation
 * - Plan generation (planning mode)
 * - Progress tracking and logging
 * - Error handling
 */
class PrdGenerationHandler {
  /**
   * Create a new PRD generation handler
   * @param {Object} promptValidator - Prompt validator with validatePrompt method
   * @param {Object} pathHelper - Helper for path validation and sanitization
   * @param {Object} claudeRunner - Claude runner with runClaude method
   * @param {Object} apiClient - Optional API client for status updates
   */
  constructor(promptValidator, pathHelper, claudeRunner, apiClient = null) {
    this.promptValidator = promptValidator;
    this.pathHelper = pathHelper;
    this.claudeRunner = claudeRunner;
    this.apiClient = apiClient;
  }

  /**
   * Execute standard PRD generation using Claude Code
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executeStandardPrd(job, onProgress, startTime) {
    // Server must provide prompt
    if (!job.prompt || !job.prompt.trim()) {
      logger.error('No prompt provided by server for PRD generation');
      throw new Error('No prompt provided by server');
    }

    // Use the server-provided prompt (already formatted with template system)
    const prompt = job.prompt;
    logger.info('Server-provided prompt received', { promptLength: prompt.length });

    // Validate prompt for security
    logger.info('Validating prompt for security...');
    this.promptValidator.validatePrompt(prompt);
    logger.info('Prompt validation passed');

    try {
      // Determine and sanitize working directory
      logger.info('Determining working directory...');
      const workingDir = this.pathHelper.validateProjectPathWithFallback(
        job.project?.system_path,
        process.cwd()
      );

      // Clear any existing log file for this job to avoid showing old logs
      await this.clearExistingLogFile(workingDir, job.id);

      // Send status event to UI
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'prd_generation_started', 'Starting PRD generation with Claude...');
      }

      // Create ProgressParser for structured milestone tracking
      const progressParser = new ProgressParser(this.apiClient, job.id, 'prd_generation');

      // Create a progress callback that:
      // 1. Sends progress updates to API (which broadcasts to UI in real-time)
      // 2. Uses ProgressParser for structured updates
      // 3. Forwards all chunks to terminal (let index.js handle throttling)
      const smartProgress = async (chunk) => {
        console.log('[DEBUG] smartProgress called with chunk length:', chunk?.length);
        // Send progress to API (best-effort, don't fail on errors)
        if (this.apiClient) {
          console.log('[DEBUG] Calling apiClient.sendProgress');
          try {
            await this.apiClient.sendProgress(job.id, chunk);
            console.log('[DEBUG] sendProgress succeeded');
          } catch (err) {
            console.error(`[DEBUG] Failed to send progress to API: ${err.message}`);
            logger.debug(`Failed to send progress to API: ${err.message}`);
          }
        } else {
          console.log('[DEBUG] apiClient is null!');
        }

        // Process through ProgressParser for structured milestone updates
        await progressParser.processChunk(chunk);

        // Forward all chunks to terminal (let index.js handle throttling)
        if (onProgress) {
          await onProgress(chunk);
        }
      };

      // Use Claude Code with server-provided template (no longer using /prd skill)
      logger.info('Invoking Claude Code for PRD generation...');
      logger.info('This may take several minutes depending on complexity');
      const result = await this.claudeRunner.runClaudeDirectly(workingDir, prompt, job, smartProgress);
      const output = result.output;
      logger.info('Claude Code execution completed', {
        outputLength: output.length
      });

      // Mark progress as complete
      await progressParser.markComplete();

      // Flush any remaining progress updates
      if (this.apiClient) {
        await this.apiClient.flushProgressBuffer(job.id);
      }

      // Send completion status event
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'prd_generation_complete', 'PRD generation completed successfully');
      }

      const executionTimeMs = Date.now() - startTime;
      logger.info('PRD generation successful', {
        executionTimeMs
      });

      return {
        output: output,
        prdContent: output.trim(), // The PRD content is the output
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      logger.error(`PRD generation failed for job #${job.id}: ${error.message}`);
      logger.error('Error details:', {
        name: error.name,
        message: error.message,
        category: error.category,
        stack: error.stack?.split('\n').slice(0, 5).join('\n') // First 5 lines of stack
      });

      // Send failure status event
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(
          job.id,
          'prd_generation_failed',
          `PRD generation failed: ${error.message}`
        );
      }

      throw error;
    }
  }

  /**
   * Execute plan generation using Claude Code planning mode
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executePlanGeneration(job, onProgress, startTime) {
    // Use the server-provided prompt (already formatted with template system)
    const prompt = job.prompt;

    try {
      // Determine working directory
      const workingDir = this.pathHelper.validateProjectPathWithFallback(
        job.project?.system_path,
        process.cwd()
      );

      // Clear any existing log file for this job to avoid showing old logs
      await this.clearExistingLogFile(workingDir, job.id);

      // Create ProgressParser for structured milestone tracking
      const progressParser = new ProgressParser(this.apiClient, job.id, 'prd_generation');

      // Create a progress callback that:
      // 1. Sends progress updates to API (which broadcasts to UI in real-time)
      // 2. Uses ProgressParser for structured updates
      // 3. Forwards all chunks to terminal (let index.js handle throttling)
      const smartProgress = async (chunk) => {
        console.log('[DEBUG] smartProgress called with chunk length:', chunk?.length);
        // Send progress to API (best-effort, don't fail on errors)
        if (this.apiClient) {
          console.log('[DEBUG] Calling apiClient.sendProgress');
          try {
            await this.apiClient.sendProgress(job.id, chunk);
            console.log('[DEBUG] sendProgress succeeded');
          } catch (err) {
            console.error(`[DEBUG] Failed to send progress to API: ${err.message}`);
            logger.debug(`Failed to send progress to API: ${err.message}`);
          }
        } else {
          console.log('[DEBUG] apiClient is null!');
        }

        // Process through ProgressParser for structured milestone updates
        await progressParser.processChunk(chunk);

        // Forward all chunks to terminal (let index.js handle throttling)
        if (onProgress) {
          await onProgress(chunk);
        }
      };

      // Use Claude Code to trigger planning mode
      const result = await this.claudeRunner.runClaudeDirectly(workingDir, prompt, job, smartProgress);
      const output = result.output;

      // Mark progress as complete
      await progressParser.markComplete();

      // Flush any remaining progress updates
      if (this.apiClient) {
        await this.apiClient.flushProgressBuffer(job.id);
      }

      const executionTimeMs = Date.now() - startTime;

      return {
        output: output,
        prdContent: output.trim(), // The plan content
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      logger.error(`Plan generation failed for job #${job.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear existing log file for a job to prevent old logs from showing
   * @param {string} workingDir - Working directory
   * @param {number} jobId - Job ID
   * @returns {Promise<void>}
   * @private
   */
  async clearExistingLogFile(workingDir, jobId) {
    try {
      const logDir = path.join(workingDir, '.rb-logs');
      const logFile = path.join(logDir, `job-${jobId}.log`);

      // Check if log file exists and delete it
      if (fs.existsSync(logFile)) {
        logger.debug(`Clearing existing log file: ${logFile}`);
        await fs.promises.unlink(logFile);
        logger.debug('Previous log file cleared successfully');
      }
    } catch (error) {
      // Don't fail the job if we can't clear the log file
      logger.warn(`Failed to clear existing log file: ${error.message}`);
    }
  }

}

module.exports = PrdGenerationHandler;
