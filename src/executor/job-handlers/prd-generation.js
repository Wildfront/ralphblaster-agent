const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

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
   * @param {Object} pathValidator - Path validator with validateAndSanitizePath method
   * @param {Object} claudeRunner - Claude runner with runClaude method
   * @param {Object} apiClient - Optional API client for status updates
   */
  constructor(promptValidator, pathValidator, claudeRunner, apiClient = null) {
    this.promptValidator = promptValidator;
    this.pathValidator = pathValidator;
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
      let workingDir = process.cwd();
      if (job.project?.system_path) {
        logger.info('Project path provided, validating...', { path: job.project.system_path });
        const sanitizedPath = this.pathValidator.validateAndSanitizePath(job.project.system_path);
        if (sanitizedPath && fs.existsSync(sanitizedPath)) {
          workingDir = sanitizedPath;
          logger.info('Using project directory', { workingDir });
        } else {
          logger.warn(`Invalid or missing project path, using current directory: ${process.cwd()}`);
        }
      } else {
        logger.info('No project path provided, using current directory', { workingDir });
      }

      // Setup log file for streaming PRD generation output
      logger.info('Setting up log file...');
      const logDir = path.join(workingDir, '.ralph-logs');
      await fsPromises.mkdir(logDir, { recursive: true });
      const logFile = path.join(logDir, `job-${job.id}.log`);

      // Write initial log header
      const logHeader = `═══════════════════════════════════════════════════════════
PRD Generation Job #${job.id} - ${job.task_title}
Started: ${new Date(startTime).toISOString()}
═══════════════════════════════════════════════════════════

`;
      await fsPromises.writeFile(logFile, logHeader);
      logger.info(`PRD generation log created at: ${logFile}`);

      // Send status event to UI
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'prd_generation_started', 'Starting PRD generation with Claude...');
      }

      // Create a wrapper onProgress that also writes to log file
      let totalChunks = 0;
      const logAndProgress = async (chunk) => {
        totalChunks++;

        // Append chunk to log file
        try {
          await fsPromises.appendFile(logFile, chunk);
        } catch (err) {
          logger.warn(`Failed to append to log file: ${err.message}`);
        }

        // Log progress periodically (every 50 chunks to avoid spam)
        if (totalChunks % 50 === 0) {
          logger.debug(`PRD generation progress: ${totalChunks} chunks received`);
        }

        // Call original progress callback if provided
        if (onProgress) {
          onProgress(chunk);
        }
      };

      // Use Claude Code with server-provided template (no longer using /prd skill)
      logger.info('Invoking Claude Code for PRD generation...');
      logger.info('This may take several minutes depending on complexity');
      const output = await this.claudeRunner.runClaude(prompt, workingDir, logAndProgress);
      logger.info('Claude Code execution completed', {
        outputLength: output.length,
        totalChunks
      });

      // Write completion footer to log
      logger.info('Writing completion footer to log file...');
      const logFooter = `
═══════════════════════════════════════════════════════════
PRD Generation completed at: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════
`;
      await fsPromises.appendFile(logFile, logFooter);
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
      let workingDir = process.cwd();
      if (job.project?.system_path) {
        const sanitizedPath = this.pathValidator.validateAndSanitizePath(job.project.system_path);
        if (sanitizedPath && fs.existsSync(sanitizedPath)) {
          workingDir = sanitizedPath;
        }
      }

      // Setup log file for streaming plan generation output
      const logDir = path.join(workingDir, '.ralph-logs');
      await fsPromises.mkdir(logDir, { recursive: true });
      const logFile = path.join(logDir, `job-${job.id}.log`);

      // Write initial log header
      const logHeader = `═══════════════════════════════════════════════════════════
Plan Generation Job #${job.id} - ${job.task_title}
Started: ${new Date(startTime).toISOString()}
═══════════════════════════════════════════════════════════

`;
      await fsPromises.writeFile(logFile, logHeader);
      logger.info(`Plan generation log created at: ${logFile}`);

      // Create a wrapper onProgress that also writes to log file
      const logAndProgress = async (chunk) => {
        // Append chunk to log file
        try {
          await fsPromises.appendFile(logFile, chunk);
        } catch (err) {
          logger.warn(`Failed to append to log file: ${err.message}`);
        }

        // Call original progress callback if provided
        if (onProgress) {
          onProgress(chunk);
        }
      };

      // Use Claude Code to trigger planning mode
      const output = await this.claudeRunner.runClaude(prompt, workingDir, logAndProgress);

      // Write completion footer to log
      const logFooter = `
═══════════════════════════════════════════════════════════
Plan Generation completed at: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════
`;
      await fsPromises.appendFile(logFile, logFooter);
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
    }
  }
}

module.exports = PrdGenerationHandler;
