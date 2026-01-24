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
   * @param {string} workingDir - Working directory where logs should be created
   * @param {Object} job - Job object containing id and task_title
   * @param {number} startTime - Job start timestamp
   * @param {string} jobType - Type of job (e.g., 'PRD Generation', 'Plan Generation', 'Clarifying Questions Generation')
   * @returns {Promise<{logFile: string, logStream: WriteStream}>} Path and stream for the created log file
   */
  static async createJobLogStream(workingDir, job, startTime, jobType) {
    // Create .ralph-logs directory
    const logDir = path.join(workingDir, '.ralph-logs');
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
   * @param {string} workingDir - Working directory where logs should be created
   * @param {Object} job - Job object containing id and task_title
   * @param {number} startTime - Job start timestamp
   * @param {string} jobType - Type of job (e.g., 'Code Execution')
   * @param {string} content - Full content to write (including header and body)
   * @returns {Promise<string>} Path to the created log file
   */
  static async createJobLogWithContent(workingDir, job, startTime, jobType, content) {
    // Create .ralph-logs directory
    const logDir = path.join(workingDir, '.ralph-logs');
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
   * @param {WriteStream} logStream - Write stream for the log file
   * @param {string} jobType - Type of job (e.g., 'PRD Generation')
   * @param {Object} metadata - Optional metadata to include in footer (e.g., questionCount)
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
   * @param {string} logFile - Path to the log file
   * @param {string} jobType - Type of job (e.g., 'Plan Generation')
   * @param {Object} metadata - Optional metadata to include in footer (e.g., questionCount)
   * @returns {Promise<void>}
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
   * @param {WriteStream} logStream - Write stream for the log file
   * @param {Function} onProgress - Original progress callback
   * @param {Function} logger - Logger instance for warnings
   * @param {Object} options - Optional configuration
   * @param {number} options.logFrequency - How often to log progress (default: every 50 chunks)
   * @param {string} options.progressMessage - Custom progress message prefix
   * @returns {Function} Wrapped progress callback with totalChunks tracker
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
   * @param {string} logFile - Path to the log file
   * @param {Function} onProgress - Original progress callback
   * @param {Function} logger - Logger instance for warnings
   * @param {Object} options - Optional configuration
   * @param {number} options.logFrequency - How often to log progress (default: every 50 chunks)
   * @param {string} options.progressMessage - Custom progress message prefix
   * @returns {Function} Wrapped progress callback
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
