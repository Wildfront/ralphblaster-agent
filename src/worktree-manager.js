const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');

// Timeout constants
const TIMEOUTS = {
  GIT_COMMAND_MS: 30000, // 30 seconds for git operations
  WORKTREE_CLEANUP_DELAY_MS: 500, // Wait after worktree removal for filesystem consistency
};

/**
 * WorktreeManager - Manages git worktrees for parallel job execution
 *
 * Each job gets an isolated worktree as a sibling to the repo:
 * <repo-parent>/<repo-name>-worktrees/job-{id}/
 * with a unique branch: blaster/ticket-{task_id}/job-{job_id}
 *
 * Worktrees are created OUTSIDE the repo to prevent git conflicts.
 */
class WorktreeManager {
  /**
   * Create a new worktree for a job with retry logic for multi-agent safety
   * @param {Object} job - The job object with id, task, and project
   * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
   * @returns {Promise<string>} - The absolute path to the worktree
   */
  async createWorktree(job, maxRetries = 3) {
    const worktreePath = this.getWorktreePath(job)
    const branchName = this.getBranchName(job)
    const systemPath = job.project.system_path

    // Phase 3: Use event for structured logging
    logger.event('worktree.creating', {
      component: 'worktree',
      operation: 'create',
      path: worktreePath,
      branch: branchName,
      systemPath
    })

    // Retry loop with exponential backoff for handling concurrent worktree operations
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Verify git is available
        await this.execGit(systemPath, ['--version'], 5000)

        // Check if worktree already exists (from a previous failed run)
        try {
          await fs.access(worktreePath)
          logger.warn(`Worktree already exists at ${worktreePath}, removing stale worktree (attempt ${attempt}/${maxRetries})`)
          await this.removeWorktree(job)
          // Wait a bit after removal to ensure filesystem consistency
          await this.sleep(TIMEOUTS.WORKTREE_CLEANUP_DELAY_MS)
        } catch (err) {
          // Worktree doesn't exist, which is expected
        }

        // Create the worktree with a new branch
        // -b creates a new branch, --detach would checkout without branch
        await this.execGit(
          systemPath,
          ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'],
          TIMEOUTS.GIT_COMMAND_MS
        )

        // Phase 3: Use event for structured logging
        logger.event('worktree.created', {
          component: 'worktree',
          operation: 'create',
          path: worktreePath,
          branch: branchName
        })
        return worktreePath
      } catch (error) {
        const isLastAttempt = attempt === maxRetries

        // Check if this is a lock/collision error that might be resolved by retrying
        const isRetryableError =
          error.message.includes('already exists') ||
          error.message.includes('already locked') ||
          error.message.includes('unable to create') ||
          error.message.includes('fatal: could not lock');

        if (isRetryableError && !isLastAttempt) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          logger.warn(`Worktree creation failed (attempt ${attempt}/${maxRetries}), retrying in ${backoffMs}ms`, {
            error: error.message
          })
          await this.sleep(backoffMs)
          continue
        }

        // Non-retryable error or last attempt - throw
        logger.error(`Failed to create worktree for job ${job.id} (attempt ${attempt}/${maxRetries})`, {
          error: error.message,
          worktreePath,
          branchName
        })
        throw new Error(`Failed to create worktree: ${error.message}`)
      }
    }

    // Should never reach here, but just in case
    throw new Error('Failed to create worktree after all retry attempts')
  }

  /**
   * Sleep helper for retry logic
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Remove a worktree after job completion
   * @param {Object} job - The job object
   */
  async removeWorktree(job) {
    const worktreePath = this.getWorktreePath(job)
    const branchName = this.getBranchName(job)
    const systemPath = job.project.system_path

    // Phase 3: Use event for structured logging
    logger.event('worktree.removing', {
      component: 'worktree',
      operation: 'remove',
      path: worktreePath,
      branch: branchName
    })

    try {
      // Remove the worktree (--force removes even if dirty)
      await this.execGit(
        systemPath,
        ['worktree', 'remove', worktreePath, '--force'],
        TIMEOUTS.GIT_COMMAND_MS
      )

      // Phase 3: Use event for structured logging
      logger.event('worktree.removed', {
        component: 'worktree',
        operation: 'remove',
        path: worktreePath
      })
    } catch (error) {
      // Log error but don't throw - cleanup is best-effort
      logger.error(`Failed to remove worktree for job ${job.id}`, {
        error: error.message,
        worktreePath
      })
    }

    // Note: We intentionally don't delete the branch here
    // The branch remains in the repo for history/inspection
  }

  /**
   * Get the absolute path where the worktree should be created
   * Creates worktree as a sibling to the repo, not inside it
   * @param {Object} job - The job object
   * @returns {string} - Absolute path to worktree
   */
  getWorktreePath(job) {
    const systemPath = job.project.system_path
    const repoName = path.basename(systemPath)
    const repoParent = path.dirname(systemPath)
    // Create worktree as sibling: /parent/repo-worktrees/job-{id}
    // NOT inside repo: /parent/repo/.ralph-worktrees/job-{id}
    return path.join(repoParent, `${repoName}-worktrees`, `job-${job.id}`)
  }

  /**
   * Get the branch name for this job
   * @param {Object} job - The job object
   * @returns {string} - Branch name in format blaster/ticket-{task_id}/job-{job_id}
   */
  getBranchName(job) {
    return `blaster/ticket-${job.task_id}/job-${job.id}`
  }

  /**
   * Execute a git command safely
   * @param {string} cwd - Working directory
   * @param {string[]} args - Git command arguments
   * @param {number} timeout - Timeout in milliseconds (default: 30s)
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async execGit(cwd, args, timeout = TIMEOUTS.GIT_COMMAND_MS) {
    return new Promise((resolve, reject) => {
      const process = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false // Security: Don't use shell to prevent injection
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        process.kill('SIGTERM')
        reject(new Error(`Git command timed out after ${timeout}ms`))
      }, timeout)

      process.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      process.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      process.on('error', (err) => {
        clearTimeout(timer)
        if (!timedOut) {
          reject(new Error(`Failed to execute git: ${err.message}`))
        }
      })

      process.on('close', (code) => {
        clearTimeout(timer)
        if (timedOut) return // Already rejected

        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          reject(new Error(`Git command failed (exit code ${code}): ${stderr || stdout}`))
        }
      })
    })
  }
}

module.exports = WorktreeManager;
