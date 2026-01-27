#!/usr/bin/env node

// Parse command line arguments BEFORE loading modules that use config
const args = process.argv.slice(2);

// Check for --agents flag (multi-agent mode)
const agentsIndex = args.findIndex(arg => arg.startsWith('--agents='));
let agentCount = null;
if (agentsIndex !== -1) {
  agentCount = parseInt(args[agentsIndex].split('=')[1], 10);
  if (isNaN(agentCount) || agentCount < 1 || agentCount > 20) {
    console.error('Error: --agents flag requires a number between 1 and 20');
    process.exit(1);
  }
}

// Check for --token flag
const tokenIndex = args.findIndex(arg => arg.startsWith('--token='));
if (tokenIndex !== -1) {
  const token = args[tokenIndex].split('=')[1];
  if (!token || token.trim() === '') {
    console.error('Error: --token flag requires a value');
    process.exit(1);
  }
  // Set both old and new variable names for backward compatibility
  process.env.RALPHBLASTER_API_TOKEN = token;
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
  // Set both old and new variable names for backward compatibility
  process.env.RALPHBLASTER_API_URL = apiUrl;
  process.env.RALPH_API_URL = apiUrl;
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
RalphBlaster Agent - Autonomous coding agent for RalphBlaster

Usage:
  ralphblaster [options]
  ralphblaster init [options]
  ralphblaster add-project

Commands:
  (default)             Start the agent in polling mode
  init                  Save credentials to ~/.ralphblasterrc
  add-project           Register current directory as a RalphBlaster project

Options:
  --agents=<count>      Run multiple agents concurrently (1-20, default: 1)
  --token=<token>       API token for authentication
  --api-url=<url>       API base URL (default: https://hq.ralphblaster.com)
  --help, -h            Show this help message

Getting Started:
  1. Save your credentials:
     ralphblaster init --token=fm6ibAG6vamdjtbG5snuD3F4

  2. Register your project (run in project directory):
     ralphblaster add-project

  3. Start the agent:
     ralphblaster

Configuration:
  Token is loaded from (in order of priority):
  1. --token flag
  2. RALPHBLASTER_API_TOKEN (or RALPH_API_TOKEN) environment variable
  3. ~/.ralphblasterrc config file

Environment Variables:
  RALPHBLASTER_API_TOKEN       API token (RALPH_API_TOKEN also supported)
  RALPHBLASTER_API_URL         API base URL (RALPH_API_URL also supported)
  RALPHBLASTER_LOG_LEVEL       Log level: error, warn, info, debug (default: info)
  RALPHBLASTER_ALLOWED_PATHS   Colon-separated list of allowed base paths
                               (optional security whitelist)
  RALPHBLASTER_AGENT_ID        Agent identifier for multi-agent setups

  Note: RALPH_* variables are supported for backward compatibility but deprecated.

Examples:
  # First time setup - save credentials
  ralphblaster init --token=your_token_here --api-url=https://hq.ralphblaster.com

  # Register project with API
  cd /path/to/your/project
  ralphblaster add-project

  # Start single agent (uses token from ~/.ralphblasterrc)
  ralphblaster

  # Run 3 agents concurrently for parallel job processing
  ralphblaster --agents=3

  # Run with environment variable (if not using ~/.ralphblasterrc)
  RALPHBLASTER_API_TOKEN=your_token_here ralphblaster

  # Run with custom API URL
  ralphblaster --api-url=http://localhost:3000

  # Use with npm
  npm start -- --agents=3
  `);
  process.exit(0);
}

// Check for version
if (args.includes('--version') || args.includes('-v')) {
  const packageJson = require('../package.json');
  console.log(`ralphblaster v${packageJson.version}`);
  process.exit(0);
}

// Check for init command
if (args.includes('init')) {
  const InitCommand = require('../src/commands/init');
  const initCmd = new InitCommand();
  initCmd.run().catch(error => {
    // Error handling is done in InitCommand.handleError
    // Just exit with error code
  });
  return; // Don't start agent polling loop
}

// Check for add-project command (alias for init)
if (args.includes('add-project')) {
  const AddProjectCommand = require('../src/commands/add-project');
  const addProjectCmd = new AddProjectCommand();
  addProjectCmd.run().catch(error => {
    // Error handling is done in AddProjectCommand.handleError
    // Just exit with error code
  });
  return; // Don't start agent polling loop
}

// Multi-agent mode: Launch multiple agent processes
if (agentCount && agentCount > 1) {
  const { spawn } = require('child_process');
  const path = require('path');

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(`║  RalphBlaster Multi-Agent Manager - Starting ${agentCount} agents  ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const agents = [];
  const agentProcesses = [];

  // Cleanup function for graceful shutdown
  const cleanup = () => {
    console.log('\n\nShutting down all agents...');
    agentProcesses.forEach((proc, index) => {
      if (proc && !proc.killed) {
        console.log(`  Stopping agent-${index + 1} (PID: ${proc.pid})`);
        proc.kill('SIGTERM');
      }
    });
    setTimeout(() => {
      console.log('All agents stopped');
      process.exit(0);
    }, 500);
  };

  // Setup signal handlers
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Launch each agent
  for (let i = 1; i <= agentCount; i++) {
    const agentId = `agent-${i}`;

    // Spawn agent process with unique ID
    const agentProcess = spawn('node', [path.join(__dirname, 'ralphblaster.js')], {
      env: {
        ...process.env,
        RALPHBLASTER_AGENT_ID: agentId,
        RALPH_AGENT_ID: agentId  // Set both for backward compatibility
      },
      stdio: 'inherit' // Share stdio with parent for unified logging
    });

    agentProcesses.push(agentProcess);

    // Handle agent exit
    agentProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`\nAgent ${agentId} exited with code ${code}`);
      }

      // If any agent dies unexpectedly, shut down all
      if (signal || (code && code !== 0)) {
        console.error(`\nAgent ${agentId} failed, shutting down all agents...`);
        cleanup();
      }
    });

    console.log(`✓ Started ${agentId} (PID: ${agentProcess.pid})`);
  }

  console.log('');
  console.log(`All ${agentCount} agents launched. Press Ctrl+C to stop all agents`);
  console.log('');

  // Keep process alive
  return;
}

// Single agent mode (default)
// Load modules AFTER environment variables are set
// Wrap in try-catch to handle config errors gracefully
let RalphAgent, logger;
try {
  RalphAgent = require('../src/index');
  logger = require('../src/logger');
} catch (error) {
  // Handle config errors (e.g., missing API token)
  console.error('Error: ' + error.message);
  process.exit(1);
}

// Start the agent
const agent = new RalphAgent();

logger.info('');
logger.info('╔═══════════════════════════════════════════╗');
logger.info('║   RalphBlaster Agent Starting...          ║');
logger.info('╚═══════════════════════════════════════════╝');
logger.info('');

agent.start().catch(error => {
  logger.error('Fatal error starting agent: ' + (error?.message || error));
  console.error(error); // Also log full error with stack trace
  process.exit(1);
});
