const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

/**
 * LogFileHelper - Utility for managing job-specific log files
 *
 * Centralizes log file creation, header writing, and cleanup across job handlers
 */
class LogFileHelper {
  /**
   * Creates a job log file with standard header format using write streams
   * Recommended for real-time streaming of long-running job outputs (e.g., LLM streaming).
   * Creates .rb-logs directory if it doesn't exist.
   * @param {string} workingDir - Working directory where logs should be created
   * @param {Object} job - Job object containing id and task_title properties
   * @param {number} startTime - Job start timestamp (milliseconds since epoch)
   * @param {string} jobType - Type of job (e.g., 'PRD Generation', 'Plan Generation', 'Clarifying Questions Generation')
   * @returns {Promise<{logFile: string, logStream: WriteStream}>} Object with logFile path and logStream for writing
   * @example
   *   const { logFile, logStream } = await LogFileHelper.createJobLogStream(
   *     '/path/to/work',
   *     { id: 123, task_title: 'Generate PRD' },
   *     Date.now(),
   *     'PRD Generation'
   *   );
   */
  static async createJobLogStream(workingDir, job, startTime, jobType) {
    // Create .rb-logs directory
    const logDir = path.join(workingDir, '.rb-logs');
    await fsPromises.mkdir(logDir, { recursive: true });

    // Create log file path
    const logFile = path.join(logDir, `job-${job.id}.log`);

    // Create write stream for log file
    const logStream = fs.createWriteStream(logFile, { flags: 'w' });

    // Write header
    const logHeader = `═══════════════════════════════════════════════════════════
${jobType} Job #${job.id} - ${job.task_title}
Started: ${new Date(startTime).toISOString()}
═══════════════════════════════════════════════════════════

`;
    logStream.write(logHeader);

    return { logFile, logStream };
  }

  /**
   * Creates a job log file with standard header format using fsPromises (for code-execution.js)
   * Recommended for jobs with complete output available upfront (non-streaming).
   * Writes header, content, and footer in a single operation.
   * Creates .rb-logs directory if it doesn't exist.
   * @param {string} workingDir - Working directory where logs should be created
   * @param {Object} job - Job object containing id and task_title properties
   * @param {number} startTime - Job start timestamp (milliseconds since epoch)
   * @param {string} jobType - Type of job (e.g., 'Code Execution')
   * @param {string} content - Full content to write (body only, header/footer added automatically)
   * @returns {Promise<string>} Path to the created log file
   * @example
   *   const logFile = await LogFileHelper.createJobLogWithContent(
   *     '/path/to/work',
   *     { id: 123, task_title: 'Execute code' },
   *     Date.now(),
   *     'Code Execution',
   *     'Output:\nHello World'
   *   );
   */
  static async createJobLogWithContent(workingDir, job, startTime, jobType, content) {
    // Create .rb-logs directory
    const logDir = path.join(workingDir, '.rb-logs');
    await fsPromises.mkdir(logDir, { recursive: true });

    // Create log file path
    const logFile = path.join(logDir, `job-${job.id}.log`);

    // Write full content including header
    const logContent = `═══════════════════════════════════════════════════════════
Job #${job.id} - ${job.task_title}
Started: ${new Date(startTime).toISOString()}
═══════════════════════════════════════════════════════════

${content}

═══════════════════════════════════════════════════════════
Execution completed at: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════
`;
    await fsPromises.writeFile(logFile, logContent);

    return logFile;
  }

  /**
   * Writes a completion footer to a write stream
   * Call this when job completes to add a formatted completion timestamp and optional metadata.
   * @param {WriteStream} logStream - Write stream for the log file
   * @param {string} jobType - Type of job (e.g., 'PRD Generation')
   * @param {Object} [metadata={}] - Optional metadata to include in footer
   * @param {number} [metadata.questionCount] - Number of questions generated (if applicable)
   * @example
   *   LogFileHelper.writeCompletionFooterToStream(logStream, 'PRD Generation', { questionCount: 5 });
   *   logStream.end();
   */
  static writeCompletionFooterToStream(logStream, jobType, metadata = {}) {
    let footer = `
═══════════════════════════════════════════════════════════
${jobType} completed at: ${new Date().toISOString()}`;

    // Add optional metadata
    if (metadata.questionCount !== undefined) {
      footer += `\nGenerated ${metadata.questionCount} questions`;
    }

    footer += `
═══════════════════════════════════════════════════════════
`;

    logStream.write(footer);
  }

  /**
   * Writes a completion footer to the log file using fsPromises
   * Call this when job completes to add a formatted completion timestamp and optional metadata.
   * Uses append operation, safe to call after file has been written.
   * @param {string} logFile - Path to the log file
   * @param {string} jobType - Type of job (e.g., 'Plan Generation')
   * @param {Object} [metadata={}] - Optional metadata to include in footer
   * @param {number} [metadata.questionCount] - Number of questions generated (if applicable)
   * @returns {Promise<void>}
   * @example
   *   await LogFileHelper.writeCompletionFooter(logFile, 'Plan Generation', { questionCount: 3 });
   */
  static async writeCompletionFooter(logFile, jobType, metadata = {}) {
    let footer = `
═══════════════════════════════════════════════════════════
${jobType} completed at: ${new Date().toISOString()}`;

    // Add optional metadata
    if (metadata.questionCount !== undefined) {
      footer += `\nGenerated ${metadata.questionCount} questions`;
    }

    footer += `
═══════════════════════════════════════════════════════════
`;

    await fsPromises.appendFile(logFile, footer);
  }

  /**
   * Creates a wrapper function for progress callbacks that also logs to a write stream
   * Use for real-time streaming operations (e.g., LLM responses).
   * The returned callback writes each chunk to the log stream while calling the original callback.
   * Includes totalChunks property for tracking progress.
   * @param {WriteStream} logStream - Write stream for the log file
   * @param {Function} [onProgress] - Original progress callback (optional)
   * @param {Object} logger - Logger instance for warnings (must have .warn() method)
   * @param {Object} [options={}] - Optional configuration
   * @param {number} [options.logFrequency=50] - How often to log progress (default: every 50 chunks)
   * @param {string} [options.progressMessage='Progress'] - Custom progress message prefix
   * @returns {Function} Wrapped progress callback with totalChunks property
   * @example
   *   const callback = LogFileHelper.createLogAndProgressCallbackStream(
   *     logStream,
   *     (chunk) => console.log(chunk),
   *     logger,
   *     { logFrequency: 100 }
   *   );
   *   await streamResponse(callback);
   *   console.log(`Total chunks: ${callback.totalChunks}`);
   */
  static createLogAndProgressCallbackStream(logStream, onProgress, logger, options = {}) {
    const logFrequency = options.logFrequency || 50;
    const progressMessage = options.progressMessage || 'Progress';
    let totalChunks = 0;

    const callback = async (chunk) => {
      totalChunks++;

      // Write chunk to log stream
      try {
        logStream.write(chunk);
      } catch (err) {
        logger.warn(`Failed to write to log stream: ${err.message}`);
      }

      // Log progress periodically
      if (totalChunks % logFrequency === 0) {
        logger.debug(`${progressMessage}: ${totalChunks} chunks received`);
      }

      // Call original progress callback if provided
      if (onProgress) {
        onProgress(chunk);
      }
    };

    // Attach totalChunks getter for external access
    Object.defineProperty(callback, 'totalChunks', {
      get: () => totalChunks
    });

    return callback;
  }

  /**
   * Creates a wrapper function for progress callbacks that also logs to file using fsPromises
   * Use when write streams aren't available or for simpler file append operations.
   * The returned callback appends each chunk to the log file while calling the original callback.
   * Includes totalChunks property for tracking progress.
   * @param {string} logFile - Path to the log file
   * @param {Function} [onProgress] - Original progress callback (optional)
   * @param {Object} logger - Logger instance for warnings (must have .warn() method)
   * @param {Object} [options={}] - Optional configuration
   * @param {number} [options.logFrequency=50] - How often to log progress (default: every 50 chunks)
   * @param {string} [options.progressMessage='Progress'] - Custom progress message prefix
   * @returns {Function} Wrapped progress callback with totalChunks property
   * @example
   *   const callback = LogFileHelper.createLogAndProgressCallback(
   *     '/path/to/log.txt',
   *     (chunk) => process.stdout.write(chunk),
   *     logger
   *   );
   *   await streamResponse(callback);
   *   console.log(`Total chunks: ${callback.totalChunks}`);
   */
  static createLogAndProgressCallback(logFile, onProgress, logger, options = {}) {
    const logFrequency = options.logFrequency || 50;
    const progressMessage = options.progressMessage || 'Progress';
    let totalChunks = 0;

    const callback = async (chunk) => {
      totalChunks++;

      // Append chunk to log file
      try {
        await fsPromises.appendFile(logFile, chunk);
      } catch (err) {
        logger.warn(`Failed to append to log file: ${err.message}`);
      }

      // Log progress periodically
      if (totalChunks % logFrequency === 0) {
        logger.debug(`${progressMessage}: ${totalChunks} chunks received`);
      }

      // Call original progress callback if provided
      if (onProgress) {
        onProgress(chunk);
      }
    };

    // Attach totalChunks getter for external access
    Object.defineProperty(callback, 'totalChunks', {
      get: () => totalChunks
    });

    return callback;
  }
}

module.exports = LogFileHelper;
