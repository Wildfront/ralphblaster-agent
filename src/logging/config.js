/**
 * Centralized logging configuration
 *
 * This module consolidates all logging-related configuration from:
 * - src/config.js (logLevel, consoleColors, consoleFormat)
 * - src/setup-log-batcher.js (maxBatchSize, flushInterval, useBatchEndpoint)
 * - Environment variables (RALPH_LOG_LEVEL, RALPH_CONSOLE_COLORS, RALPH_CONSOLE_FORMAT, RALPH_AGENT_ID)
 *
 * @module logging/config
 */

/**
 * Valid log levels in order of severity
 * @type {string[]}
 */
const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

/**
 * Valid console format options
 * @type {string[]}
 */
const VALID_CONSOLE_FORMATS = ['pretty', 'json'];

/**
 * Validate that a log level is valid
 * @param {string} level - Log level to validate
 * @returns {boolean} True if valid
 */
function isValidLogLevel(level) {
  return VALID_LOG_LEVELS.includes(level);
}

/**
 * Validate that a console format is valid
 * @param {string} format - Console format to validate
 * @returns {boolean} True if valid
 */
function isValidConsoleFormat(format) {
  return VALID_CONSOLE_FORMATS.includes(format);
}

/**
 * Parse a boolean from environment variable
 * Treats 'false', '0', and empty string as false, everything else as true
 * @param {string|undefined} value - Environment variable value
 * @param {boolean} defaultValue - Default value if not set
 * @returns {boolean}
 */
function parseEnvBoolean(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return value !== 'false' && value !== '0' && value !== '';
}

/**
 * Parse a positive integer from environment variable
 * @param {string|undefined} value - Environment variable value
 * @param {number} defaultValue - Default value if not set or invalid
 * @returns {number} Parsed positive integer
 */
function parsePositiveInt(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);

  // Validate: must be a number and positive
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`Invalid numeric value "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}

// Read configuration from environment variables with validation
const rawLogLevel = process.env.RALPH_LOG_LEVEL || 'info';
const logLevel = isValidLogLevel(rawLogLevel) ? rawLogLevel : 'info';

// Warn if invalid log level was provided
if (!isValidLogLevel(rawLogLevel)) {
  console.warn(`Invalid log level "${rawLogLevel}", using default: info. Valid levels: ${VALID_LOG_LEVELS.join(', ')}`);
}

const rawConsoleFormat = process.env.RALPH_CONSOLE_FORMAT || 'pretty';
const consoleFormat = isValidConsoleFormat(rawConsoleFormat) ? rawConsoleFormat : 'pretty';

// Warn if invalid console format was provided
if (!isValidConsoleFormat(rawConsoleFormat)) {
  console.warn(`Invalid console format "${rawConsoleFormat}", using default: pretty. Valid formats: ${VALID_CONSOLE_FORMATS.join(', ')}`);
}

/**
 * Centralized logging configuration object
 * All logging-related settings are defined here in one place
 */
const loggingConfig = {
  // ===== Console Output Settings =====

  /**
   * Log level - controls which messages are displayed
   * Priority: Environment variable (RALPH_LOG_LEVEL) > Default
   * @type {'error' | 'warn' | 'info' | 'debug'}
   * @default 'info'
   */
  logLevel,

  /**
   * Enable/disable colored console output
   * Priority: Environment variable (RALPH_CONSOLE_COLORS) > Default
   * Set to 'false' to disable colors (useful for log files or CI environments)
   * @type {boolean}
   * @default true
   */
  consoleColors: parseEnvBoolean(process.env.RALPH_CONSOLE_COLORS, true),

  /**
   * Console output format
   * Priority: Environment variable (RALPH_CONSOLE_FORMAT) > Default
   * - 'pretty': Human-readable format with colors (default)
   * - 'json': Structured JSON format for machine parsing
   * @type {'pretty' | 'json'}
   * @default 'pretty'
   */
  consoleFormat,

  // ===== Log Batching Settings =====
  // These settings control how logs are batched before being sent to the API
  // to reduce the number of API calls and improve performance

  /**
   * Maximum number of logs to batch before forcing a flush
   * Larger values reduce API calls but may delay log visibility
   * @type {number}
   * @default 10
   */
  maxBatchSize: parsePositiveInt(process.env.RALPH_MAX_BATCH_SIZE, 10),

  /**
   * Time in milliseconds between automatic log flushes
   * Smaller values improve log visibility but increase API calls
   * @type {number}
   * @default 2000 (2 seconds)
   */
  flushInterval: parsePositiveInt(process.env.RALPH_FLUSH_INTERVAL, 2000),

  /**
   * Whether to use the batch endpoint for sending logs
   * When true, tries to send logs in a single batch API call
   * Falls back to individual calls if batch endpoint fails
   * @type {boolean}
   * @default true
   */
  useBatchEndpoint: parseEnvBoolean(process.env.RALPH_USE_BATCH_ENDPOINT, true),

  // ===== Agent Identification =====

  /**
   * Agent ID for multi-agent support
   * Priority: Environment variable (RALPH_AGENT_ID) > Default
   * Used to identify which agent instance is running in multi-agent deployments
   * @type {string}
   * @default 'agent-default'
   */
  agentId: process.env.RALPH_AGENT_ID || 'agent-default',

  // ===== Validation Helpers =====

  /**
   * Valid log levels
   * @type {string[]}
   * @readonly
   */
  validLogLevels: VALID_LOG_LEVELS,

  /**
   * Valid console formats
   * @type {string[]}
   * @readonly
   */
  validConsoleFormats: VALID_CONSOLE_FORMATS
};

// Freeze the configuration to prevent accidental modifications
Object.freeze(loggingConfig);

module.exports = loggingConfig;
