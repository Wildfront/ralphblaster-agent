/**
 * Environment Variable Backward Compatibility Helper
 *
 * Provides backward-compatible access to environment variables during the
 * migration from RALPH_* to RALPHBLASTER_* naming convention.
 *
 * Priority: RALPHBLASTER_* > RALPH_* > default
 *
 * Emits deprecation warnings when old variable names are detected.
 */

const deprecationWarnings = new Set();

/**
 * Get an environment variable with backward compatibility
 * Checks for RALPHBLASTER_* first, falls back to RALPH_*
 *
 * @param {string} varName - Variable name without prefix (e.g., 'API_TOKEN')
 * @param {string|undefined} defaultValue - Default value if neither variable is set
 * @returns {string|undefined} Value from environment or default
 */
function getEnv(varName, defaultValue = undefined) {
  const newName = `RALPHBLASTER_${varName}`;
  const oldName = `RALPH_${varName}`;

  // Check new name first
  if (process.env[newName] !== undefined) {
    return process.env[newName];
  }

  // Fall back to old name
  if (process.env[oldName] !== undefined) {
    // Only show deprecation warning once per variable
    if (!deprecationWarnings.has(oldName)) {
      console.warn(`⚠️  DEPRECATION WARNING: ${oldName} is deprecated. Please use ${newName} instead.`);
      console.warn(`   Both will work during the transition period, but ${oldName} will be removed in a future version.`);
      deprecationWarnings.add(oldName);
    }
    return process.env[oldName];
  }

  return defaultValue;
}

/**
 * Parse a boolean from environment variable with backward compatibility
 * Treats 'false', '0', and empty string as false, everything else as true
 *
 * @param {string} varName - Variable name without prefix (e.g., 'CONSOLE_COLORS')
 * @param {boolean} defaultValue - Default value if not set
 * @returns {boolean}
 */
function getEnvBoolean(varName, defaultValue) {
  const value = getEnv(varName);

  if (value === undefined || value === null) {
    return defaultValue;
  }

  return value !== 'false' && value !== '0' && value !== '';
}

/**
 * Parse a positive integer from environment variable with backward compatibility
 *
 * @param {string} varName - Variable name without prefix (e.g., 'MAX_RETRIES')
 * @param {number} defaultValue - Default value if not set or invalid
 * @returns {number} Parsed positive integer
 */
function getEnvInt(varName, defaultValue) {
  const value = getEnv(varName);

  if (value === undefined || value === null) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);

  // Validate: must be a number and positive
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`Invalid numeric value "${value}" for ${varName}, using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}

/**
 * Check if any deprecated RALPH_* variables are in use
 * @returns {string[]} Array of deprecated variable names currently in use
 */
function getDeprecatedVarsInUse() {
  const knownVars = [
    'API_URL',
    'API_TOKEN',
    'MAX_RETRIES',
    'ALLOWED_PATHS',
    'LOG_LEVEL',
    'CONSOLE_COLORS',
    'CONSOLE_FORMAT',
    'AGENT_ID',
    'MAX_BATCH_SIZE',
    'FLUSH_INTERVAL',
    'USE_BATCH_ENDPOINT'
  ];

  return knownVars
    .map(varName => `RALPH_${varName}`)
    .filter(oldName => {
      const newName = oldName.replace(/^RALPH_/, 'RALPHBLASTER_');
      // Only consider it deprecated if the old var is set but new var is not
      return process.env[oldName] !== undefined && process.env[newName] === undefined;
    });
}

/**
 * Clear deprecation warnings (for testing)
 */
function clearDeprecationWarnings() {
  deprecationWarnings.clear();
}

module.exports = {
  getEnv,
  getEnvBoolean,
  getEnvInt,
  getDeprecatedVarsInUse,
  clearDeprecationWarnings
};
