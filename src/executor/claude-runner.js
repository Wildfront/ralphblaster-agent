const { spawn } = require('child_process');
const path = require('path');
const logger = require('../logger');
const { formatDuration } = require('../utils/format');

// Timeout constants
const TIMEOUTS = {
  CLAUDE_EXECUTION_MS: 7200000, // 2 hours (fallback/default only)
  DEFAULT_TIMEOUT_MINUTES: 60,  // Default timeout if not specified in job
  SAFETY_MARGIN_MINUTES: 1      // Agent terminates 1 min before Rails timeout
};

/**
 * Calculate Claude execution timeout from job configuration
 * Agent terminates 1 minute before Rails timeout to ensure clean state
 * @param {Object} job - Job object from Rails API
 * @returns {number} Timeout in milliseconds
 */
function getClaudeTimeout(job) {
  const timeoutMinutes = job.timeout_minutes || TIMEOUTS.DEFAULT_TIMEOUT_MINUTES;
  const safetyMarginMinutes = TIMEOUTS.SAFETY_MARGIN_MINUTES;
  const effectiveMinutes = Math.max(timeoutMinutes - safetyMarginMinutes, 5); // Min 5 minutes
  return effectiveMinutes * 60 * 1000;  // Convert to milliseconds
}

/**
 * ClaudeRunner - Handles Claude CLI execution
 *
 * This class encapsulates all Claude CLI interaction including:
 * - Spawning Claude processes with proper security
 * - Streaming raw terminal output
 * - Handling timeouts and errors
 */
class ClaudeRunner {
  constructor(errorHandler, gitHelper) {
    this.errorHandler = errorHandler;
    this.gitHelper = gitHelper;
    this.currentProcess = null;
    this.currentJobId = null;
    this.apiClient = null;
    this.capturedStderr = '';
    // Debug mode enabled by default, disable with CLAUDE_STREAM_DEBUG=false
    this.debugStream = process.env.CLAUDE_STREAM_DEBUG !== 'false';
  }

  /**
   * Set the current job ID for event emission
   * @param {number} jobId - Job identifier
   */
  setJobId(jobId) {
    this.currentJobId = jobId;
  }

  /**
   * Set the API client for progress updates
   * @param {Object} apiClient - API client instance
   */
  setApiClient(apiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Reset captured stderr
   */
  resetCapturedStderr() {
    this.capturedStderr = '';
  }

  /**
   * Format stream-json event for progress display
   * @param {Object} event - Stream JSON event
   * @returns {string|null} Formatted text or null if not displayable
   */
  formatStreamEvent(event) {
    // Debug mode: log only interesting stream events, not every delta
    if (this.debugStream) {
      const interestingTypes = ['tool_use', 'tool_result', 'error', 'thinking'];
      if (interestingTypes.includes(event.type)) {
        const eventPreview = JSON.stringify(event).slice(0, 500);
        logger.debug(`[STREAM] ${event.type} | ${eventPreview}`);
      }
    }

    switch (event.type) {
      case 'content_block_delta':
        // Only show Claude's actual text output, not every tiny delta
        return event.delta?.text || null;

      case 'tool_use':
      case 'tool_result':
        // Tool usage is shown via assistant event content blocks
        return null;

      case 'thinking':
        // Thinking content is verbose, skip for cleaner output
        return null;

      case 'error':
        return `\n❌ Error: ${event.error?.message || 'Unknown error'}\n`;

      case 'assistant': {
        // Extract both text and tool usage for terminal display
        const content = event.message?.content || [];
        const parts = [];

        for (const block of content) {
          if (block.type === 'text' && block.text) {
            // Include substantial text (not just whitespace)
            const trimmed = block.text.trim();
            if (trimmed.length > 0) {
              parts.push(block.text);
            }
          } else if (block.type === 'tool_use') {
            // Show tool usage in terminal for visibility
            const toolName = block.name;
            const input = block.input || {};

            switch (toolName) {
              case 'Read':
                parts.push(`\n📖 Reading: ${input.file_path || 'file'}\n`);
                break;
              case 'Edit':
                parts.push(`\n✏️  Editing: ${input.file_path || 'file'}\n`);
                break;
              case 'Write':
                parts.push(`\n📝 Creating: ${input.file_path || 'file'}\n`);
                break;
              case 'Bash':
                const cmd = input.command?.slice(0, 60) || 'command';
                parts.push(`\n💻 Running: ${cmd}${input.command?.length > 60 ? '...' : ''}\n`);
                break;
              case 'Grep':
              case 'Glob':
                parts.push(`\n🔍 Searching: ${input.pattern || input.glob || 'files'}\n`);
                break;
              case 'Task':
                parts.push(`\n🔄 Subtask: ${input.description?.slice(0, 60) || 'working...'}\n`);
                break;
              default:
                parts.push(`\n🔧 ${toolName}\n`);
            }
          }
        }
        return parts.length > 0 ? parts.join('') : null;
      }

      case 'user':
        // Skip user messages (tool results) - not useful in progress stream
        return null;

      case 'text':
        return event.text || null;

      case 'result':
        // Skip result events - not useful for live progress
        return null;

      case 'system':
        // Skip system events (init, hooks) - not useful for display
        return null;

      default:
        if (this.debugStream) {
          logger.debug(`Unhandled stream event type: ${event.type}`);
        }
        return null;
    }
  }

  /**
   * Send structured status events for Claude tool usage
   * @param {Object} event - Stream JSON event
   * @param {number} jobId - Job ID for API calls
   */
  async sendToolStatusEvent(event, jobId) {
    if (!this.apiClient) return;

    try {
      if (event.type === 'assistant') {
        const content = event.message?.content || [];
        for (const block of content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const input = block.input || {};

            // Map tool names to valid Rails event types
            let eventType;
            let message;
            const metadata = {};

            switch (toolName) {
              case 'Read':
                eventType = 'read_file';
                message = `📖 Reading: ${input.file_path?.split('/').pop() || 'file'}`;
                metadata.file = input.file_path;
                break;
              case 'Edit':
                eventType = 'edit_file';
                message = `✏️ Editing: ${input.file_path?.split('/').pop() || 'file'}`;
                metadata.file = input.file_path;
                break;
              case 'Write':
                eventType = 'write_file';
                message = `📝 Creating: ${input.file_path?.split('/').pop() || 'file'}`;
                metadata.file = input.file_path;
                break;
              case 'Bash':
                eventType = 'bash_command';
                const cmd = input.command?.slice(0, 50) || 'command';
                message = `💻 Running: ${cmd}${input.command?.length > 50 ? '...' : ''}`;
                metadata.command = input.command?.slice(0, 200);
                break;
              case 'Grep':
              case 'Glob':
                eventType = 'search';
                message = `🔍 Searching: ${input.pattern || input.glob || 'files'}`;
                metadata.pattern = input.pattern || input.glob;
                break;
              case 'Task':
                eventType = 'progress_update';
                message = `🔄 Subtask: ${input.description?.slice(0, 50) || 'working...'}`;
                metadata.subagent = input.subagent_type;
                break;
              default:
                eventType = 'progress_update';
                message = `🔧 Using: ${toolName}`;
                metadata.tool = toolName;
            }

            await this.apiClient.sendStatusEvent(jobId, eventType, message, metadata);
          }
          // Phase 1.4: REMOVED duplicate text block status events
          // Text blocks are already captured in progress chunks, so this was redundant
          // Expected impact: Eliminate 5-10 duplicate events per job
        }
      }
    } catch (err) {
      logger.debug(`Failed to send tool status event: ${err.message}`);
    }
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
      /^RALPHBLASTER_API_TOKEN$/i,
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
   * @param {number} timeout - Timeout in milliseconds (calculated from job.timeout_minutes)
   * @param {Object} job - Job object (optional, for logging timeout details)
   * @returns {Promise<string>} Command output
   */
  runClaude(prompt, cwd, onProgress, timeout = TIMEOUTS.CLAUDE_EXECUTION_MS, job = null) {
    return new Promise((resolve, reject) => {
      const timeoutFormatted = formatDuration(timeout);
      const logData = {
        timeout: timeoutFormatted,
        workingDirectory: cwd,
        promptLength: prompt.length
      };

      // Log timeout configuration if job provided
      if (job && job.timeout_minutes) {
        logData.jobTimeoutMinutes = job.timeout_minutes;
        logData.calculatedTimeoutMinutes = Math.floor(timeout / 60000);
        logger.info(`Using job-specific timeout: ${job.timeout_minutes} minutes (agent will terminate at ${Math.floor(timeout / 60000)} minutes)`);
      }

      logger.info(`Starting Claude CLI execution`, logData);

      // Use stdin to pass prompt - avoids shell injection
      // Use stream-json format for structured progress events
      logger.info('Spawning Claude CLI process with stream-json output');
      const claude = spawn('claude', ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--permission-mode', 'acceptEdits', '--verbose'], {
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
      let buffer = ''; // Buffer for incomplete JSON lines

      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        buffer += chunk;

        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            // Accumulate final output from content blocks or result events
            if (event.type === 'content_block_delta' && event.delta?.text) {
              stdout += event.delta.text;
            } else if (event.type === 'result' && event.result) {
              // Claude stream-json puts final output in result event
              stdout = event.result;
            }

            // Send progress updates for all event types
            const progressText = this.formatStreamEvent(event);
            if (progressText) {
              // Write to stdout for terminal visibility
              process.stdout.write(progressText);

              // Send to progress callback if provided
              if (onProgress) {
                onProgress(progressText);
              }
            }
          } catch (err) {
            // If JSON parse fails, treat as raw output
            logger.debug(`Non-JSON stdout line: ${line.slice(0, 100)}`);
            stdout += line + '\n';

            // Write to stdout for terminal visibility
            process.stdout.write(line + '\n');

            if (onProgress) {
              onProgress(line + '\n');
            }
          }
        }
      });

      claude.stderr.on('data', (data) => {
        const stderrChunk = data.toString();
        stderr += stderrChunk;
        // Save to instance variable for log file
        this.capturedStderr = (this.capturedStderr || '') + stderrChunk;

        // Log stderr but don't treat as JSON
        process.stderr.write(stderrChunk);

        // Send stderr to progress callback (Claude's interactive output comes on stderr)
        if (onProgress) {
          onProgress(stderrChunk);
        }
      });

      claude.on('close', (code) => {
        clearTimeout(timer); // Clear timeout
        this.currentProcess = null; // Clear process reference

        logger.info(`Claude CLI process exited`, {
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        });

        if (code === 0) {
          logger.info('Claude CLI execution completed successfully');
          resolve(stdout);
        } else {
          logger.error(`Claude CLI exited with non-zero code ${code}`);
          logger.error('Last 1000 chars of stderr:', stderr.slice(-1000));

          const baseError = new Error(`Claude CLI failed with exit code ${code}: ${stderr}`);
          const errorInfo = this.errorHandler.categorizeError(baseError, stderr, code);

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

        const errorInfo = this.errorHandler.categorizeError(error, stderr, null);

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
    const timeout = getClaudeTimeout(job);

    const logData = {
      timeout: formatDuration(timeout),
      workingDirectory: worktreePath,
      promptLength: prompt.length,
      jobTimeoutMinutes: job.timeout_minutes || TIMEOUTS.DEFAULT_TIMEOUT_MINUTES,
      calculatedTimeoutMinutes: Math.floor(timeout / 60000)
    };

    logger.info(`Running Claude Code in worktree: ${worktreePath}`, logData);
    logger.info(`Using job-specific timeout: ${job.timeout_minutes || TIMEOUTS.DEFAULT_TIMEOUT_MINUTES} minutes (agent will terminate at ${Math.floor(timeout / 60000)} minutes)`);

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

    // Spawn Claude with stream-json output for structured progress events
    logger.info('Spawning Claude CLI process with stream-json output');

    // Send to API/UI
    if (this.apiClient && this.apiClient.sendProgress) {
      this.apiClient.sendProgress(job.id, 'Spawning Claude CLI process with stream-json output\n')
        .catch(err => logger.warn(`Failed to send progress to API: ${err.message}`));
    }

    const claudeProcess = spawn('claude', ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--permission-mode', 'acceptEdits', '--verbose'], {
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
    let buffer = ''; // Buffer for incomplete JSON lines

    return new Promise((resolve, reject) => {
      // Capture stdout and parse stream-json events
      claudeProcess.stdout.on('data', async (data) => {
        const chunk = data.toString();
        buffer += chunk;

        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            // Accumulate final output from content blocks or result events
            if (event.type === 'content_block_delta' && event.delta?.text) {
              output += event.delta.text;
            } else if (event.type === 'result' && event.result) {
              // Claude stream-json puts final output in result event
              output = event.result;
            }

            // Send structured status events for tool usage
            await this.sendToolStatusEvent(event, job.id);

            // Send progress updates for all event types
            const progressText = this.formatStreamEvent(event);
            if (progressText) {
              // Write to stdout for terminal visibility
              process.stdout.write(progressText);

              // Call onProgress callback if provided (it will handle API streaming with throttling)
              if (onProgress) {
                onProgress(progressText);
              } else if (this.apiClient) {
                // Only send directly to API if no onProgress callback (prevents duplicate updates)
                try {
                  await this.apiClient.sendProgress(job.id, progressText);
                } catch (err) {
                  logger.warn(`Failed to send progress to API: ${err.message}`);
                }
              }
            }
          } catch (err) {
            // If JSON parse fails, treat as raw output
            logger.debug(`Non-JSON stdout line: ${line.slice(0, 100)}`);
            output += line + '\n';

            // Write to stdout for terminal visibility
            process.stdout.write(line + '\n');

            if (onProgress) {
              onProgress(line + '\n');
            } else if (this.apiClient) {
              try {
                await this.apiClient.sendProgress(job.id, line + '\n');
              } catch (err) {
                logger.warn(`Failed to send progress to API: ${err.message}`);
              }
            }
          }
        }
      });

      // Capture stderr
      claudeProcess.stderr.on('data', async (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        // Save to instance variable for log file
        this.capturedStderr = (this.capturedStderr || '') + chunk;

        // Debug: confirm we're receiving stderr
        logger.debug(`Received Claude stderr chunk (${chunk.length} bytes)`);

        // Log stderr but don't treat as JSON
        process.stderr.write(chunk);

        // Call onProgress callback if provided (it will handle API streaming with throttling)
        if (onProgress) {
          onProgress(chunk);
        } else if (this.apiClient) {
          // Only send directly to API if no onProgress callback (prevents duplicate updates)
          try {
            await this.apiClient.sendProgress(job.id, chunk);
          } catch (err) {
            logger.warn(`Failed to send stderr progress to API: ${err.message}`);
          }
        }
      });

      // Wait for completion
      claudeProcess.on('close', async (code) => {
        clearTimeout(timer);
        this.currentProcess = null;
        const duration = Date.now() - startTime;

        if (code === 0) {
          logger.info(`Claude completed successfully in ${formatDuration(duration)}`, {
            outputLength: output.length,
            outputPreview: output.slice(0, 200)
          });

          // Warn if output is empty - likely stream parsing issue
          if (!output || output.length === 0) {
            logger.warn('Claude output is empty! Stream-json events may not have been parsed correctly.');
          }

          // Get branch name from worktree
          const branchName = await this.gitHelper.getCurrentBranch(worktreePath);

          resolve({
            output: output,
            branchName,
            duration
          });
        } else {
          logger.error(`Claude failed with code ${code}`);

          // Use existing error categorization
          const baseError = new Error(`Claude CLI failed with exit code ${code}: ${errorOutput}`);
          const errorInfo = this.errorHandler.categorizeError(baseError, errorOutput, code);

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
        const errorInfo = this.errorHandler.categorizeError(err, errorOutput, null);

        const enrichedError = new Error(errorInfo.userMessage);
        enrichedError.category = errorInfo.category;
        enrichedError.technicalDetails = errorInfo.technicalDetails;
        enrichedError.partialOutput = output;

        reject(enrichedError);
      });
    });
  }

}

module.exports = ClaudeRunner;
