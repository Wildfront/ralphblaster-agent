const path = require('path');
const logger = require('../logger');

/**
 * EventDetector - Detects and emits status events from Claude's output
 *
 * This class analyzes chunks of output from Claude to detect various activities
 * (file operations, git commands, test execution, etc.) and sends appropriate
 * status events to the API client for real-time progress tracking.
 */
class EventDetector {
  constructor() {
    // Track if planning event was already emitted for current job
    this.planningDetected = false;
  }

  /**
   * Reset the planning detection state (call when starting a new job)
   */
  reset() {
    this.planningDetected = false;
  }

  /**
   * Detect events in output chunk and emit status events
   * @param {string} chunk - Output chunk to analyze
   * @param {number} jobId - Current job ID
   * @param {Object} apiClient - API client with sendStatusEvent method
   */
  detectAndEmit(chunk, jobId, apiClient) {
    if (!apiClient || !jobId) return;

    try {
      // Detect Claude Code tool usage (Read, Write, Edit, Bash, etc.)
      const toolPatterns = [
        { pattern: /Reading\s+([^\s\n]+)/i, type: 'read_file', getMessage: (m) => `Reading ${path.basename(m[1])}` },
        { pattern: /Writing\s+to\s+([^\s\n]+)/i, type: 'write_file', getMessage: (m) => `Writing ${path.basename(m[1])}` },
        { pattern: /Editing\s+([^\s\n]+)/i, type: 'edit_file', getMessage: (m) => `Editing ${path.basename(m[1])}` },
        { pattern: /Searching\s+for\s+['"](.*?)['"]/i, type: 'search', getMessage: (m) => `Searching for "${m[1]}"` },
        { pattern: /Executing:\s*(.+?)(?:\n|$)/i, type: 'bash_command', getMessage: (m) => `Running: ${m[1].substring(0, 50)}${m[1].length > 50 ? '...' : ''}` },
        { pattern: /(?:Running|Executing)\s+bash:\s*(.+?)(?:\n|$)/i, type: 'bash_command', getMessage: (m) => `Running: ${m[1].substring(0, 50)}${m[1].length > 50 ? '...' : ''}` }
      ];

      for (const { pattern, type, getMessage } of toolPatterns) {
        const match = chunk.match(pattern);
        if (match) {
          const message = getMessage(match);
          const filename = match[1] ? match[1].replace(/[`'"]/g, '').trim() : null;

          // Skip files with ellipsis (truncated paths)
          if (filename && filename.includes('...')) {
            return;
          }

          logger.debug(`Detected ${type}: ${message}`);
          apiClient.sendStatusEvent(
            jobId,
            type,
            message,
            filename ? { filename } : {}
          ).catch(error => {
            logger.debug(`Event emission error: ${error.message}`);
          });
          return; // Only emit one event per chunk
        }
      }

      // Detect file modifications (more comprehensive patterns)
      const filePatterns = [
        /(?:Writing to|Created file|Modified file|Editing)\s+([^\s\n]+)/i,
        /(?:Successfully (?:created|modified|updated))\s+([^\s\n]+)/i,
        /File\s+([^\s\n]+)\s+(?:created|modified|updated)/i,
        /(?:Created|Updated|Modified):\s+([^\s\n]+)/i
      ];

      for (const pattern of filePatterns) {
        const match = chunk.match(pattern);
        if (match && match[1]) {
          const filename = match[1].replace(/[`'"]/g, '').trim();
          if (filename && !filename.includes('...')) {
            logger.debug(`File modified: ${filename}`);
            apiClient.sendStatusEvent(
              jobId,
              'file_modified',
              `Modified: ${path.basename(filename)}`,
              { filename: filename }
            ).catch(error => {
              logger.debug(`Event emission error: ${error.message}`);
            });
            return;
          }
        }
      }

      // Detect git operations
      if (/git commit|committed changes|Created commit|Committing changes/i.test(chunk)) {
        logger.debug('Git commit detected');
        apiClient.sendStatusEvent(
          jobId,
          'git_commit',
          'Committing changes...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }

      if (/git add|Staging changes|Adding files/i.test(chunk)) {
        logger.debug('Git add detected');
        apiClient.sendStatusEvent(
          jobId,
          'git_add',
          'Staging changes...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }

      // Detect test execution
      if (/Running tests|running test|bin\/rails test|npm test|pytest|rspec|jest/i.test(chunk)) {
        logger.debug('Test execution detected');
        apiClient.sendStatusEvent(
          jobId,
          'tests_running',
          'Running tests...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }

      // Detect planning/thinking
      if (/(?:Planning|Thinking|Analyzing|Considering)/i.test(chunk)) {
        // Only log planning once per job to avoid spam
        if (!this.planningDetected) {
          this.planningDetected = true;
          logger.debug('Planning phase detected');
          apiClient.sendStatusEvent(
            jobId,
            'planning',
            'Analyzing codebase and planning changes...'
          ).catch(error => {
            logger.debug(`Event emission error: ${error.message}`);
          });
        }
        return;
      }

      // Detect cleanup phase
      if (/cleanup|cleaning up|removing temporary/i.test(chunk)) {
        logger.debug('Cleanup phase detected');
        apiClient.sendStatusEvent(
          jobId,
          'cleanup_started',
          'Cleaning up...'
        ).catch(error => {
          logger.debug(`Event emission error: ${error.message}`);
        });
        return;
      }
    } catch (error) {
      // Silently ignore event emission errors to avoid disrupting execution
      logger.debug(`Event detection error: ${error.message}`);
    }
  }
}

module.exports = EventDetector;
