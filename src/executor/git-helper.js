const { spawn } = require('child_process');
const fs = require('fs');
const logger = require('../logger');

/**
 * GitHelper - Handles git operations for worktrees
 * Extracted from Executor class to improve modularity and testability
 */
class GitHelper {
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
    } catch (error) {
      throw error;
    }
  }

  /**
   * Log comprehensive git activity summary for a job
   * @param {string} worktreePath - Path to worktree
   * @param {string} branchName - Name of the branch
   * @param {string} jobId - Job identifier
   * @param {Function} onProgress - Optional progress callback
   * @returns {Promise<Object>} Git activity summary object
   */
  async logGitActivity(worktreePath, branchName, jobId, onProgress = null) {
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      logger.warn(`Worktree not found for git activity logging: ${worktreePath}`);
      return;
    }

    try {
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
}

module.exports = GitHelper;
