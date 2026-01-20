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

    logger.info(`Executing ${job.job_type} job #${job.id}`);

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
   * Execute PRD generation using Claude /prd skill
   * @param {Object} job - Job object from API
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startTime - Start timestamp
   * @returns {Promise<Object>} Execution result
   */
  async executePrdGeneration(job, onProgress, startTime) {
    logger.info(`Generating PRD for: ${job.task_title}`);

    // Build prompt for PRD generation
    let prompt = `Generate a detailed Product Requirements Document (PRD) for the following feature request.\n\n`;
    prompt += `Task: ${job.task_title}\n\n`;

    if (job.task_description) {
      prompt += `Description:\n${job.task_description}\n\n`;
    }

    if (job.project?.name) {
      prompt += `Project: ${job.project.name}\n\n`;
    }

    prompt += `Include these sections:\n`;
    prompt += `- Overview\n`;
    prompt += `- User Stories\n`;
    prompt += `- Functional Requirements\n`;
    prompt += `- Technical Requirements (if applicable)\n`;
    prompt += `- Success Metrics\n`;
    prompt += `- Out of Scope\n\n`;
    prompt += `Format the PRD in markdown.\n`;

    try {
      // Use Claude /prd skill
      const output = await this.runClaudeSkill('prd', prompt, job.project?.system_path || process.cwd(), onProgress);

      const executionTimeMs = Date.now() - startTime;

      return {
        output: output,
        prdContent: output.trim(), // The PRD content is the output
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      logger.error(`PRD generation failed for job #${job.id}`, error.message);
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

    // Validate project path exists
    if (!job.project.system_path || !fs.existsSync(job.project.system_path)) {
      throw new Error(`Project path does not exist: ${job.project.system_path}`);
    }

    // Build the prompt
    const prompt = this.buildCodePrompt(job);

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
      logger.error(`Code implementation failed for job #${job.id}`, error.message);
      throw error;
    }
  }

  /**
   * Build Claude prompt for code implementation
   * @param {Object} job - Job object
   * @returns {string} Prompt text
   */
  buildCodePrompt(job) {
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
   * Run Claude CLI skill (e.g., /prd)
   * @param {string} skill - Skill name (without /)
   * @param {string} prompt - Input for the skill
   * @param {string} cwd - Working directory
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<string>} Command output
   */
  runClaudeSkill(skill, prompt, cwd, onProgress) {
    return new Promise((resolve, reject) => {
      logger.debug(`Running Claude skill: /${skill}`);

      const claude = spawn('claude', [`/${skill}`], {
        cwd: cwd,
        shell: false,  // FIXED: Don't use shell
        env: process.env
      });

      // Send prompt to stdin
      claude.stdin.write(prompt);
      claude.stdin.end();

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

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
          logger.debug(`Claude skill /${skill} completed successfully`);
          resolve(stdout);
        } else {
          logger.error(`Claude skill /${skill} exited with code ${code}`);
          reject(new Error(`Claude skill /${skill} failed with exit code ${code}: ${stderr}`));
        }
      });

      claude.on('error', (error) => {
        logger.error(`Failed to spawn Claude skill /${skill}`, error.message);
        reject(new Error(`Failed to execute Claude skill /${skill}: ${error.message}`));
      });
    });
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

      // Use stdin to pass prompt - avoids shell injection
      const claude = spawn('claude', [], {
        cwd: cwd,
        shell: false,  // FIXED: Don't use shell
        env: process.env
      });

      // Send prompt via stdin (safe from injection)
      claude.stdin.write(prompt);
      claude.stdin.end();

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
