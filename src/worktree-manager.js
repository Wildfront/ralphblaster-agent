const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');

/**
 * WorktreeManager - Manages git worktrees for parallel job execution
 *
 * Each job gets an isolated worktree in .ralph-worktrees/job-{id}/
 * with a unique branch: ralph/ticket-{task_id}/job-{job_id}
 */
class WorktreeManager {
  /**
   * Create a new worktree for a job
   * @param {Object} job - The job object with id, task, and project
   * @returns {Promise<string>} - The absolute path to the worktree
   */
  async createWorktree(job) {
    const worktreePath = this.getWorktreePath(job)
    const branchName = this.getBranchName(job)
    const systemPath = job.project.system_path

    logger.info(`Creating worktree for job ${job.id}`, {
      worktreePath,
      branchName,
      systemPath
    })

    try {
      // Verify git is available
      await this.execGit(systemPath, ['--version'], 5000)

      // Check if worktree already exists (from a previous failed run)
      try {
        await fs.access(worktreePath)
        logger.warn(`Worktree already exists at ${worktreePath}, removing stale worktree`)
        await this.removeWorktree(job)
      } catch (err) {
        // Worktree doesn't exist, which is expected
      }

      // Create the worktree with a new branch
      // -b creates a new branch, --detach would checkout without branch
      await this.execGit(
        systemPath,
        ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'],
        30000
      )

      logger.info(`Created worktree: ${worktreePath}`)
      return worktreePath
    } catch (error) {
      logger.error(`Failed to create worktree for job ${job.id}`, {
        error: error.message,
        worktreePath,
        branchName
      })
      throw new Error(`Failed to create worktree: ${error.message}`)
    }
  }

  /**
   * Remove a worktree after job completion
   * @param {Object} job - The job object
   */
  async removeWorktree(job) {
    const worktreePath = this.getWorktreePath(job)
    const branchName = this.getBranchName(job)
    const systemPath = job.project.system_path

    logger.info(`Removing worktree for job ${job.id}`, {
      worktreePath,
      branchName
    })

    try {
      // Remove the worktree (--force removes even if dirty)
      await this.execGit(
        systemPath,
        ['worktree', 'remove', worktreePath, '--force'],
        30000
      )

      logger.info(`Removed worktree: ${worktreePath}`)
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
   * @param {Object} job - The job object
   * @returns {string} - Absolute path to worktree
   */
  getWorktreePath(job) {
    const systemPath = job.project.system_path
    return path.join(systemPath, '.ralph-worktrees', `job-${job.id}`)
  }

  /**
   * Get the branch name for this job
   * @param {Object} job - The job object
   * @returns {string} - Branch name in format ralph/ticket-{task_id}/job-{job_id}
   */
  getBranchName(job) {
    return `ralph/ticket-${job.task_id}/job-${job.id}`
  }

  /**
   * Execute a git command safely
   * @param {string} cwd - Working directory
   * @param {string[]} args - Git command arguments
   * @param {number} timeout - Timeout in milliseconds (default: 30s)
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async execGit(cwd, args, timeout = 30000) {
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
