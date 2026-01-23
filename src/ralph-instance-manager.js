const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

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
   * Converts markdown PRD to prd.json using bundled Ralph skill
   * @param {string} instancePath - Path to the Ralph instance directory
   * @param {string} prompt - The PRD markdown content
   * @returns {Promise<void>}
   */
  async convertPrdToJson(instancePath, prompt) {
    const startTime = Date.now();
    const promptSize = Buffer.byteLength(prompt, 'utf8');
    logger.info(`Starting PRD to JSON conversion (input size: ${promptSize} bytes, ${prompt.split('\n').length} lines)`);
    logger.info(`Instance path: ${instancePath}`);
    logger.info(`Expected output file: ${path.join(instancePath, 'prd.json')}`);

    try {
      // Log directory contents before conversion
      logger.debug('Directory contents BEFORE conversion:');
      const beforeFiles = await fs.readdir(instancePath);
      logger.debug(`  Files: ${beforeFiles.join(', ') || '(empty)'}`);

      // Load the bundled Ralph skill instructions
      const skillPath = path.join(__dirname, 'claude-plugin', 'skills', 'ralph', 'SKILL.md');
      const skillContent = await fs.readFile(skillPath, 'utf8');

      // Remove the YAML frontmatter from skill content
      const skillInstructions = skillContent.replace(/^---\n[\s\S]*?\n---\n/, '');

      // Create the full prompt with skill instructions + PRD content
      const fullPrompt = `${skillInstructions}

---

You are converting the following PRD to prd.json format. Follow the instructions above carefully.

IMPORTANT: Write the prd.json file to this exact path:
${path.join(instancePath, 'prd.json')}

Here is the PRD to convert:

${prompt}

Please generate the prd.json file now at the path specified above.`;

      // Log the prompt being sent (truncated for brevity)
      logger.debug(`Prompt size: ${fullPrompt.length} bytes`);
      logger.debug(`First 500 chars of prompt: ${fullPrompt.substring(0, 500)}...`);

      // Run Claude with the combined prompt
      const claude = spawn('claude', ['--print', '--dangerously-skip-permissions'], {
        cwd: instancePath,
        env: {
          ...process.env,
          PWD: instancePath
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      logger.debug(`Spawned Claude process with PID: ${claude.pid}`);
      logger.debug(`Working directory: ${instancePath}`);

      // Send the full prompt to stdin
      claude.stdin.write(fullPrompt);
      claude.stdin.end();

      let stdout = '';
      let stderr = '';
      let lastLogTime = Date.now();

      // Real-time logging of stdout/stderr
      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Log progress every 30 seconds or when there's significant output
        const now = Date.now();
        if (now - lastLogTime > 30000 || chunk.length > 500) {
          const elapsed = Math.round((now - startTime) / 1000);
          logger.info(`PRD conversion in progress (${elapsed}s elapsed, ${stdout.length} bytes captured)`);
          lastLogTime = now;
        }

        // Log actual output at debug level
        logger.debug(`Claude stdout: ${chunk.substring(0, 200)}${chunk.length > 200 ? '...' : ''}`);
      });

      claude.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug(`Claude stderr: ${chunk}`);
      });

      // Log progress every 30 seconds
      const progressInterval = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        logger.info(`PRD conversion still running (${elapsed}s elapsed)... stdout: ${stdout.length} bytes, stderr: ${stderr.length} bytes`);
      }, 30000);

      // Wait for process to complete with timeout
      const exitCode = await new Promise((resolve, reject) => {
        claude.on('close', resolve);
        claude.on('error', reject);

        // 5 minute timeout for PRD conversion
        const timeout = setTimeout(() => {
          clearInterval(progressInterval);
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          logger.error(`PRD conversion timed out after ${elapsed}s`);
          logger.error(`Captured stdout (${stdout.length} bytes):`, stdout);
          logger.error(`Captured stderr (${stderr.length} bytes):`, stderr);
          claude.kill('SIGTERM');
          reject(new Error('PRD conversion timed out after 5 minutes'));
        }, 300000);

        claude.on('close', () => {
          clearTimeout(timeout);
          clearInterval(progressInterval);
        });
      });

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      logger.info(`PRD conversion completed in ${elapsed}s (exit code: ${exitCode})`);

      // Log directory contents after conversion
      logger.debug('Directory contents AFTER conversion:');
      const afterFiles = await fs.readdir(instancePath);
      logger.debug(`  Files: ${afterFiles.join(', ') || '(empty)'}`);

      if (exitCode !== 0) {
        logger.error(`Claude /ralph failed. Stdout: ${stdout}`);
        logger.error(`Claude /ralph failed. Stderr: ${stderr}`);
        throw new Error(`Claude /ralph failed with exit code ${exitCode}: ${stderr}`);
      }

      // Analyze stdout for Write tool usage
      logger.debug('Analyzing Claude output for Write tool calls...');
      const writeToolMatches = stdout.match(/Write.*?prd\.json/gi) || [];
      logger.debug(`Found ${writeToolMatches.length} potential Write tool references`);
      if (writeToolMatches.length > 0) {
        logger.debug(`Write tool matches: ${writeToolMatches.slice(0, 3).join(', ')}`);
      }

      // Check if stdout contains the actual JSON content
      const hasJsonContent = stdout.includes('"branchName"') && stdout.includes('"userStories"');
      logger.debug(`Stdout contains JSON structure: ${hasJsonContent}`);

      // Save conversion output for debugging
      const conversionLogPath = path.join(instancePath, 'prd-conversion.log');
      await fs.writeFile(conversionLogPath, `PRD Conversion Log
Started: ${new Date(startTime).toISOString()}
Completed: ${new Date().toISOString()}
Duration: ${elapsed}s
Input size: ${promptSize} bytes
Exit code: ${exitCode}
Working directory: ${instancePath}
Expected output: ${path.join(instancePath, 'prd.json')}

=== ANALYSIS ===
Write tool references found: ${writeToolMatches.length}
JSON content in stdout: ${hasJsonContent}
Files in directory after: ${afterFiles.join(', ')}

=== STDOUT (${stdout.length} bytes) ===
${stdout}

=== STDERR (${stderr.length} bytes) ===
${stderr}
`);
      logger.debug(`Saved detailed conversion log to: ${conversionLogPath}`);

      // Verify prd.json was created
      const prdJsonPath = path.join(instancePath, 'prd.json');
      try {
        await fs.access(prdJsonPath);
        logger.info(`✓ prd.json file exists at: ${prdJsonPath}`);

        // Validate prd.json structure
        const prdContent = await fs.readFile(prdJsonPath, 'utf8');
        logger.debug(`prd.json file size: ${prdContent.length} bytes`);

        const prd = JSON.parse(prdContent);

        if (!prd.branchName || !prd.userStories) {
          throw new Error('Invalid prd.json structure: missing branchName or userStories');
        }

        logger.info(`Successfully validated prd.json (branch: ${prd.branchName}, ${prd.userStories.length} user stories)`);
      } catch (error) {
        // Enhanced error with directory search
        logger.error(`✗ prd.json validation failed: ${error.message}`);
        logger.error(`Expected location: ${prdJsonPath}`);

        // Search for prd.json anywhere in the instance directory tree
        logger.error('Searching for prd.json in directory tree...');
        try {
          const { execSync } = require('child_process');
          const findResult = execSync(`find "${instancePath}" -name "prd.json" -type f 2>/dev/null || true`).toString().trim();
          if (findResult) {
            logger.error(`Found prd.json at unexpected location(s):\n${findResult}`);
          } else {
            logger.error('No prd.json file found anywhere in directory tree');
          }
        } catch (findError) {
          logger.error(`Could not search directory: ${findError.message}`);
        }

        throw new Error(`prd.json validation failed: ${error.message}\n\nExpected: ${prdJsonPath}\nFiles present: ${afterFiles.join(', ')}\n\nStdout (first 1000 chars):\n${stdout.substring(0, 1000)}\n\nStderr:\n${stderr}`);
      }
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
