const ConfigFileManager = require('../config-file-manager');
const logger = require('../logger');
const { getEnv } = require('../utils/env-compat');

/**
 * Init Command
 * Saves RalphBlaster credentials to ~/.ralphblasterrc
 */
class InitCommand {
  constructor() {
    this.configFileManager = new ConfigFileManager();
  }

  /**
   * Run the init command
   */
  async run() {
    try {
      logger.info('Initializing RalphBlaster credentials...');

      // Get token from environment variable
      const token = getEnv('API_TOKEN');
      if (!token) {
        throw new Error('No API token provided. Please set RALPHBLASTER_API_TOKEN or pass --token=...');
      }

      // Get API URL from environment or use default
      const apiUrl = getEnv('API_URL') || 'https://hq.ralphblaster.com';

      // Save credentials to ~/.ralphblasterrc
      this.configFileManager.update({
        apiToken: token,
        apiUrl: apiUrl
      });

      // Display success message
      this.displaySuccess(apiUrl);

      process.exit(0);
    } catch (error) {
      this.handleError(error);
      process.exit(1);
    }
  }

  /**
   * Display success message
   */
  displaySuccess(apiUrl) {
    logger.info('Credentials saved successfully!');
    logger.info(`API URL: ${apiUrl}`);
    logger.info('Config saved to ~/.ralphblasterrc');
    console.log('');
    console.log('Next steps:');
    console.log('  1. cd into your project directory');
    console.log('  2. Run: ralphblaster add-project');
    console.log('  3. Then start the agent: ralphblaster');
  }

  /**
   * Handle errors with helpful messages
   */
  handleError(error) {
    logger.error(`Failed to save credentials: ${error.message}`);

    // Provide helpful guidance
    if (error.message.includes('API token')) {
      console.error('');
      console.error('Please provide your API token:');
      console.error('  ralphblaster init --token=your_token_here');
      console.error('');
      console.error('Or set environment variable:');
      console.error('  export RALPHBLASTER_API_TOKEN="your_token_here"');
      console.error('  ralphblaster init');
      console.error('');
    }
  }
}

module.exports = InitCommand;
