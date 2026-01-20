const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Timing constants
const PROCESS_KILL_GRACE_PERIOD_MS = 2000;

class Executor {
  constructor() {
    this.currentProcess = null; // Track current spawned process for cleanup
  }

  /**
   * Execute a job using Claude CLI
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} Execution result
   */
  async execute(job, onProgress) {
    const startTime = Date.now();

    logger.info(`Executing ${job.job_type} job #${job.id}`);

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
   * Validate prompt to prevent injection attacks
   * @param {string} prompt - Prompt to validate
   * @throws {Error} If prompt contains dangerous content
   */
  validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }

    // Check prompt length (prevent DoS via massive prompts)
    const MAX_PROMPT_LENGTH = 500000; // 500KB
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`);
    }

    // Check for dangerous patterns that could lead to malicious operations
    const dangerousPatterns = [
      { pattern: /rm\s+-rf\s+\//, description: 'dangerous deletion command' },
      { pattern: /rm\s+-rf\s+~/, description: 'dangerous home directory deletion' },
      { pattern: /\/etc\/passwd/, description: 'system file access' },
      { pattern: /\/etc\/shadow/, description: 'password file access' },
      { pattern: /curl.*\|\s*sh/, description: 'remote code execution pattern' },
      { pattern: /wget.*\|\s*sh/, description: 'remote code execution pattern' },
      { pattern: /eval\s*\(/, description: 'code evaluation' },
      { pattern: /exec\s*\(/, description: 'code execution' },
      { pattern: /\$\(.*rm.*-rf/, description: 'command injection with deletion' },
      { pattern: /`.*rm.*-rf/, description: 'command injection with deletion' },
      { pattern: /base64.*decode.*eval/, description: 'obfuscated code execution' },
      { pattern: /\.ssh\/id_rsa/, description: 'SSH key access' },
      { pattern: /\.aws\/credentials/, description: 'AWS credentials access' }
    ];

    for (const { pattern, description } of dangerousPatterns) {
      if (pattern.test(prompt)) {
        logger.error(`Prompt validation failed: contains ${description}`);
        throw new Error(`Prompt contains potentially dangerous content: ${description}`);
      }
    }

    // Log sanitized version for security audit
    const sanitizedPreview = prompt.substring(0, 200).replace(/\n/g, ' ');
    logger.debug(`Prompt validated (${prompt.length} chars): ${sanitizedPreview}...`);

    return true;
  }

  /**
   * Execute PRD generation using Claude /prd skill
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executePrdGeneration(job, onProgress, startTime) {
    logger.info(`Generating PRD for: ${job.task_title}`);

    // Server must provide prompt
    if (!job.prompt || !job.prompt.trim()) {
      throw new Error('No prompt provided by server');
    }

    const prompt = job.prompt;
    logger.debug('Using server-provided prompt');

    // Validate prompt for security
    this.validatePrompt(prompt);

    try {
      // Determine and sanitize working directory
      let workingDir = process.cwd();
      if (job.project?.system_path) {
        const sanitizedPath = this.validateAndSanitizePath(job.project.system_path);
        if (sanitizedPath && fs.existsSync(sanitizedPath)) {
          workingDir = sanitizedPath;
        } else {
          logger.warn(`Invalid or missing project path, using current directory: ${process.cwd()}`);
        }
      }

      // Use Claude /prd skill
      const output = await this.runClaudeSkill('prd', prompt, workingDir, onProgress);

      const executionTimeMs = Date.now() - startTime;

      return {
        output: output,
        prdContent: output.trim(), // The PRD content is the output
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      logger.error(`PRD generation failed for job #${job.id}`, error.message);
      throw error;
    }
  }

  /**
   * Execute code implementation using Claude
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executeCodeImplementation(job, onProgress, startTime) {
    logger.info(`Implementing code in ${job.project.system_path}`);

    // Validate and sanitize project path
    const sanitizedPath = this.validateAndSanitizePath(job.project.system_path);
    if (!sanitizedPath) {
      throw new Error(`Invalid or unsafe project path: ${job.project.system_path}`);
    }

    // Validate project path exists
    if (!fs.existsSync(sanitizedPath)) {
      throw new Error(`Project path does not exist: ${sanitizedPath}`);
    }

    // Server must provide prompt
    if (!job.prompt || !job.prompt.trim()) {
      throw new Error('No prompt provided by server');
    }

    const prompt = job.prompt;
    logger.debug('Using server-provided prompt');

    // Validate prompt for security
    this.validatePrompt(prompt);

    try {
      // Execute claude --print with the prompt
      const output = await this.runClaude(prompt, sanitizedPath, onProgress);

      // Parse output for summary and branch name
      const result = this.parseOutput(output);

      const executionTimeMs = Date.now() - startTime;

      return {
        output: output,
        summary: result.summary || `Completed task: ${job.task_title}`,
        branchName: result.branchName,
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      logger.error(`Code implementation failed for job #${job.id}`, error.message);
      throw error;
    }
  }

  /**
   * Categorize error for user-friendly messaging
   * @param {Error} error - The error object
   * @param {string} stderr - Standard error output
   * @param {number} exitCode - Process exit code
   * @returns {Object} Object with category, userMessage, and technicalDetails
   */
  categorizeError(error, stderr = '', exitCode = null) {
    let category = 'unknown';
    let userMessage = error.message || String(error);
    let technicalDetails = `Error: ${error.message}\nStderr: ${stderr}\nExit Code: ${exitCode}`;

    // Check for Claude CLI not installed
    if (error.code === 'ENOENT') {
      category = 'claude_not_installed';
      userMessage = 'Claude Code CLI is not installed or not found in PATH';
    }
    // Check for authentication issues
    else if (stderr.match(/not authenticated/i) || stderr.match(/authentication failed/i) || stderr.match(/please log in/i)) {
      category = 'not_authenticated';
      userMessage = 'Claude CLI is not authenticated. Please run "claude auth"';
    }
    // Check for token limit exceeded
    else if (stderr.match(/token limit exceeded/i) || stderr.match(/quota exceeded/i) || stderr.match(/insufficient credits/i)) {
      category = 'out_of_tokens';
      userMessage = 'Claude API token limit has been exceeded';
    }
    // Check for rate limiting
    else if (stderr.match(/rate limit/i) || stderr.match(/too many requests/i) || stderr.match(/429/)) {
      category = 'rate_limited';
      userMessage = 'Claude API rate limit reached. Please wait before retrying';
    }
    // Check for permission denied
    else if (stderr.match(/permission denied/i) || stderr.match(/EACCES/i) || error.code === 'EACCES') {
      category = 'permission_denied';
      userMessage = 'Permission denied accessing project files or directories';
    }
    // Check for timeout
    else if (error.message && error.message.includes('timed out')) {
      category = 'execution_timeout';
      userMessage = 'Job execution exceeded the maximum timeout';
    }
    // Check for network errors
    else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      category = 'network_error';
      userMessage = 'Network error connecting to Claude API';
    }
    // Check for non-zero exit code (execution error)
    else if (exitCode !== null && exitCode !== 0) {
      category = 'execution_error';
      userMessage = `Claude CLI execution failed with exit code ${exitCode}`;
    }

    logger.debug(`Error categorized as: ${category}`);

    return {
      category,
      userMessage,
      technicalDetails
    };
  }

  /**
   * Get sanitized environment variables for Claude execution
   * @returns {Object} Sanitized environment object
   */
  getSanitizedEnv() {
    const safeEnv = {};

    // Only copy necessary environment variables
    const allowedVars = [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'LC_ALL',
      'TERM',
      'TMPDIR',
      'SHELL'
    ];

    for (const key of allowedVars) {
      if (process.env[key]) {
        safeEnv[key] = process.env[key];
      }
    }

    logger.debug(`Sanitized environment: ${Object.keys(safeEnv).join(', ')}`);
    return safeEnv;
  }

  /**
   * Run Claude CLI skill (e.g., /prd)
   * @param {string} skill - Skill name (without /)
   * @param {string} prompt - Input for the skill
   * @param {string} cwd - Working directory
   * @param {Function} onProgress - Progress callback
   * @param {number} timeout - Timeout in milliseconds (default: 1 hour)
   * @returns {Promise<string>} Command output
   */
  runClaudeSkill(skill, prompt, cwd, onProgress, timeout = 3600000) {
    return new Promise((resolve, reject) => {
      logger.debug(`Running Claude skill: /${skill} with timeout: ${timeout}ms`);

      const claude = spawn('claude', [`/${skill}`], {
        cwd: cwd,
        shell: false,  // FIXED: Don't use shell
        env: this.getSanitizedEnv()
      });

      // Set timeout
      const timer = setTimeout(() => {
        logger.error(`Claude skill /${skill} timed out after ${timeout}ms`);
        claude.kill('SIGTERM');
        reject(new Error(`Claude skill /${skill} execution timed out after ${timeout}ms`));
      }, timeout);

      // Track process for shutdown cleanup
      this.currentProcess = claude;

      // Send prompt to stdin
      claude.stdin.write(prompt);
      claude.stdin.end();

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        if (onProgress) {
          onProgress(chunk);
        }
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
        logger.warn('Claude stderr:', data.toString());
      });

      claude.on('close', (code) => {
        clearTimeout(timer); // Clear timeout
        this.currentProcess = null; // Clear process reference
        if (code === 0) {
          logger.debug(`Claude skill /${skill} completed successfully`);
          resolve(stdout);
        } else {
          logger.error(`Claude skill /${skill} exited with code ${code}`);
          const baseError = new Error(`Claude skill /${skill} failed with exit code ${code}: ${stderr}`);
          const errorInfo = this.categorizeError(baseError, stderr, code);

          // Attach categorization to error object
          const enrichedError = new Error(errorInfo.userMessage);
          enrichedError.category = errorInfo.category;
          enrichedError.technicalDetails = errorInfo.technicalDetails;
          enrichedError.partialOutput = stdout; // Include any partial output

          reject(enrichedError);
        }
      });

      claude.on('error', (error) => {
        clearTimeout(timer); // Clear timeout
        this.currentProcess = null; // Clear process reference
        logger.error(`Failed to spawn Claude skill /${skill}`, error.message);

        const errorInfo = this.categorizeError(error, stderr, null);

        // Attach categorization to error object
        const enrichedError = new Error(errorInfo.userMessage);
        enrichedError.category = errorInfo.category;
        enrichedError.technicalDetails = errorInfo.technicalDetails;
        enrichedError.partialOutput = stdout; // Include any partial output

        reject(enrichedError);
      });
    });
  }

  /**
   * Run Claude CLI with the given prompt
   * @param {string} prompt - Prompt text
   * @param {string} cwd - Working directory
   * @param {Function} onProgress - Progress callback
   * @param {number} timeout - Timeout in milliseconds (default: 2 hours for code execution)
   * @returns {Promise<string>} Command output
   */
  runClaude(prompt, cwd, onProgress, timeout = 7200000) {
    return new Promise((resolve, reject) => {
      logger.debug(`Starting Claude CLI execution with timeout: ${timeout}ms`);

      // Use stdin to pass prompt - avoids shell injection
      const claude = spawn('claude', [], {
        cwd: cwd,
        shell: false,  // FIXED: Don't use shell
        env: this.getSanitizedEnv()
      });

      // Set timeout
      const timer = setTimeout(() => {
        logger.error(`Claude CLI timed out after ${timeout}ms`);
        claude.kill('SIGTERM');
        reject(new Error(`Claude CLI execution timed out after ${timeout}ms`));
      }, timeout);

      // Track process for shutdown cleanup
      this.currentProcess = claude;

      // Send prompt via stdin (safe from injection)
      claude.stdin.write(prompt);
      claude.stdin.end();

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Send progress updates
        if (onProgress) {
          onProgress(chunk);
        }
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
        logger.warn('Claude stderr:', data.toString());
      });

      claude.on('close', (code) => {
        clearTimeout(timer); // Clear timeout
        this.currentProcess = null; // Clear process reference
        if (code === 0) {
          logger.debug('Claude CLI execution completed successfully');
          resolve(stdout);
        } else {
          logger.error(`Claude CLI exited with code ${code}`);
          const baseError = new Error(`Claude CLI failed with exit code ${code}: ${stderr}`);
          const errorInfo = this.categorizeError(baseError, stderr, code);

          // Attach categorization to error object
          const enrichedError = new Error(errorInfo.userMessage);
          enrichedError.category = errorInfo.category;
          enrichedError.technicalDetails = errorInfo.technicalDetails;
          enrichedError.partialOutput = stdout; // Include any partial output

          reject(enrichedError);
        }
      });

      claude.on('error', (error) => {
        clearTimeout(timer); // Clear timeout
        this.currentProcess = null; // Clear process reference
        logger.error('Failed to spawn Claude CLI', error.message);

        const errorInfo = this.categorizeError(error, stderr, null);

        // Attach categorization to error object
        const enrichedError = new Error(errorInfo.userMessage);
        enrichedError.category = errorInfo.category;
        enrichedError.technicalDetails = errorInfo.technicalDetails;
        enrichedError.partialOutput = stdout; // Include any partial output

        reject(enrichedError);
      });
    });
  }

  /**
   * Parse Claude output for summary and branch name
   * @param {string} output - Claude output
   * @returns {Object} Parsed result
   */
  parseOutput(output) {
    const result = {
      summary: null,
      branchName: null
    };

    // Look for RALPH_SUMMARY: marker
    const summaryMatch = output.match(/RALPH_SUMMARY:\s*(.+?)(?:\n|$)/);
    if (summaryMatch) {
      result.summary = summaryMatch[1].trim();
    }

    // Look for RALPH_BRANCH: marker
    const branchMatch = output.match(/RALPH_BRANCH:\s*(.+?)(?:\n|$)/);
    if (branchMatch) {
      result.branchName = branchMatch[1].trim();
    }

    return result;
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
