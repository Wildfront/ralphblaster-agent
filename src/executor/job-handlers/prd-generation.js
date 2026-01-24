const fs = require('fs');
const path = require('path');
const logger = require('../../logger');
const LogFileHelper = require('../../utils/log-file-helper');

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

    let logStream = null;
    try {
      // Determine and sanitize working directory
      logger.info('Determining working directory...');
      const workingDir = this.pathHelper.validateProjectPathWithFallback(
        job.project?.system_path,
        process.cwd()
      );

      // Setup log file for streaming PRD generation output
      logger.info('Setting up log file...');
      const { logFile, logStream: stream } = await LogFileHelper.createJobLogStream(
        workingDir,
        job,
        startTime,
        'PRD Generation'
      );
      logStream = stream;
      logger.info(`PRD generation log created at: ${logFile}`);

      // Send status event to UI
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'prd_generation_started', 'Starting PRD generation with Claude...');
      }

      // Create a wrapper onProgress that also writes to log file
      const logAndProgress = LogFileHelper.createLogAndProgressCallbackStream(
        logStream,
        onProgress,
        logger,
        { progressMessage: 'PRD generation progress' }
      );

      // Use Claude Code with server-provided template (no longer using /prd skill)
      logger.info('Invoking Claude Code for PRD generation...');
      logger.info('This may take several minutes depending on complexity');
      const output = await this.claudeRunner.runClaude(prompt, workingDir, logAndProgress);
      logger.info('Claude Code execution completed', {
        outputLength: output.length,
        totalChunks: logAndProgress.totalChunks
      });

      // Write completion footer to log
      logger.info('Writing completion footer to log file...');
      LogFileHelper.writeCompletionFooterToStream(logStream, 'PRD Generation');
      logger.info(`PRD generation log completed: ${logFile}`);

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
    } finally {
      // Ensure log stream is properly closed
      if (logStream) {
        logStream.end();
      }
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

    let logStream = null;
    try {
      // Determine working directory
      const workingDir = this.pathHelper.validateProjectPathWithFallback(
        job.project?.system_path,
        process.cwd()
      );

      // Setup log file for streaming plan generation output
      const { logFile, logStream: stream } = await LogFileHelper.createJobLogStream(
        workingDir,
        job,
        startTime,
        'Plan Generation'
      );
      logStream = stream;
      logger.info(`Plan generation log created at: ${logFile}`);

      // Create a wrapper onProgress that also writes to log file
      const logAndProgress = LogFileHelper.createLogAndProgressCallbackStream(
        logStream,
        onProgress,
        logger,
        { progressMessage: 'Plan generation progress' }
      );

      // Use Claude Code to trigger planning mode
      const output = await this.claudeRunner.runClaude(prompt, workingDir, logAndProgress);

      // Write completion footer to log
      LogFileHelper.writeCompletionFooterToStream(logStream, 'Plan Generation');
      logger.info(`Plan generation log completed: ${logFile}`);

      const executionTimeMs = Date.now() - startTime;

      return {
        output: output,
        prdContent: output.trim(), // The plan content
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      logger.error(`Plan generation failed for job #${job.id}: ${error.message}`);
      throw error;
    } finally {
      // Ensure log stream is properly closed
      if (logStream) {
        logStream.end();
      }
    }
  }
}

module.exports = PrdGenerationHandler;
