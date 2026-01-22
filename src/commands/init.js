const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ApiClient = require('../api-client');
const ConfigFileManager = require('../config-file-manager');
const logger = require('../logger');

/**
 * Init Command
 * Initializes the current directory as a RalphBlaster project
 */
class InitCommand {
  constructor() {
    this.cwd = process.cwd();
    this.apiClient = new ApiClient();
    this.configFileManager = new ConfigFileManager();
  }

  /**
   * Run the init command
   */
  async run() {
    try {
      logger.info('Initializing RalphBlaster project...');

      // Save token to ~/.ralphblasterrc if provided
      const token = process.env.RALPH_API_TOKEN;
      if (token) {
        this.configFileManager.update({ apiToken: token });
        logger.debug('Token saved to ~/.ralphblasterrc');
      }

      // Detect project name
      const projectName = await this.detectProjectName();
      logger.debug(`Detected project name: ${projectName}`);

      // Create project via API
      const project = await this.createProject(this.cwd, projectName);

      // Display success message
      this.displaySuccess(project, !!token);

      process.exit(0);
    } catch (error) {
      this.handleError(error);
      process.exit(1);
    }
  }

  /**
   * Detect project name from various sources
   * Priority: 1. Git remote, 2. package.json, 3. Directory name
   */
  async detectProjectName() {
    // Try git remote first
    try {
      const gitRemoteName = this.getGitRemoteName();
      if (gitRemoteName) {
        logger.debug('Using project name from Git remote');
        return gitRemoteName;
      }
    } catch (error) {
      logger.debug('Could not detect Git remote name:', error.message);
    }

    // Try package.json
    try {
      const packageJsonName = this.getPackageJsonName();
      if (packageJsonName) {
        logger.debug('Using project name from package.json');
        return packageJsonName;
      }
    } catch (error) {
      logger.debug('Could not read package.json:', error.message);
    }

    // Fallback to directory name
    logger.debug('Using directory name as project name');
    return this.getDirectoryName();
  }

  /**
   * Get project name from Git remote URL
   * Example: https://github.com/user/repo.git -> "repo"
   */
  getGitRemoteName() {
    try {
      const remote = execSync('git config --get remote.origin.url', {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (!remote) {
        return null;
      }

      // Extract repo name from URL
      // Handles: https://github.com/user/repo.git, git@github.com:user/repo.git
      const match = remote.match(/\/([^\/]+?)(\.git)?$/);
      return match ? match[1] : null;
    } catch (error) {
      // Git not initialized or no remote configured
      return null;
    }
  }

  /**
   * Get project name from package.json
   */
  getPackageJsonName() {
    const packageJsonPath = path.join(this.cwd, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.name || null;
  }

  /**
   * Get project name from directory name
   */
  getDirectoryName() {
    return path.basename(this.cwd);
  }

  /**
   * Create project via API
   */
  async createProject(systemPath, name) {
    try {
      logger.info(`Creating project: ${name}`);

      const response = await this.apiClient.client.post('/api/v1/ralph/projects', {
        system_path: systemPath,
        name: name
      });

      if (response.data && response.data.success) {
        return response.data.project;
      }

      throw new Error('Unexpected response format from API');
    } catch (error) {
      // Re-throw with more context
      if (error.response) {
        const status = error.response.status;
        const errorMessage = error.response.data?.error || error.message;

        if (status === 401) {
          throw new Error('Invalid API token. Please check your RALPH_API_TOKEN environment variable.');
        } else if (status === 403) {
          throw new Error('API token lacks "ralph_agent" permission. Please generate a new agent token.');
        } else if (status === 422) {
          throw new Error(`Validation error: ${errorMessage}`);
        } else {
          throw new Error(`API error (${status}): ${errorMessage}`);
        }
      } else if (error.request) {
        throw new Error(`Could not connect to RalphBlaster API at ${this.apiClient.client.defaults.baseURL}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Display success message
   */
  displaySuccess(project, tokenSaved = false) {
    const iconEmoji = this.getIconEmoji(project.icon);

    console.log('\n✓ Project initialized successfully!\n');
    console.log(`  Name:  ${project.name}`);
    console.log(`  Path:  ${project.system_path}`);
    console.log(`  Icon:  ${iconEmoji}`);
    console.log(`  Color: ${this.formatColorName(project.color)}\n`);

    if (tokenSaved) {
      console.log('✓ API token saved to ~/.ralphblasterrc\n');
      console.log('You can now run "ralphblaster" without passing the token.\n');
    }

    console.log('You can now create tasks for this project in RalphBlaster.\n');
  }

  /**
   * Convert icon name to emoji
   */
  getIconEmoji(icon) {
    // If it's already an emoji, return it
    if (icon && icon.match(/[\u{1F300}-\u{1F9FF}]/u)) {
      return icon;
    }

    // Map Heroicon names to emojis
    const iconMap = {
      'folder': '📁',
      'rocket': '🚀',
      'beaker': '🧪',
      'globe-alt': '🌍',
      'device-phone-mobile': '📱',
      'chart-bar': '📊',
      'code': '💻',
      'academic-cap': '🎓',
      'light-bulb': '💡',
      'megaphone': '📣',
      'briefcase': '💼',
      'cube': '🎲',
      'puzzle-piece': '🧩',
      'sparkles': '✨',
      'fire': '🔥',
      'star': '⭐',
      'heart': '❤️',
      'bolt': '⚡',
      'shield': '🛡️',
      'cloud': '☁️'
    };

    return iconMap[icon] || '📁';
  }

  /**
   * Format color name for display
   */
  formatColorName(color) {
    if (!color) return 'Blue';

    // If it's a hex color, return as-is
    if (color.startsWith('#')) {
      return color;
    }

    // Convert snake_case to Title Case
    return color
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Handle errors with helpful messages
   */
  handleError(error) {
    logger.error('Failed to initialize project:', error.message);

    // Provide helpful guidance based on error type
    if (error.message.includes('API token')) {
      console.error('\nPlease ensure your API token is set:');
      console.error('  export RALPH_API_TOKEN="your_token_here"');
      console.error('\nOr run with --token flag:');
      console.error('  ralphblaster-agent init --token="your_token_here"\n');
    } else if (error.message.includes('Could not connect')) {
      console.error('\nPlease check:');
      console.error('  1. Your internet connection');
      console.error('  2. RalphBlaster API URL is correct');
      console.error('  3. No firewall is blocking the connection\n');
    }
  }
}

module.exports = InitCommand;
