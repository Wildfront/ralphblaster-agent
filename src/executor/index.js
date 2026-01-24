const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../logger');
const WorktreeManager = require('../worktree-manager');
const { formatDuration } = require('../utils/format');
const { validatePrompt } = require('./prompt-validator');
const { categorizeError } = require('./error-handler');
const EventDetector = require('./event-detector');
const GitHelper = require('./git-helper');
const ClaudeRunner = require('./claude-runner');
const PrdGenerationHandler = require('./job-handlers/prd-generation');
const CodeExecutionHandler = require('./job-handlers/code-execution');

// Timing constants
const PROCESS_KILL_GRACE_PERIOD_MS = 2000;

class Executor {
  constructor(apiClient = null) {
    this.apiClient = apiClient; // Optional API client for metadata updates
    this.eventDetector = new EventDetector(); // Event detector for progress tracking
    this.gitHelper = new GitHelper(); // Git operations helper

    // Create ClaudeRunner with dependencies
    const errorHandler = { categorizeError };
    this.claudeRunner = new ClaudeRunner(errorHandler, this.eventDetector, this.gitHelper);
    this.claudeRunner.setApiClient(apiClient);

    // Create shared validators
    const promptValidator = { validatePrompt };
    const pathValidator = { validateAndSanitizePath: this.validateAndSanitizePath.bind(this) };

    // Create PrdGenerationHandler with dependencies
    this.prdGenerationHandler = new PrdGenerationHandler(
      promptValidator,
      pathValidator,
      this.claudeRunner,
      apiClient
    );

    // Create CodeExecutionHandler with dependencies
    this.codeExecutionHandler = new CodeExecutionHandler(
      promptValidator,
      pathValidator,
      this.claudeRunner,
      this.gitHelper,
      apiClient
    );
  }

  /**
   * Getter for currentProcess (delegates to claudeRunner for backward compatibility)
   */
  get currentProcess() {
    return this.claudeRunner.currentProcess;
  }

  /**
   * Setter for currentProcess (delegates to claudeRunner for backward compatibility)
   */
  set currentProcess(value) {
    this.claudeRunner.currentProcess = value;
  }

  /**
   * Get sanitized environment variables (delegates to claudeRunner for backward compatibility)
   * @returns {Object} Sanitized environment object
   */
  getSanitizedEnv() {
    return this.claudeRunner.getSanitizedEnv();
  }

  /**
   * Execute a job using Claude CLI
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} Execution result
   */
  async execute(job, onProgress) {
    const startTime = Date.now();

    // Store job ID for event emission and reset event detector state
    this.currentJobId = job.id;
    this.eventDetector.reset();

    // Set job ID in ClaudeRunner for event emission
    this.claudeRunner.setJobId(job.id);

    // Display human-friendly job description
    const jobDescription = job.job_type === 'prd_generation'
      ? `${job.prd_mode === 'plan' ? 'plan' : 'PRD'} generation`
      : job.job_type;

    logger.info(`Executing ${jobDescription} job #${job.id}`);

    // Route to appropriate handler based on job type
    if (job.job_type === 'prd_generation') {
      return await this.executePrdGeneration(job, onProgress, startTime);
    } else if (job.job_type === 'code_execution') {
      return await this.executeCodeImplementation(job, onProgress, startTime);
    } else {
      throw new Error(`Unknown job type: ${job.job_type}`);
    }
  }


  /**
   * Execute PRD/Plan generation using Claude
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executePrdGeneration(job, onProgress, startTime) {
    // Determine content type from prd_mode field
    const contentType = job.prd_mode === 'plan' ? 'Plan' : 'PRD';
    logger.info(`Generating ${contentType} for: ${job.task_title}`);

    // Delegate to PrdGenerationHandler based on mode
    if (job.prd_mode === 'plan') {
      return await this.prdGenerationHandler.executePlanGeneration(job, onProgress, startTime);
    } else {
      return await this.prdGenerationHandler.executeStandardPrd(job, onProgress, startTime);
    }
  }


  /**
   * Execute code implementation using Claude
   * Delegates to CodeExecutionHandler
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executeCodeImplementation(job, onProgress, startTime) {
    return await this.codeExecutionHandler.executeCodeImplementation(job, onProgress, startTime);
  }



  /**
   * Kill the current running process if any
   * Used during shutdown to prevent orphaned processes
   * @returns {Promise<void>} Resolves when process is killed or grace period expires
   */
  async killCurrentProcess() {
    if (this.currentProcess && !this.currentProcess.killed) {
      logger.warn('Killing current Claude process due to shutdown');
      try {
        this.currentProcess.kill('SIGTERM');

        // Wait for grace period, then force kill if still alive
        await new Promise((resolve) => {
          setTimeout(() => {
            // Re-check this.currentProcess in case it was cleared during grace period
            if (this.currentProcess && !this.currentProcess.killed) {
              logger.warn('Force killing Claude process with SIGKILL');
              try {
                this.currentProcess.kill('SIGKILL');
              } catch (killError) {
                logger.error('Error force killing process', killError.message);
              }
            }
            resolve();
          }, PROCESS_KILL_GRACE_PERIOD_MS);
        });
      } catch (error) {
        logger.error('Error killing Claude process', error.message);
      }
    }
  }

  /**
   * Validate and sanitize file system path to prevent directory traversal attacks
   * @param {string} userPath - Path provided by user/API
   * @returns {string|null} Sanitized absolute path or null if invalid
   */
  validateAndSanitizePath(userPath) {
    if (!userPath || typeof userPath !== 'string') {
      logger.warn('Path is empty or not a string');
      return null;
    }

    try {
      // Resolve to absolute path and normalize (removes .., ., etc.)
      const resolvedPath = path.resolve(userPath);

      // Check for null bytes (path traversal attack vector)
      if (resolvedPath.includes('\0')) {
        logger.error('Path contains null bytes (potential attack)');
        return null;
      }

      // Comprehensive blacklist of protected system directories
      const dangerousPaths = [
        '/etc', '/bin', '/sbin', '/usr/bin', '/usr/sbin',  // Core system dirs
        '/System', '/Library', '/private',                   // macOS system dirs
        '/Windows', '/Program Files', '/Program Files (x86)', // Windows system dirs
        '/root', '/boot', '/dev', '/proc', '/sys'            // Linux/Unix system dirs
      ];

      for (const dangerousPath of dangerousPaths) {
        if (resolvedPath === dangerousPath || resolvedPath.startsWith(dangerousPath + '/')) {
          logger.error(`Path points to protected system directory: ${resolvedPath}`);
          return null;
        }
      }

      // Block access to sensitive subdirectories even within user directories
      const sensitiveSubdirectories = [
        '.ssh',                    // SSH keys
        '.aws',                    // AWS credentials
        '.config/gcloud',          // Google Cloud credentials
        '.azure',                  // Azure credentials
        '.kube',                   // Kubernetes configs
        '.docker',                 // Docker credentials
        '.gnupg',                  // GPG keys
        'Library/Keychains',       // macOS keychains
        'AppData/Roaming',         // Windows credential storage
        '.password-store',         // pass password manager
        '.config/1Password',       // 1Password
        '.config/Bitwarden'        // Bitwarden
      ];

      for (const sensitiveDir of sensitiveSubdirectories) {
        const normalizedDir = sensitiveDir.replace(/\//g, path.sep);
        if (resolvedPath.includes(path.sep + normalizedDir + path.sep) ||
            resolvedPath.endsWith(path.sep + normalizedDir)) {
          logger.error(`Path contains sensitive directory: ${sensitiveDir}`);
          return null;
        }
      }

      // Check if path is within allowed base paths (if configured)
      const allowedBasePaths = process.env.RALPH_ALLOWED_PATHS
        ? process.env.RALPH_ALLOWED_PATHS.split(':')
        : null;

      if (allowedBasePaths && allowedBasePaths.length > 0) {
        const isAllowed = allowedBasePaths.some(basePath => {
          const resolvedBase = path.resolve(basePath);
          return resolvedPath === resolvedBase || resolvedPath.startsWith(resolvedBase + path.sep);
        });

        if (!isAllowed) {
          logger.error(`Path is outside allowed base paths: ${resolvedPath}`);
          return null;
        }
      } else {
        // If no whitelist is configured, warn if path is outside typical user directories
        const isUserPath = resolvedPath.startsWith('/Users/') ||    // macOS
                          resolvedPath.startsWith('/home/') ||      // Linux
                          /^[A-Z]:\\Users\\/i.test(resolvedPath);   // Windows

        if (!isUserPath) {
          logger.warn(`Path is outside typical user directories: ${resolvedPath}`);
          // Don't reject, just warn - some valid projects might be elsewhere
        }
      }

      logger.debug(`Path sanitized: ${userPath} -> ${resolvedPath}`);
      return resolvedPath;
    } catch (error) {
      logger.error('Error sanitizing path', error.message);
      return null;
    }
  }
}

module.exports = Executor;
