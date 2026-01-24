const { spawn } = require('child_process');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const WorktreeManager = require('./worktree-manager');
const { formatDuration } = require('./utils/format');

// Timing constants
const PROCESS_KILL_GRACE_PERIOD_MS = 2000;

class Executor {
  constructor(apiClient = null) {
    this.currentProcess = null; // Track current spawned process for cleanup
    this.apiClient = apiClient; // Optional API client for metadata updates
  }

  /**
   * Execute a job using Claude CLI
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} Execution result
   */
  async execute(job, onProgress) {
    const startTime = Date.now();

    // Store job ID for event emission
    this.currentJobId = job.id;

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

    // Route to appropriate generation method based on mode
    if (job.prd_mode === 'plan') {
      return await this.executePlanGeneration(job, onProgress, startTime);
    } else {
      return await this.executeStandardPrd(job, onProgress, startTime);
    }
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
    this.validatePrompt(prompt);
    logger.info('Prompt validation passed');

    try {
      // Determine and sanitize working directory
      logger.info('Determining working directory...');
      let workingDir = process.cwd();
      if (job.project?.system_path) {
        logger.info('Project path provided, validating...', { path: job.project.system_path });
        const sanitizedPath = this.validateAndSanitizePath(job.project.system_path);
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
      const output = await this.runClaude(prompt, workingDir, logAndProgress);
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
        executionTimeMs,
        executionTimeFormatted: formatDuration(executionTimeMs)
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
        const sanitizedPath = this.validateAndSanitizePath(job.project.system_path);
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
      const output = await this.runClaude(prompt, workingDir, logAndProgress);

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

  /**
   * Execute code implementation using Claude
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executeCodeImplementation(job, onProgress, startTime) {
    logger.info(`Implementing code in ${job.project.system_path}`);

    // Reset captured stderr for this job
    this.capturedStderr = '';

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

    // Use the server-provided prompt (already formatted with template system)
    const prompt = job.prompt;
    logger.debug('Using server-provided prompt');

    // Validate prompt for security
    this.validatePrompt(prompt);

    const worktreeManager = new WorktreeManager();
    let worktreePath = null;

    try {
      // Send event: Setup started
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'setup_started', 'Setting up workspace...');
        await this.apiClient.sendStatusEvent(job.id, 'progress_update', 'Initializing...', { percentage: 5 });
      }

      // Create worktree before execution
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'git_operations', 'Creating Git worktree...');
      }
      worktreePath = await worktreeManager.createWorktree(job);

      // Update job metadata with worktree path (best-effort)
      if (this.apiClient) {
        await this.apiClient.updateJobMetadata(job.id, { worktree_path: worktreePath });
        await this.apiClient.sendStatusEvent(job.id, 'git_operations', `Worktree ready at ${path.basename(worktreePath)}`);
        await this.apiClient.sendStatusEvent(job.id, 'progress_update', 'Workspace ready', { percentage: 10 });
      }

      // Send event: Claude starting
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'claude_started', 'Claude is analyzing and executing the task...');
        await this.apiClient.sendStatusEvent(job.id, 'progress_update', 'Claude started', { percentage: 15 });
      }

      // Run Claude directly in worktree with raw prompt
      const result = await this.runClaudeDirectly(worktreePath, prompt, job, onProgress);

      // Log git activity details and send to server
      const gitActivitySummary = await this.logGitActivity(worktreePath, result.branchName, job.id, onProgress);

      // Save execution output to persistent log file (survives cleanup)
      const logDir = path.join(sanitizedPath, '.ralph-logs');
      try {
        await fsPromises.mkdir(logDir, { recursive: true });
        const logFile = path.join(logDir, `job-${job.id}.log`);
        const logContent = `
═══════════════════════════════════════════════════════════
Job #${job.id} - ${job.task_title}
Started: ${new Date(startTime).toISOString()}
═══════════════════════════════════════════════════════════

${result.output}

═══════════════════════════════════════════════════════════
Execution completed at: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════
`;
        await fsPromises.writeFile(logFile, logContent);
        logger.info(`Execution log saved to: ${logFile}`);

        // Save stderr to separate error log if it exists
        const stderrContent = this.capturedStderr || '';
        if (stderrContent.trim()) {
          const errorLogFile = path.join(logDir, `job-${job.id}-stderr.log`);
          await fsPromises.writeFile(errorLogFile, stderrContent);
          logger.info(`Error output saved to: ${errorLogFile}`);
        }
      } catch (logError) {
        logger.warn(`Failed to save execution log: ${logError.message}`);
      }

      const executionTimeMs = Date.now() - startTime;

      // Send completion events
      if (this.apiClient) {
        await this.apiClient.sendStatusEvent(job.id, 'progress_update', 'Finalizing...', { percentage: 95 });
        await this.apiClient.sendStatusEvent(job.id, 'job_completed', 'Task completed successfully');
        await this.apiClient.sendStatusEvent(job.id, 'progress_update', 'Complete', { percentage: 100 });
      }

      return {
        output: result.output,
        summary: `Completed task: ${job.task_title}`,
        branchName: result.branchName,
        executionTimeMs: executionTimeMs,
        gitActivity: {
          commitCount: gitActivitySummary.commitCount,
          lastCommit: gitActivitySummary.lastCommitInfo,
          changes: gitActivitySummary.changeStats,
          pushedToRemote: gitActivitySummary.wasPushed,
          hasUncommittedChanges: gitActivitySummary.hasUncommittedChanges
        }
      };
    } catch (error) {
      logger.error(`Code implementation failed for job #${job.id}: ${error.message}`);

      // Save error details to log file
      const logDir = path.join(job.project.system_path, '.ralph-logs');
      try {
        await fsPromises.mkdir(logDir, { recursive: true });
        const errorLogFile = path.join(logDir, `job-${job.id}-error.log`);
        const errorContent = `
═══════════════════════════════════════════════════════════
Job #${job.id} - FAILED
Error Time: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════

Error Message: ${error.message}

Error Category: ${error.category || 'unknown'}

Technical Details:
${error.technicalDetails || error.stack || 'No additional details'}

Partial Output:
${error.partialOutput || 'No output captured'}

Captured Stderr:
${this.capturedStderr || 'No stderr captured'}

═══════════════════════════════════════════════════════════
`;
        await fsPromises.writeFile(errorLogFile, errorContent);
        logger.info(`Error details saved to: ${errorLogFile}`);
      } catch (logError) {
        logger.warn(`Failed to save error log: ${logError.message}`);
      }

      throw error;
    } finally {
      // Cleanup worktree if auto-cleanup enabled (default: true)
      if (worktreePath && job.project.auto_cleanup_worktrees !== false) {
        logger.info('Auto-cleanup enabled, removing worktree');
        await worktreeManager.removeWorktree(job).catch(err =>
          logger.error(`Cleanup failed: ${err.message}`)
        );
      } else if (worktreePath) {
        logger.info(`Auto-cleanup disabled, keeping worktree: ${worktreePath}`);
        logger.info(`Branch: ${worktreeManager.getBranchName(job)}`);
      }
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

    // Explicitly allowed environment variables
    const allowedVars = [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'LC_ALL',
      'TERM',
      'TMPDIR',
      'SHELL',
      'NODE_ENV'  // Add NODE_ENV for Claude
    ];

    // Explicitly blocked patterns (even if they match allowed vars)
    const blockedPatterns = [
      /^RALPH_API_TOKEN$/i,
      /^.*_TOKEN$/i,
      /^.*_SECRET$/i,
      /^.*_KEY$/i,
      /^.*_PASSWORD$/i,
      /^AWS_/i,
      /^AZURE_/i,
      /^GCP_/i,
      /^GOOGLE_/i
    ];

    for (const key of allowedVars) {
      if (process.env[key]) {
        // Double-check not in blocklist
        const isBlocked = blockedPatterns.some(pattern => pattern.test(key));
        if (!isBlocked) {
          safeEnv[key] = process.env[key];
        }
      }
    }

    // Don't log HOME to avoid exposing username in logs
    const safeToLog = Object.keys(safeEnv).filter(k => k !== 'HOME');
    logger.debug(`Sanitized environment: ${safeToLog.join(', ')}`);
    return safeEnv;
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
      const timeoutFormatted = formatDuration(timeout);
      logger.info(`Starting Claude CLI execution`, {
        timeout: timeoutFormatted,
        workingDirectory: cwd,
        promptLength: prompt.length
      });

      // Use stdin to pass prompt - avoids shell injection
      // Use --output-format stream-json --verbose to get structured streaming output
      logger.info('Spawning Claude CLI process with --output-format stream-json --verbose');
      const claude = spawn('claude', ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'], {
        cwd: cwd,
        shell: false,
        env: this.getSanitizedEnv()
      });

      logger.info('Claude CLI process spawned, writing prompt to stdin...');

      // Set timeout
      const timer = setTimeout(() => {
        logger.error(`Claude CLI timed out after ${timeout}ms (${timeoutFormatted})`);
        claude.kill('SIGTERM');
        reject(new Error(`Claude CLI execution timed out after ${timeout}ms`));
      }, timeout);

      // Track process for shutdown cleanup
      this.currentProcess = claude;

      // Send prompt via stdin (safe from injection)
      try {
        claude.stdin.write(prompt);
        claude.stdin.end();
        logger.info('Prompt successfully written to Claude CLI stdin');
      } catch (err) {
        logger.error('Failed to write prompt to Claude CLI stdin', { error: err.message });
        clearTimeout(timer);
        reject(new Error(`Failed to write prompt to Claude: ${err.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let finalResult = '';
      let lineBuffer = '';

      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        lineBuffer += chunk;

        // Process complete JSON lines
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const event = JSON.parse(line);
            this.logClaudeEvent(event);
            
            // Extract final result text
            if (event.type === 'result' && event.result) {
              finalResult = event.result;
            }
            
            // Detect and emit events
            this.detectAndEmitEvents(line);
            
            // Send progress updates
            if (onProgress) {
              onProgress(line + '\n');
            }
          } catch (e) {
            // Not valid JSON, log raw
            logger.debug(`Non-JSON output: ${line}`);
          }
        }
      });

      claude.stderr.on('data', (data) => {
        const stderrChunk = data.toString();
        stderr += stderrChunk;
        
        // Log stderr but don't treat as JSON
        process.stderr.write(stderrChunk);
      });

      claude.on('close', (code) => {
        clearTimeout(timer); // Clear timeout
        this.currentProcess = null; // Clear process reference

        // Process any remaining buffered content
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer);
            this.logClaudeEvent(event);
            if (event.type === 'result' && event.result) {
              finalResult = event.result;
            }
          } catch (e) {
            // Ignore incomplete JSON
          }
        }

        logger.info(`Claude CLI process exited`, {
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        });

        if (code === 0) {
          logger.info('Claude CLI execution completed successfully');
          // Return the extracted result text, falling back to raw stdout
          resolve(finalResult || stdout);
        } else {
          logger.error(`Claude CLI exited with non-zero code ${code}`);
          logger.error('Last 1000 chars of stderr:', stderr.slice(-1000));

          const baseError = new Error(`Claude CLI failed with exit code ${code}: ${stderr}`);
          const errorInfo = this.categorizeError(baseError, stderr, code);

          logger.error('Error categorization:', {
            category: errorInfo.category,
            userMessage: errorInfo.userMessage
          });

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
        logger.error('Failed to spawn Claude CLI process', {
          error: error.message,
          code: error.code,
          errno: error.errno,
          syscall: error.syscall
        });

        const errorInfo = this.categorizeError(error, stderr, null);

        logger.error('Spawn error categorization:', {
          category: errorInfo.category,
          userMessage: errorInfo.userMessage
        });

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
   * Run Claude Code directly in worktree with raw prompt
   * @param {string} worktreePath - Path to worktree
   * @param {string} prompt - Raw PRD/task description (from job.prompt)
   * @param {Object} job - Job object for progress updates
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<{output: string, branchName: string, duration: number}>}
   */
  async runClaudeDirectly(worktreePath, prompt, job, onProgress) {
    const startTime = Date.now();
    const timeout = 7200000; // 2 hours (same as current runClaude)

    logger.info(`Running Claude Code in worktree: ${worktreePath}`, {
      timeout: formatDuration(timeout),
      workingDirectory: worktreePath,
      promptLength: prompt.length
    });

    // Send to API/UI
    if (this.apiClient && this.apiClient.sendProgress) {
      this.apiClient.sendProgress(job.id, `Running Claude Code in worktree: ${path.basename(worktreePath)}\n`)
        .catch(err => logger.warn(`Failed to send progress to API: ${err.message}`));
    }

    logger.event('claude_started', {
      component: 'executor',
      operation: 'claude_direct',
      worktreePath
    });

    // Spawn Claude with streaming JSON output for visibility
    logger.info('Spawning Claude CLI process with --output-format stream-json --verbose');

    // Send to API/UI
    if (this.apiClient && this.apiClient.sendProgress) {
      this.apiClient.sendProgress(job.id, 'Spawning Claude CLI process with --output-format stream-json --verbose\n')
        .catch(err => logger.warn(`Failed to send progress to API: ${err.message}`));
    }

    const claudeProcess = spawn('claude', ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'], {
      cwd: worktreePath,
      shell: false,
      env: this.getSanitizedEnv()
    });

    // Set timeout (same as current runClaude)
    const timer = setTimeout(() => {
      logger.error(`Claude CLI timed out after ${timeout}ms`);
      claudeProcess.kill('SIGTERM');
    }, timeout);

    // Track process for shutdown cleanup
    this.currentProcess = claudeProcess;

    // Send prompt via stdin (safe from injection)
    try {
      claudeProcess.stdin.write(prompt);
      claudeProcess.stdin.end();
      logger.info('Prompt successfully written to Claude CLI stdin');

      // Send to API/UI
      if (this.apiClient && this.apiClient.sendProgress) {
        this.apiClient.sendProgress(job.id, 'Prompt successfully written to Claude CLI stdin\n')
          .catch(err => logger.warn(`Failed to send progress to API: ${err.message}`));
      }
    } catch (err) {
      logger.error('Failed to write prompt to Claude CLI stdin', { error: err.message });
      clearTimeout(timer);
      throw new Error(`Failed to write prompt to Claude: ${err.message}`);
    }

    let output = '';
    let errorOutput = '';
    let finalResult = '';
    let lineBuffer = '';

    return new Promise((resolve, reject) => {
      // Capture stdout and parse JSON events
      claudeProcess.stdout.on('data', async (data) => {
        const chunk = data.toString();
        output += chunk;
        lineBuffer += chunk;

        // Process complete JSON lines
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const event = JSON.parse(line);
            this.logClaudeEvent(event);
            
            // Extract final result text
            if (event.type === 'result' && event.result) {
              finalResult = event.result;
            }
            
            // Detect and emit events
            this.detectAndEmitEvents(line);
            
            // Stream progress to API in real-time
            if (this.apiClient) {
              try {
                await this.apiClient.sendProgress(job.id, line + '\n', {
                  component: 'claude',
                  operation: 'execution'
                });
              } catch (err) {
                logger.warn(`Failed to send progress to API: ${err.message}`);
              }
            }
            
            // Call onProgress callback (for backwards compatibility)
            if (onProgress) {
              onProgress(line + '\n');
            }
          } catch (e) {
            // Not valid JSON, log raw
            logger.debug(`Non-JSON output: ${line}`);
          }
        }
      });

      // Capture stderr
      claudeProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        // Save to instance variable for log file
        this.capturedStderr = (this.capturedStderr || '') + chunk;

        // Log stderr but don't treat as JSON
        process.stderr.write(chunk);
      });

      // Wait for completion
      claudeProcess.on('close', async (code) => {
        clearTimeout(timer);
        this.currentProcess = null;
        const duration = Date.now() - startTime;

        // Process any remaining buffered content
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer);
            this.logClaudeEvent(event);
            if (event.type === 'result' && event.result) {
              finalResult = event.result;
            }
          } catch (e) {
            // Ignore incomplete JSON
          }
        }

        if (code === 0) {
          logger.info(`Claude completed successfully in ${formatDuration(duration)}`);

          // Get branch name from worktree
          const branchName = await this.getCurrentBranch(worktreePath);

          resolve({
            output: finalResult || output,
            branchName,
            duration
          });
        } else {
          logger.error(`Claude failed with code ${code}`);

          // Use existing error categorization
          const baseError = new Error(`Claude CLI failed with exit code ${code}: ${errorOutput}`);
          const errorInfo = this.categorizeError(baseError, errorOutput, code);

          // Create enriched error (same pattern as existing runClaude)
          const enrichedError = new Error(errorInfo.userMessage);
          enrichedError.category = errorInfo.category;
          enrichedError.technicalDetails = errorInfo.technicalDetails;
          enrichedError.partialOutput = output;

          reject(enrichedError);
        }
      });

      claudeProcess.on('error', (err) => {
        clearTimeout(timer);
        this.currentProcess = null;
        logger.error(`Failed to spawn Claude CLI: ${err.message}`);

        // Use existing error categorization
        const errorInfo = this.categorizeError(err, errorOutput, null);

        const enrichedError = new Error(errorInfo.userMessage);
        enrichedError.category = errorInfo.category;
        enrichedError.technicalDetails = errorInfo.technicalDetails;
        enrichedError.partialOutput = output;

        reject(enrichedError);
      });
    });
  }

  /**
   * Helper to run git commands in worktree
   * @param {string} cwd - Working directory
   * @param {Array<string>} args - Git command arguments
   * @returns {Promise<string>} Command output
   */
  async runGitCommand(cwd, args) {
    return new Promise((resolve, reject) => {
      const git = spawn('git', args, { cwd });
      let output = '';

      git.stdout.on('data', (data) => {
        output += data.toString();
      });

      git.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Git command failed with code ${code}`));
        }
      });

      git.on('error', reject);
    });
  }

  /**
   * Get current branch name from worktree
   * @param {string} worktreePath - Path to worktree
   * @returns {Promise<string>} Branch name
   */
  async getCurrentBranch(worktreePath) {
    try {
      const branch = await this.runGitCommand(
        worktreePath,
        ['rev-parse', '--abbrev-ref', 'HEAD']
      );
      return branch.trim();
    } catch (err) {
      logger.error(`Failed to get branch name: ${err.message}`);
      return 'unknown';
    }
  }

  /**
   * Log Claude stream-json events to the terminal in a human-readable format
   * @param {Object} event - Parsed JSON event from Claude CLI
   */
  logClaudeEvent(event) {
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          logger.info(`🚀 Claude session started (model: ${event.model})`);
        }
        break;
        
      case 'assistant':
        if (event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === 'text' && content.text) {
              // Log assistant text output
              logger.info(`💬 ${content.text}`);
            } else if (content.type === 'tool_use') {
              // Log tool invocation
              const toolName = content.name;
              const input = content.input || {};
              let inputSummary = '';
              
              // Summarize common tool inputs
              if (input.file_path || input.path) {
                inputSummary = ` → ${path.basename(input.file_path || input.path)}`;
              } else if (input.command) {
                const cmd = input.command.substring(0, 60);
                inputSummary = ` → ${cmd}${input.command.length > 60 ? '...' : ''}`;
              } else if (input.pattern) {
                inputSummary = ` → "${input.pattern}"`;
              }

              logger.info(`🔧 ${toolName}${inputSummary}`);
            }
          }
        }
        break;
        
      case 'user':
        // Tool results - show brief confirmation
        if (event.tool_use_result) {
          const result = event.tool_use_result;
          if (result.file) {
            logger.debug(`Read ${result.file.numLines} lines from ${path.basename(result.file.filePath)}`);
          } else if (result.type === 'text' && result.output) {
            const lines = result.output.split('\n').length;
            logger.debug(`Result: ${lines} lines`);
          }
        }
        break;
        
      case 'result':
        if (event.subtype === 'success') {
          logger.info(`✅ Completed in ${formatDuration(event.duration_ms)} (${event.num_turns} turns, $${event.total_cost_usd?.toFixed(4) || '0.00'})`);
        } else if (event.is_error) {
          logger.error(`❌ Failed: ${event.error || 'Unknown error'}`);
        }
        break;
    }
  }

  /**
   * Detect and emit structured events from Claude output
   * Analyzes output chunks for common patterns and sends status events to UI
   * @param {string} chunk - Output chunk from Claude
   */
  detectAndEmitEvents(chunk) {
    if (!this.apiClient || !this.currentJobId) return;

    try {
      // Detect Claude Code tool usage (Read, Write, Edit, Bash, etc.)
      const toolPatterns = [
        { pattern: /Reading\s+([^\s\n]+)/i, type: 'read_file', getMessage: (m) => `Reading ${path.basename(m[1])}` },
        { pattern: /Writing\s+to\s+([^\s\n]+)/i, type: 'write_file', getMessage: (m) => `Writing ${path.basename(m[1])}` },
        { pattern: /Editing\s+([^\s\n]+)/i, type: 'edit_file', getMessage: (m) => `Editing ${path.basename(m[1])}` },
        { pattern: /Searching\s+for\s+['"](.*?)['"]/i, type: 'search', getMessage: (m) => `Searching for "${m[1]}"` },
        { pattern: /Executing:\s*(.+?)(?:\n|$)/i, type: 'bash_command', getMessage: (m) => `Running: ${m[1].substring(0, 50)}${m[1].length > 50 ? '...' : ''}` },
        { pattern: /(?:Running|Executing)\s+bash:\s*(.+?)(?:\n|$)/i, type: 'bash_command', getMessage: (m) => `Running: ${m[1].substring(0, 50)}${m[1].length > 50 ? '...' : ''}` }
      ];

      for (const { pattern, type, getMessage } of toolPatterns) {
        const match = chunk.match(pattern);
        if (match) {
          const message = getMessage(match);
          const filename = match[1] ? match[1].replace(/[`'"]/g, '').trim() : null;

          // Skip files with ellipsis (truncated paths)
          if (filename && filename.includes('...')) {
            return;
          }

          logger.debug(`Detected ${type}: ${message}`);
          this.apiClient.sendStatusEvent(
            this.currentJobId,
            type,
            message,
            filename ? { filename } : {}
          ).catch(error => {
            logger.debug(`Event emission error: ${error.message}`);
          });
          return; // Only emit one event per chunk
        }
      }

      // Detect file modifications (more comprehensive patterns)
      const filePatterns = [
        /(?:Writing to|Created file|Modified file|Editing)\s+([^\s\n]+)/i,
        /(?:Successfully (?:created|modified|updated))\s+([^\s\n]+)/i,
        /File\s+([^\s\n]+)\s+(?:created|modified|updated)/i,
        /(?:Created|Updated|Modified):\s+([^\s\n]+)/i
      ];

      for (const pattern of filePatterns) {
        const match = chunk.match(pattern);
        if (match && match[1]) {
          const filename = match[1].replace(/[`'"]/g, '').trim();
          if (filename && !filename.includes('...')) {
            logger.debug(`File modified: ${filename}`);
            this.apiClient.sendStatusEvent(
              this.currentJobId,
              'file_modified',
              `Modified: ${path.basename(filename)}`,
              { filename: filename }
            ).catch(error => {
              logger.debug(`Event emission error: ${error.message}`);
            });
            return;
          }
        }
      }

      // Detect git operations
      if (/git commit|committed changes|Created commit|Committing changes/i.test(chunk)) {
        logger.debug('Git commit detected');
        this.apiClient.sendStatusEvent(
          this.currentJobId,
          'git_commit',
          'Committing changes...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }

      if (/git add|Staging changes|Adding files/i.test(chunk)) {
        logger.debug('Git add detected');
        this.apiClient.sendStatusEvent(
          this.currentJobId,
          'git_add',
          'Staging changes...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }

      // Detect test execution
      if (/Running tests|running test|bin\/rails test|npm test|pytest|rspec|jest/i.test(chunk)) {
        logger.debug('Test execution detected');
        this.apiClient.sendStatusEvent(
          this.currentJobId,
          'tests_running',
          'Running tests...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }

      // Detect planning/thinking
      if (/(?:Planning|Thinking|Analyzing|Considering)/i.test(chunk)) {
        // Only log planning once per job to avoid spam
        if (!this.planningDetected) {
          this.planningDetected = true;
          logger.debug('Planning phase detected');
          this.apiClient.sendStatusEvent(
            this.currentJobId,
            'planning',
            'Analyzing codebase and planning changes...'
          ).catch(error => {
            logger.debug(`Event emission error: ${error.message}`);
          });
        }
        return;
      }

      // Detect cleanup phase
      if (/cleanup|cleaning up|removing temporary/i.test(chunk)) {
        logger.debug('Cleanup phase detected');
        this.apiClient.sendStatusEvent(
          this.currentJobId,
          'cleanup_started',
          'Cleaning up...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }
    } catch (error) {
      // Silently ignore event emission errors to avoid disrupting execution
      logger.debug(`Event detection error: ${error.message}`);
    }
  }



  /**
   * Log git activity details for a job
   * @param {string} worktreePath - Path to the worktree
   * @param {string} branchName - Name of the branch
   * @param {number} jobId - Job ID
   * @param {Function} onProgress - Optional progress callback to send updates to server
   * @returns {Promise<Object>} Git activity summary object
   */
  async logGitActivity(worktreePath, branchName, jobId, onProgress = null) {
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      logger.warn(`Worktree not found for git activity logging: ${worktreePath}`);
      return;
    }

    try {
      const { spawn } = require('child_process');

      // Get commit count on this branch (new commits only, not in origin/main)
      const commitCount = await new Promise((resolve) => {
        const gitLog = spawn('git', ['rev-list', '--count', 'HEAD', `^origin/main`], {
          cwd: worktreePath,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        gitLog.stdout.on('data', (data) => stdout += data.toString());
        gitLog.on('close', () => resolve(parseInt(stdout.trim()) || 0));
        gitLog.on('error', () => resolve(0));
      });

      // Also check for uncommitted changes
      const hasUncommittedChanges = await new Promise((resolve) => {
        const gitStatus = spawn('git', ['status', '--porcelain'], {
          cwd: worktreePath,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        gitStatus.stdout.on('data', (data) => stdout += data.toString());
        gitStatus.on('close', () => resolve(stdout.trim().length > 0));
        gitStatus.on('error', () => resolve(false));
      });

      // Get last commit message and hash if commits exist
      let lastCommitInfo = 'No commits yet';
      if (commitCount > 0) {
        lastCommitInfo = await new Promise((resolve) => {
          const gitLog = spawn('git', ['log', '-1', '--pretty=format:%h - %s'], {
            cwd: worktreePath,
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let stdout = '';
          gitLog.stdout.on('data', (data) => stdout += data.toString());
          gitLog.on('close', () => resolve(stdout.trim() || 'No commit info'));
          gitLog.on('error', () => resolve('Failed to get commit info'));
        });
      }

      // Check if branch was pushed to remote
      const wasPushed = await new Promise((resolve) => {
        const gitBranch = spawn('git', ['branch', '-r', '--contains', 'HEAD'], {
          cwd: worktreePath,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        gitBranch.stdout.on('data', (data) => stdout += data.toString());
        gitBranch.on('close', () => {
          const remoteBranches = stdout.trim();
          resolve(remoteBranches.includes(`origin/${branchName}`));
        });
        gitBranch.on('error', () => resolve(false));
      });

      // Get file change stats
      const changeStats = await new Promise((resolve) => {
        const gitDiff = spawn('git', ['diff', '--shortstat', 'origin/main...HEAD'], {
          cwd: worktreePath,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        gitDiff.stdout.on('data', (data) => stdout += data.toString());
        gitDiff.on('close', () => resolve(stdout.trim() || 'No changes'));
        gitDiff.on('error', () => resolve('Failed to get change stats'));
      });

      // Build comprehensive git activity summary
      const summaryLines = [];
      summaryLines.push('');
      summaryLines.push('═══════════════════════════════════════════════════════════');
      summaryLines.push(`Git Activity Summary for Job #${jobId}`);
      summaryLines.push('═══════════════════════════════════════════════════════════');
      summaryLines.push(`Branch: ${branchName}`);
      summaryLines.push(`New commits: ${commitCount}`);

      if (commitCount > 0) {
        summaryLines.push(`Latest commit: ${lastCommitInfo}`);
        summaryLines.push(`Changes: ${changeStats}`);
        summaryLines.push(`Pushed to remote: ${wasPushed ? 'YES ✓' : 'NO (local only)'}`);
      } else {
        summaryLines.push('⚠️  NO COMMITS MADE - Ralph did not create any commits');
        if (hasUncommittedChanges) {
          summaryLines.push('⚠️  Uncommitted changes detected - work was done but not committed!');
        } else {
          summaryLines.push('⚠️  No file changes detected - Ralph may have failed or had nothing to do');
        }
      }
      summaryLines.push('═══════════════════════════════════════════════════════════');
      summaryLines.push('');

      const summaryText = summaryLines.join('\n');

      // Log to console
      logger.info(summaryText);

      // Send to server if progress callback provided
      if (onProgress) {
        onProgress(summaryText);
      }

      // Return structured summary object
      return {
        branchName,
        commitCount,
        lastCommitInfo: commitCount > 0 ? lastCommitInfo : null,
        changeStats: commitCount > 0 ? changeStats : null,
        wasPushed,
        hasUncommittedChanges,
        summaryText
      };
    } catch (error) {
      logger.warn(`Failed to log git activity: ${error.message}`);
      return {
        branchName,
        commitCount: 0,
        error: error.message,
        summaryText: `Failed to gather git activity: ${error.message}`
      };
    }
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
