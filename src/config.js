require('dotenv').config();
const ConfigFileManager = require('./config-file-manager');
const loggingConfig = require('./logging/config');
const { getEnv, getEnvInt } = require('./utils/env-compat');

// Load config from ~/.ralphblasterrc
const configFileManager = new ConfigFileManager();
const fileConfig = configFileManager.read() || {};

const config = {
  // API configuration
  // Priority: 1. Environment variable (RALPHBLASTER_* or RALPH_*), 2. ~/.ralphblasterrc, 3. Default
  apiUrl: getEnv('API_URL') || fileConfig.apiUrl || 'https://hq.ralphblaster.com',
  apiToken: getEnv('API_TOKEN') || fileConfig.apiToken,

  // Execution configuration
  maxRetries: getEnvInt('MAX_RETRIES', 3),

  // Agent limit configuration
  maxAgentsPerUser: getEnvInt('MAX_AGENTS_PER_USER', 10),

  // Logging configuration (imported from centralized logging/config.js)
  // These are re-exported here for backward compatibility
  logLevel: loggingConfig.logLevel,
  consoleColors: loggingConfig.consoleColors,
  consoleFormat: loggingConfig.consoleFormat
};

// Validate required configuration
if (!config.apiToken) {
  const errorMessage = 'RALPHBLASTER_API_TOKEN (or RALPH_API_TOKEN) environment variable is required\n' +
    '\nRun "ralphblaster init --token=YOUR_TOKEN" to save your token,\n' +
    'or set the RALPHBLASTER_API_TOKEN environment variable.';
  throw new Error(errorMessage);
}

// Security: Ensure TLS certificate validation is enabled
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  throw new Error(
    'CRITICAL SECURITY ERROR: TLS certificate validation is disabled!\n' +
    'NODE_TLS_REJECT_UNAUTHORIZED=0 is extremely dangerous and allows man-in-the-middle attacks.\n' +
    'Remove this environment variable immediately.'
  );
}

module.exports = config;
