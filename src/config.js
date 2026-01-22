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
  logLevel: process.env.RALPH_LOG_LEVEL || 'info'
};

// Validate required configuration
if (!config.apiToken) {
  console.error('Error: RALPH_API_TOKEN environment variable is required');
  console.error('\nRun "ralphblaster init --token=YOUR_TOKEN" to save your token,');
  console.error('or set the RALPH_API_TOKEN environment variable.');
  process.exit(1);
}

module.exports = config;
