const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

/**
 * ClarifyingQuestionsHandler - Handles clarifying questions generation jobs
 *
 * This class encapsulates clarifying questions logic including:
 * - Generating structured JSON questions
 * - Progress tracking and logging
 * - JSON validation
 * - Error handling
 */
class ClarifyingQuestionsHandler {
  /**
   * Create a new clarifying questions handler
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
   * Execute clarifying questions generation using Claude Code
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result with JSON output
   */
  async executeClarifyingQuestions(job, onProgress, startTime) {
    // Server must provide prompt
    if (!job.prompt || !job.prompt.trim()) {
      logger.error('No prompt provided by server for clarifying questions');
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

      // Setup log file for streaming clarifying questions output
      logger.info('Setting up log file...');
      const logDir = path.join(workingDir, '.ralph-logs');
      await fsPromises.mkdir(logDir, { recursive: true });
      const logFile = path.join(logDir, `job-${job.id}.log`);

      // Write initial log header
      const logHeader = `═══════════════════════════════════════════════════════════
Clarifying Questions Generation Job #${job.id} - ${job.task_title}
Started: ${new Date(startTime).toISOString()}
═══════════════════════════════════════════════════════════

`;
      await fsPromises.writeFile(logFile, logHeader);
      logger.info(`Clarifying questions log created at: ${logFile}`);

      // Send status event to UI
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'clarifying_questions_started', 'Generating clarifying questions with Claude...');
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
          logger.debug(`Clarifying questions progress: ${totalChunks} chunks received`);
        }

        // Call original progress callback if provided
        if (onProgress) {
          onProgress(chunk);
        }
      };

      // Use Claude Code with server-provided template
      logger.info('Invoking Claude Code for clarifying questions generation...');
      const output = await this.claudeRunner.runClaude(prompt, workingDir, logAndProgress);
      logger.info('Claude Code execution completed', {
        outputLength: output.length,
        totalChunks
      });

      // Validate and parse JSON output
      logger.info('Validating JSON output...');
      let parsedOutput;
      try {
        parsedOutput = JSON.parse(output);

        // Validate structure
        if (!parsedOutput.questions || !Array.isArray(parsedOutput.questions)) {
          throw new Error('Output must contain a "questions" array');
        }

        // Validate each question has required fields
        parsedOutput.questions.forEach((q, index) => {
          if (!q.id || !q.text || typeof q.required !== 'boolean') {
            throw new Error(`Question ${index + 1} missing required fields (id, text, required)`);
          }
        });

        logger.info('JSON validation successful', { questionCount: parsedOutput.questions.length });
      } catch (parseError) {
        logger.error('Failed to parse or validate JSON output:', { error: parseError.message, output });
        throw new Error(`Invalid JSON output: ${parseError.message}`);
      }

      // Write completion footer to log
      logger.info('Writing completion footer to log file...');
      const logFooter = `
═══════════════════════════════════════════════════════════
Clarifying Questions Generation completed at: ${new Date().toISOString()}
Generated ${parsedOutput.questions.length} questions
═══════════════════════════════════════════════════════════
`;
      await fsPromises.appendFile(logFile, logFooter);
      logger.info(`Clarifying questions log completed: ${logFile}`);

      // Send completion status event
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(
          job.id,
          'clarifying_questions_complete',
          `Generated ${parsedOutput.questions.length} clarifying questions`
        );
      }

      const executionTimeMs = Date.now() - startTime;
      logger.info('Clarifying questions generation successful', {
        executionTimeMs,
        questionCount: parsedOutput.questions.length
      });

      // Return JSON output as string for storage
      return {
        output: output.trim(), // Return the JSON string
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      logger.error(`Clarifying questions generation failed for job #${job.id}: ${error.message}`);
      logger.error('Error details:', {
        name: error.name,
        message: error.message,
        category: error.category,
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      });

      // Send failure status event
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(
          job.id,
          'clarifying_questions_failed',
          `Clarifying questions generation failed: ${error.message}`
        );
      }

      throw error;
    }
  }
}

module.exports = ClarifyingQuestionsHandler;
