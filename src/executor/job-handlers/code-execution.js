const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../../logger');
const WorktreeManager = require('../../worktree-manager');

/**
 * Handles code execution jobs
 * Manages worktree creation, Claude execution, git activity logging, and cleanup
 */
class CodeExecutionHandler {
  /**
   * @param {Object} promptValidator - Validator for prompt security
   * @param {Object} pathValidator - Validator for path security
   * @param {Object} claudeRunner - Claude CLI runner
   * @param {Object} gitHelper - Git operations helper
   * @param {Object} apiClient - Optional API client for status updates
   */
  constructor(promptValidator, pathValidator, claudeRunner, gitHelper, apiClient) {
    this.promptValidator = promptValidator;
    this.pathValidator = pathValidator;
    this.claudeRunner = claudeRunner;
    this.gitHelper = gitHelper;
    this.apiClient = apiClient;
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
    this.claudeRunner.resetCapturedStderr();

    // Validate and sanitize project path
    const sanitizedPath = this.pathValidator.validateAndSanitizePath(job.project.system_path);
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
    this.promptValidator.validatePrompt(prompt);

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
      const result = await this.claudeRunner.runClaudeDirectly(worktreePath, prompt, job, onProgress);

      // Log git activity details and send to server
      const gitActivitySummary = await this.gitHelper.logGitActivity(worktreePath, result.branchName, job.id, onProgress);

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
        const stderrContent = this.claudeRunner.capturedStderr || '';
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
${this.claudeRunner.capturedStderr || 'No stderr captured'}

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
}

module.exports = CodeExecutionHandler;
