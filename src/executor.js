const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class Executor {
  /**
   * Execute a job using Claude CLI
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} Execution result
   */
  async execute(job, onProgress) {
    const startTime = Date.now();

    logger.info(`Executing job #${job.id} in ${job.project.system_path}`);

    // Validate project path exists
    if (!job.project.system_path || !fs.existsSync(job.project.system_path)) {
      throw new Error(`Project path does not exist: ${job.project.system_path}`);
    }

    // Build the prompt
    const prompt = this.buildPrompt(job);

    try {
      // Execute claude --print with the prompt
      const output = await this.runClaude(prompt, job.project.system_path, onProgress);

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
      logger.error(`Job #${job.id} execution failed`, error.message);
      throw error;
    }
  }

  /**
   * Build Claude prompt from job data
   * @param {Object} job - Job object
   * @returns {string} Prompt text
   */
  buildPrompt(job) {
    let prompt = `You are Ralph, an autonomous coding agent. Your task is to implement the following PRD:\n\n`;
    prompt += `# Task: ${job.task_title}\n\n`;

    if (job.task_description) {
      prompt += `## Description\n${job.task_description}\n\n`;
    }

    if (job.prd_content) {
      prompt += `## Product Requirements Document\n${job.prd_content}\n\n`;
    }

    prompt += `## Instructions\n`;
    prompt += `- Work in the project directory: ${job.project.system_path}\n`;
    prompt += `- Create a new git branch for your changes\n`;
    prompt += `- Implement all requirements from the PRD\n`;
    prompt += `- Write tests for your changes\n`;
    prompt += `- Ensure all tests pass\n`;
    prompt += `- When complete, output a summary starting with "RALPH_SUMMARY:" followed by what you implemented\n`;
    prompt += `- Output the branch name starting with "RALPH_BRANCH:" followed by the branch name\n\n`;
    prompt += `Begin implementation now.\n`;

    return prompt;
  }

  /**
   * Run Claude CLI with the given prompt
   * @param {string} prompt - Prompt text
   * @param {string} cwd - Working directory
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<string>} Command output
   */
  runClaude(prompt, cwd, onProgress) {
    return new Promise((resolve, reject) => {
      logger.debug('Starting Claude CLI execution');

      const claude = spawn('claude', ['--print', prompt], {
        cwd: cwd,
        shell: true,
        env: process.env
      });

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
        if (code === 0) {
          logger.debug('Claude CLI execution completed successfully');
          resolve(stdout);
        } else {
          logger.error(`Claude CLI exited with code ${code}`);
          reject(new Error(`Claude CLI failed with exit code ${code}: ${stderr}`));
        }
      });

      claude.on('error', (error) => {
        logger.error('Failed to spawn Claude CLI', error.message);
        reject(new Error(`Failed to execute Claude CLI: ${error.message}`));
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
}

module.exports = Executor;
