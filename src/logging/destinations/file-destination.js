const BaseDestination = require('./base-destination');
const LogFileHelper = require('../../utils/log-file-helper');
const fs = require('fs');
const fsPromises = require('fs').promises;

/**
 * FileDestination - Writes logs to job-specific log files
 *
 * Wraps LogFileHelper to provide file-based logging through the destination interface.
 * Supports both streaming (for real-time output) and batch writing modes.
 * Each job gets its own log file in the .rb-logs directory.
 */
class FileDestination extends BaseDestination {
  /**
   * Create a new file destination
   * @param {Object} config - Configuration options
   * @param {string} config.workingDir - Working directory for log files
   * @param {Object} config.job - Job object with id and task_title
   * @param {number} config.startTime - Job start timestamp
   * @param {string} config.jobType - Type of job (e.g., 'PRD Generation')
   * @param {boolean} [config.useStream=true] - Use streaming mode vs batch writes
   */
  constructor(config) {
    super(config);

    if (!config.workingDir) {
      throw new Error('FileDestination requires workingDir in config');
    }
    if (!config.job) {
      throw new Error('FileDestination requires job in config');
    }
    if (!config.startTime) {
      throw new Error('FileDestination requires startTime in config');
    }
    if (!config.jobType) {
      throw new Error('FileDestination requires jobType in config');
    }

    this.workingDir = config.workingDir;
    this.job = config.job;
    this.startTime = config.startTime;
    this.jobType = config.jobType;
    this.useStream = config.useStream !== false;

    // Will be initialized on first write
    this.logFile = null;
    this.logStream = null;
    this.initialized = false;
  }

  /**
   * Initialize log file/stream on first write
   * @returns {Promise<void>}
   * @private
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      if (this.useStream) {
        // Create log file with stream for real-time writing
        const result = await LogFileHelper.createJobLogStream(
          this.workingDir,
          this.job,
          this.startTime,
          this.jobType
        );
        this.logFile = result.logFile;
        this.logStream = result.logStream;
      } else {
        // For non-streaming mode, we'll use append operations
        // Create initial log file with header
        this.logFile = await LogFileHelper.createJobLogWithContent(
          this.workingDir,
          this.job,
          this.startTime,
          this.jobType,
          '' // Empty content, we'll append logs
        );
      }

      this.initialized = true;
    } catch (error) {
      this.handleError(error, 'error', 'Failed to initialize file destination');
      throw error; // Re-throw to indicate initialization failure
    }
  }

  /**
   * Write a log entry to the log file
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} [metadata={}] - Structured metadata
   * @returns {Promise<void>}
   */
  async write(level, message, metadata = {}) {
    try {
      // Initialize on first write
      if (!this.initialized) {
        await this.initialize();
      }

      // Format log entry
      const timestamp = new Date().toISOString();
      const formattedLevel = level.toUpperCase().padEnd(5);
      let logLine = `[${timestamp}] ${formattedLevel} ${message}`;

      // Add metadata if present
      if (metadata && Object.keys(metadata).length > 0) {
        const metadataStr = JSON.stringify(metadata);
        logLine += ` | ${metadataStr}`;
      }

      logLine += '\n';

      // Write to file
      if (this.useStream && this.logStream) {
        // Streaming mode - write immediately
        this.logStream.write(logLine);
      } else if (this.logFile) {
        // Batch mode - append to file
        await fsPromises.appendFile(this.logFile, logLine);
      }
    } catch (error) {
      this.handleError(error, level, message);
    }
  }

  /**
   * Flush any buffered writes
   * For streams, this is a no-op as writes are immediate.
   * @returns {Promise<void>}
   */
  async flush() {
    // Stream writes are immediate, no buffering to flush
    // Non-stream mode uses fsPromises.appendFile which is also immediate
  }

  /**
   * Close the log file and write completion footer
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.initialized) {
      return;
    }

    this.isShuttingDown = true;

    try {
      // Flush any pending writes
      await this.flush();

      // Write completion footer
      if (this.useStream && this.logStream) {
        LogFileHelper.writeCompletionFooterToStream(
          this.logStream,
          this.jobType,
          {}
        );
        // Close the stream
        await new Promise((resolve, reject) => {
          this.logStream.end((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else if (this.logFile) {
        await LogFileHelper.writeCompletionFooter(
          this.logFile,
          this.jobType,
          {}
        );
      }
    } catch (error) {
      this.handleError(error, 'error', 'Failed to close file destination');
    }
  }

  /**
   * Get the log file path
   * Useful for reporting or accessing the log file after job completion.
   * @returns {string|null} Path to log file, or null if not initialized
   */
  getLogFilePath() {
    return this.logFile;
  }

  /**
   * Handle errors during file operations
   * Outputs to console.error since we can't write to the log file
   * @param {Error} error - The error that occurred
   * @param {string} level - Log level of failed write
   * @param {string} message - Log message of failed write
   * @protected
   */
  handleError(error, level, message) {
    // Can't log to file since that's what failed, use console instead
    console.error(
      `[FileDestination Error] Failed to write to log file: ${error.message}`,
      `\nOriginal log: [${level}] ${message}`
    );
  }
}

module.exports = FileDestination;
