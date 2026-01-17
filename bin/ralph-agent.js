#!/usr/bin/env node

const RalphAgent = require('../src/index');
const logger = require('../src/logger');

// Parse command line arguments
const args = process.argv.slice(2);

// Check for --token flag
const tokenIndex = args.findIndex(arg => arg.startsWith('--token='));
if (tokenIndex !== -1) {
  const token = args[tokenIndex].split('=')[1];
  if (token) {
    process.env.RALPH_API_TOKEN = token;
  }
}

// Check for --api-url flag
const apiUrlIndex = args.findIndex(arg => arg.startsWith('--api-url='));
if (apiUrlIndex !== -1) {
  const apiUrl = args[apiUrlIndex].split('=')[1];
  if (apiUrl) {
    process.env.RALPH_API_URL = apiUrl;
  }
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Ralph Agent - Autonomous coding agent for Ralph

Usage:
  ralph-agent [options]

Options:
  --token=<token>       API token for authentication (required)
  --api-url=<url>       API base URL (default: http://localhost:5002)
  --help, -h            Show this help message

Environment Variables:
  RALPH_API_TOKEN       API token (required if not using --token)
  RALPH_API_URL         API base URL (default: http://localhost:5002)
  RALPH_POLL_INTERVAL   Polling interval in ms (default: 5000)
  RALPH_LOG_LEVEL       Log level: error, warn, info, debug (default: info)

Examples:
  # Run with token from command line
  ralph-agent --token=your_token_here

  # Run with environment variable
  RALPH_API_TOKEN=your_token_here ralph-agent

  # Run with custom API URL
  ralph-agent --token=your_token --api-url=http://localhost:3000

  # Use npx
  npx ralph-agent --token=your_token_here
  `);
  process.exit(0);
}

// Check for version
if (args.includes('--version') || args.includes('-v')) {
  const packageJson = require('../package.json');
  console.log(`ralph-agent v${packageJson.version}`);
  process.exit(0);
}

// Start the agent
const agent = new RalphAgent();

logger.info('');
logger.info('╔═══════════════════════════════════════╗');
logger.info('║      Ralph Agent Starting...          ║');
logger.info('╚═══════════════════════════════════════╝');
logger.info('');

agent.start().catch(error => {
  logger.error('Fatal error starting agent', error);
  process.exit(1);
});
