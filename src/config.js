require('dotenv').config();

const config = {
  // API configuration
  apiUrl: process.env.RALPH_API_URL || 'http://localhost:5002',
  apiToken: process.env.RALPH_API_TOKEN,

  // Polling configuration
  pollInterval: parseInt(process.env.RALPH_POLL_INTERVAL || '5000', 10), // 5 seconds default

  // Execution configuration
  maxRetries: parseInt(process.env.RALPH_MAX_RETRIES || '3', 10),

  // Logging
  logLevel: process.env.RALPH_LOG_LEVEL || 'info'
};

// Validate required configuration
if (!config.apiToken) {
  console.error('Error: RALPH_API_TOKEN environment variable is required');
  process.exit(1);
}

module.exports = config;
