const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Manages Ralph agent instances within git worktrees
 * Creates instance directories, converts PRDs, and manages progress tracking
 */
class RalphInstanceManager {
  /**
   * Creates a Ralph instance directory with all required files
   * @param {string} worktreePath - Path to the git worktree
   * @param {string} prompt - The PRD or feature description in markdown
   * @param {string} jobId - Unique job identifier
   * @returns {Promise<string>} Path to the created instance directory
   */
  async createInstance(worktreePath, prompt, jobId) {
    // Create instance directory inside the worktree
    const instancePath = path.join(worktreePath, 'ralph-instance');
    await fs.mkdir(instancePath, { recursive: true });

    // Copy bundled ralph.sh and prompt.md to instance
    const bundledRalphDir = path.join(__dirname, 'ralph');
    const ralphShPath = path.join(bundledRalphDir, 'ralph.sh');
    const promptMdPath = path.join(bundledRalphDir, 'prompt.md');

    await fs.copyFile(ralphShPath, path.join(instancePath, 'ralph.sh'));
    await fs.copyFile(promptMdPath, path.join(instancePath, 'prompt.md'));

    // Make ralph.sh executable
    await fs.chmod(path.join(instancePath, 'ralph.sh'), 0o755);

    // Convert prompt to prd.json
    await this.convertPrdToJson(instancePath, prompt);

    // Initialize progress.txt
    const progressContent = `# Ralph Progress Log - Job ${jobId}
Started: ${new Date().toISOString()}
---

`;
    await fs.writeFile(path.join(instancePath, 'progress.txt'), progressContent);

    return instancePath;
  }

  /**
   * Converts markdown PRD to prd.json using Claude /ralph skill
   * @param {string} instancePath - Path to the Ralph instance directory
   * @param {string} prompt - The PRD markdown content
   * @returns {Promise<void>}
   */
  async convertPrdToJson(instancePath, prompt) {
    // Write the prompt to a temporary file
    const promptFilePath = path.join(instancePath, 'input-prd.md');
    await fs.writeFile(promptFilePath, prompt);

    try {
      // Run claude /ralph to convert the PRD
      const { stdout, stderr } = await execAsync(
        `claude /ralph < "${promptFilePath}"`,
        {
          cwd: instancePath,
          env: {
            ...process.env,
            // Ensure Claude CLI can access the instance directory
            PWD: instancePath
          },
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
        }
      );

      // Verify prd.json was created
      const prdJsonPath = path.join(instancePath, 'prd.json');
      try {
        await fs.access(prdJsonPath);

        // Validate prd.json structure
        const prdContent = await fs.readFile(prdJsonPath, 'utf8');
        const prd = JSON.parse(prdContent);

        if (!prd.branchName || !prd.userStories) {
          throw new Error('Invalid prd.json structure: missing branchName or userStories');
        }
      } catch (error) {
        throw new Error(`prd.json validation failed: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`);
      }

      // Clean up temporary prompt file
      await fs.unlink(promptFilePath).catch(() => {});
    } catch (error) {
      throw new Error(`Failed to convert PRD to JSON: ${error.message}`);
    }
  }

  /**
   * Returns environment variables required for ralph.sh execution
   * @param {string} worktreePath - Path to the git worktree
   * @param {string} instancePath - Path to the Ralph instance directory
   * @param {string} mainRepoPath - Path to the main repository
   * @returns {Object} Environment variables object
   */
  getEnvVars(worktreePath, instancePath, mainRepoPath) {
    return {
      ...process.env,
      RALPH_WORKTREE_PATH: worktreePath,
      RALPH_INSTANCE_DIR: instancePath,
      RALPH_MAIN_REPO: mainRepoPath
    };
  }

  /**
   * Reads and parses the progress summary from progress.txt
   * @param {string} instancePath - Path to the Ralph instance directory
   * @returns {Promise<string>} Summary of progress
   */
  async readProgressSummary(instancePath) {
    const progressPath = path.join(instancePath, 'progress.txt');

    try {
      const content = await fs.readFile(progressPath, 'utf8');

      // Extract meaningful summary from progress file
      const lines = content.split('\n');
      const summaryLines = [];

      for (const line of lines) {
        // Skip header and empty lines
        if (line.startsWith('#') || line.startsWith('Started:') || line === '---' || !line.trim()) {
          continue;
        }

        summaryLines.push(line);
      }

      return summaryLines.join('\n').trim() || 'No progress recorded yet';
    } catch (error) {
      return `Failed to read progress: ${error.message}`;
    }
  }

  /**
   * Checks if Ralph has completed successfully by looking for completion signal
   * @param {string} output - The output from ralph.sh execution
   * @returns {boolean} True if completion signal found
   */
  hasCompletionSignal(output) {
    return output.includes('<promise>COMPLETE</promise>');
  }

  /**
   * Extracts the branch name from prd.json
   * @param {string} instancePath - Path to the Ralph instance directory
   * @returns {Promise<string|null>} Branch name or null if not found
   */
  async getBranchName(instancePath) {
    try {
      const prdJsonPath = path.join(instancePath, 'prd.json');
      const content = await fs.readFile(prdJsonPath, 'utf8');
      const prd = JSON.parse(content);
      return prd.branchName || null;
    } catch (error) {
      return null;
    }
  }
}

module.exports = RalphInstanceManager;
