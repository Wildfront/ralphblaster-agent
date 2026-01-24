const fs = require('fs');
const path = require('path');
const logger = require('../logger');

/**
 * PathHelper - Utility for project path validation and sanitization
 *
 * Provides high-level path validation methods that combine path sanitization
 * with existence checks and fallback logic for job handlers.
 */
class PathHelper {
  /**
   * Create a new PathHelper
   * @param {Object} pathValidator - Path validator with validateAndSanitizePath method
   */
  constructor(pathValidator) {
    this.pathValidator = pathValidator;
  }

  /**
   * Validate project path with strict mode (for code execution)
   * Throws an error if the path is invalid or doesn't exist.
   *
   * @param {string} projectPath - Project path to validate
   * @param {string} jobType - Job type for error messages (e.g., 'code_execution')
   * @returns {string} Sanitized absolute path
   * @throws {Error} If path is invalid or doesn't exist
   */
  validateProjectPathStrict(projectPath, jobType = 'job') {
    // Validate and sanitize project path
    const sanitizedPath = this.pathValidator.validateAndSanitizePath(projectPath);
    if (!sanitizedPath) {
      throw new Error(`Invalid or unsafe project path: ${projectPath}`);
    }

    // Validate project path exists
    if (!fs.existsSync(sanitizedPath)) {
      throw new Error(`Project path does not exist: ${sanitizedPath}`);
    }

    logger.debug(`Project path validated (strict): ${sanitizedPath}`);
    return sanitizedPath;
  }

  /**
   * Validate project path with fallback to current directory (for PRD/questions)
   * Returns the sanitized path if valid and exists, otherwise falls back to cwd.
   *
   * @param {string|null} projectPath - Optional project path to validate
   * @param {string} defaultPath - Default path to use as fallback (defaults to process.cwd())
   * @returns {string} Sanitized absolute path or fallback path
   */
  validateProjectPathWithFallback(projectPath, defaultPath = process.cwd()) {
    // If no project path provided, use default
    if (!projectPath) {
      logger.info('No project path provided, using default directory', { workingDir: defaultPath });
      return defaultPath;
    }

    logger.info('Project path provided, validating...', { path: projectPath });
    const sanitizedPath = this.pathValidator.validateAndSanitizePath(projectPath);

    // Check if sanitized path is valid and exists
    if (sanitizedPath && fs.existsSync(sanitizedPath)) {
      logger.info('Using project directory', { workingDir: sanitizedPath });
      return sanitizedPath;
    } else {
      logger.warn(`Invalid or missing project path, using default directory: ${defaultPath}`);
      return defaultPath;
    }
  }
}

module.exports = PathHelper;
