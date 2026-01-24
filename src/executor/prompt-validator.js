const logger = require('../logger');

/**
 * Validate prompt to prevent injection attacks
 * @param {string} prompt - Prompt to validate
 * @throws {Error} If prompt contains dangerous content
 * @returns {boolean} True if validation passes
 */
function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  // Check prompt length (prevent DoS via massive prompts)
  const MAX_PROMPT_LENGTH = 500000; // 500KB
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`);
  }

  // Check for dangerous patterns that could lead to malicious operations
  const dangerousPatterns = [
    { pattern: /rm\s+-rf\s+\//i, description: 'dangerous deletion command' },
    { pattern: /rm\s+-rf\s+~/i, description: 'dangerous home directory deletion' },
    { pattern: /\/etc\/passwd/i, description: 'system file access' },
    { pattern: /\/etc\/shadow/i, description: 'password file access' },
    { pattern: /curl.*\|\s*sh/i, description: 'remote code execution pattern' },
    { pattern: /wget.*\|\s*sh/i, description: 'remote code execution pattern' },
    { pattern: /eval\s*\(/i, description: 'code evaluation' },
    { pattern: /exec\s*\(/i, description: 'code execution' },
    { pattern: /\$\(.*rm.*-rf/i, description: 'command injection with deletion' },
    { pattern: /`.*rm.*-rf/i, description: 'command injection with deletion' },
    { pattern: /base64.*decode.*eval/i, description: 'obfuscated code execution' },
    { pattern: /\.ssh\/id_rsa/i, description: 'SSH key access' },
    { pattern: /\.aws\/credentials/i, description: 'AWS credentials access' }
  ];

  for (const { pattern, description } of dangerousPatterns) {
    if (pattern.test(prompt)) {
      logger.error(`Prompt validation failed: contains ${description}`);
      throw new Error(`Prompt contains potentially dangerous content: ${description}`);
    }
  }

  // Log sanitized version for security audit
  const sanitizedPreview = prompt.substring(0, 200).replace(/\n/g, ' ');
  logger.debug(`Prompt validated (${prompt.length} chars): ${sanitizedPreview}...`);

  return true;
}

module.exports = { validatePrompt };
