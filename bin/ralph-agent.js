#!/usr/bin/env node

// Parse command line arguments BEFORE loading modules that use config
const args = process.argv.slice(2);

// Check for --token flag
const tokenIndex = args.findIndex(arg => arg.startsWith('--token='));
if (tokenIndex !== -1) {
  const token = args[tokenIndex].split('=')[1];
  if (!token || token.trim() === '') {
    console.error('Error: --token flag requires a value');
    process.exit(1);
  }
  process.env.RALPH_API_TOKEN = token;
}

// Check for --api-url flag
const apiUrlIndex = args.findIndex(arg => arg.startsWith('--api-url='));
if (apiUrlIndex !== -1) {
  const apiUrl = args[apiUrlIndex].split('=')[1];
  if (!apiUrl || apiUrl.trim() === '') {
    console.error('Error: --api-url flag requires a value');
    process.exit(1);
  }
  process.env.RALPH_API_URL = apiUrl;
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Ralph Agent - Autonomous coding agent for Ralph

Usage:
  ralph-agent [options]

Options:
  --token=<token>       API token for authentication (required)
  --api-url=<url>       API base URL (default: https://ralphblaster.com)
  --help, -h            Show this help message

Environment Variables:
  RALPH_API_TOKEN       API token (required if not using --token)
  RALPH_API_URL         API base URL (default: https://ralphblaster.com)
  RALPH_LOG_LEVEL       Log level: error, warn, info, debug (default: info)
  RALPH_ALLOWED_PATHS   Colon-separated list of allowed base paths for projects
                        (optional security whitelist, e.g., /Users/me/projects:/home/me/work)

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

// Load modules AFTER environment variables are set
const RalphAgent = require('../src/index');
const logger = require('../src/logger');

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
