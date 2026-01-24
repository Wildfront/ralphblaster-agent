require('dotenv').config();
const ConfigFileManager = require('./config-file-manager');

// Load config from ~/.ralphblasterrc
const configFileManager = new ConfigFileManager();
const fileConfig = configFileManager.read() || {};

const config = {
  // API configuration
  // Priority: 1. Environment variable, 2. ~/.ralphblasterrc, 3. Default
  apiUrl: process.env.RALPH_API_URL || fileConfig.apiUrl || 'https://app.ralphblaster.com',
  apiToken: process.env.RALPH_API_TOKEN || fileConfig.apiToken,

  // Execution configuration
  maxRetries: parseInt(process.env.RALPH_MAX_RETRIES || '3', 10),

  // Logging
  logLevel: process.env.RALPH_LOG_LEVEL || 'info',

  // Console formatting
  consoleColors: process.env.RALPH_CONSOLE_COLORS !== 'false', // Default true
  consoleFormat: process.env.RALPH_CONSOLE_FORMAT || 'pretty'  // 'pretty' or 'json'
};

// Validate required configuration
if (!config.apiToken) {
  const errorMessage = 'RALPH_API_TOKEN environment variable is required\n' +
    '\nRun "ralphblaster init --token=YOUR_TOKEN" to save your token,\n' +
    'or set the RALPH_API_TOKEN environment variable.';
  throw new Error(errorMessage);
}

module.exports = config;
