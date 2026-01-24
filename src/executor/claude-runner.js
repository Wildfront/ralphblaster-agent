const { spawn } = require('child_process');
const path = require('path');
const logger = require('../logger');
const { formatDuration } = require('../utils/format');

/**
 * ClaudeRunner - Handles Claude CLI execution
 *
 * This class encapsulates all Claude CLI interaction including:
 * - Spawning Claude processes with proper security
 * - Parsing stream-json output format
 * - Handling timeouts and errors
 * - Event detection and logging
 */
class ClaudeRunner {
  constructor(errorHandler, eventDetector, gitHelper) {
    this.errorHandler = errorHandler;
    this.eventDetector = eventDetector;
    this.gitHelper = gitHelper;
    this.currentProcess = null;
    this.currentJobId = null;
    this.apiClient = null;
    this.capturedStderr = '';
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
      let assistantTextContent = ''; // Collect all assistant text for PRD content
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

            // Extract assistant text content for PRD generation
            if (event.type === 'assistant' && event.message?.content) {
              for (const content of event.message.content) {
                if (content.type === 'text' && content.text) {
                  assistantTextContent += content.text + '\n';
                }
              }
            }

            // Detect and emit events
            this.eventDetector.detectAndEmit(line, this.currentJobId, this.apiClient);

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
            // Extract assistant text from remaining buffer
            if (event.type === 'assistant' && event.message?.content) {
              for (const content of event.message.content) {
                if (content.type === 'text' && content.text) {
                  assistantTextContent += content.text + '\n';
                }
              }
            }
          } catch (e) {
            // Ignore incomplete JSON
          }
        }

        logger.info(`Claude CLI process exited`, {
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          assistantTextLength: assistantTextContent.length
        });

        if (code === 0) {
          logger.info('Claude CLI execution completed successfully');
          // For PRD generation, prefer assistant text content over summary result
          // For code execution, fall back to finalResult or raw stdout
          const output = assistantTextContent.trim() || finalResult || stdout;
          logger.debug(`Returning output (source: ${assistantTextContent.trim() ? 'assistant_text' : finalResult ? 'final_result' : 'stdout'})`);
          resolve(output);
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
    let assistantTextContent = ''; // Collect all assistant text
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

            // Extract assistant text content
            if (event.type === 'assistant' && event.message?.content) {
              for (const content of event.message.content) {
                if (content.type === 'text' && content.text) {
                  assistantTextContent += content.text + '\n';
                }
              }
            }

            // Detect and emit events
            this.eventDetector.detectAndEmit(line, this.currentJobId, this.apiClient);

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
            // Extract assistant text from remaining buffer
            if (event.type === 'assistant' && event.message?.content) {
              for (const content of event.message.content) {
                if (content.type === 'text' && content.text) {
                  assistantTextContent += content.text + '\n';
                }
              }
            }
          } catch (e) {
            // Ignore incomplete JSON
          }
        }

        if (code === 0) {
          logger.info(`Claude completed successfully in ${formatDuration(duration)}`);

          // Get branch name from worktree
          const branchName = await this.gitHelper.getCurrentBranch(worktreePath);

          // Prefer assistant text content over summary result
          const outputText = assistantTextContent.trim() || finalResult || output;

          resolve({
            output: outputText,
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
}

module.exports = ClaudeRunner;
