const logger = require('../logger');

/**
 * Categorize error for user-friendly messaging
 * @param {Error} error - The error object
 * @param {string} stderr - Standard error output
 * @param {number} exitCode - Process exit code
 * @returns {Object} Object with category, userMessage, and technicalDetails
 */
function categorizeError(error, stderr = '', exitCode = null) {
  let category = 'unknown';
  let userMessage = error.message || String(error);
  let technicalDetails = `Error: ${error.message}\nStderr: ${stderr}\nExit Code: ${exitCode}`;

  // Check for Claude CLI not installed
  if (error.code === 'ENOENT') {
    category = 'claude_not_installed';
    userMessage = 'Claude Code CLI is not installed or not found in PATH';
  }
  // Check for authentication issues
  else if (stderr.match(/not authenticated/i) || stderr.match(/authentication failed/i) || stderr.match(/please log in/i)) {
    category = 'not_authenticated';
    userMessage = 'Claude CLI is not authenticated. Please run "claude auth"';
  }
  // Check for token limit exceeded
  else if (stderr.match(/token limit exceeded/i) || stderr.match(/quota exceeded/i) || stderr.match(/insufficient credits/i)) {
    category = 'out_of_tokens';
    userMessage = 'Claude API token limit has been exceeded';
  }
  // Check for rate limiting
  else if (stderr.match(/rate limit/i) || stderr.match(/too many requests/i) || stderr.match(/429/)) {
    category = 'rate_limited';
    userMessage = 'Claude API rate limit reached. Please wait before retrying';
  }
  // Check for permission denied
  else if (stderr.match(/permission denied/i) || stderr.match(/EACCES/i) || error.code === 'EACCES') {
    category = 'permission_denied';
    userMessage = 'Permission denied accessing project files or directories';
  }
  // Check for timeout
  else if (error.message && error.message.includes('timed out')) {
    category = 'execution_timeout';
    userMessage = 'Job execution exceeded the maximum timeout';
  }
  // Check for network errors
  else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    category = 'network_error';
    userMessage = 'Network error connecting to Claude API';
  }
  // Check for non-zero exit code (execution error)
  else if (exitCode !== null && exitCode !== 0) {
    category = 'execution_error';
    userMessage = `Claude CLI execution failed with exit code ${exitCode}`;
  }

  logger.debug(`Error categorized as: ${category}`);

  return {
    category,
    userMessage,
    technicalDetails
  };
}

module.exports = { categorizeError };
