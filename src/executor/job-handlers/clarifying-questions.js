const fs = require('fs');
const path = require('path');
const logger = require('../../logger');
const safeJsonParse = require('secure-json-parse');
const ProgressParser = require('../../utils/progress-parser');

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
      const workingDir = this.pathHelper.validateProjectPathWithFallback(
        job.project?.system_path,
        process.cwd()
      );

      // Clear any existing log file for this job to avoid showing old logs
      await this.clearExistingLogFile(workingDir, job.id);

      // Send status event to UI
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'clarifying_questions_started', 'Generating clarifying questions with Claude...');
      }

      // Create ProgressParser for structured milestone tracking
      const progressParser = new ProgressParser(this.apiClient, job.id, 'clarifying_questions');

      // Create a progress callback that:
      // 1. Sends progress updates to API (which broadcasts to UI in real-time)
      // 2. Uses ProgressParser for structured updates
      // 3. Forwards all chunks to terminal (let index.js handle throttling)
      const smartProgress = async (chunk) => {
        // Send progress to API (best-effort, don't fail on errors)
        if (this.apiClient) {
          try {
            await this.apiClient.sendProgress(job.id, chunk);
          } catch (err) {
            logger.debug(`Failed to send progress to API: ${err.message}`);
          }
        }

        // Process through ProgressParser for structured milestone updates
        await progressParser.processChunk(chunk);

        // Forward all chunks to terminal (let index.js handle throttling)
        if (onProgress) {
          await onProgress(chunk);
        }
      };

      // Use Claude Code with server-provided template
      logger.info('Invoking Claude Code for clarifying questions generation...');
      const result = await this.claudeRunner.runClaudeDirectly(workingDir, prompt, job, smartProgress);
      const output = result.output;
      logger.info('Claude Code execution completed', {
        outputLength: output.length
      });

      // Validate and parse JSON output
      logger.info('Validating JSON output...');
      let parsedOutput;
      try {
        // Security: Validate JSON size before parsing (prevent memory exhaustion)
        const MAX_JSON_SIZE = 10 * 1024 * 1024; // 10MB
        if (output.length > MAX_JSON_SIZE) {
          throw new Error(`JSON output exceeds maximum size of ${MAX_JSON_SIZE} bytes (got ${output.length} bytes)`);
        }

        // Security: Use safe JSON parser to prevent prototype pollution and limit depth
        parsedOutput = safeJsonParse.parse(output, null, {
          protoAction: 'remove',      // Remove __proto__ properties
          constructorAction: 'remove' // Remove constructor properties
        });

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
        logger.error('Failed to parse or validate JSON output:', { error: parseError.message, output: output.slice(0, 500) });
        throw new Error(`Invalid JSON output: ${parseError.message}`);
      }

      // Mark progress as complete
      await progressParser.markComplete();

      // Flush any remaining progress updates
      if (this.apiClient) {
        await this.apiClient.flushProgressBuffer(job.id);
      }

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

module.exports = ClarifyingQuestionsHandler;
