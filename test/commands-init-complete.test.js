const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

jest.mock('fs');
jest.mock('child_process');
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'info'
}));
jest.mock('../src/api-client');

const InitCommand = require('../src/commands/init');
const ApiClient = require('../src/api-client');
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

// Mock console methods
global.console = {
  log: jest.fn(),
  error: jest.fn()
};

describe('InitCommand - Complete Coverage', () => {
  let initCommand;
  let mockApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();

    mockApiClient = {
      client: {
        post: jest.fn(),
        defaults: {
          baseURL: 'https://test-api.com'
        }
      }
    };

    ApiClient.mockImplementation(() => mockApiClient);
    initCommand = new InitCommand();
  });

  describe('run()', () => {
    test('runs successful init flow', async () => {
      const logger = require('../src/logger');

      initCommand.detectProjectName = jest.fn().mockResolvedValue('test-project');
      initCommand.createProject = jest.fn().mockResolvedValue({
        name: 'test-project',
        system_path: '/test/path',
        icon: 'rocket',
        color: 'blue'
      });
      initCommand.displaySuccess = jest.fn();

      await initCommand.run();

      expect(logger.info).toHaveBeenCalledWith('Initializing RalphBlaster project...');
      expect(initCommand.detectProjectName).toHaveBeenCalled();
      expect(initCommand.createProject).toHaveBeenCalled();
      expect(initCommand.displaySuccess).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    test('detects and logs project name', async () => {
      const logger = require('../src/logger');

      initCommand.detectProjectName = jest.fn().mockResolvedValue('my-project');
      initCommand.createProject = jest.fn().mockResolvedValue({
        name: 'my-project',
        system_path: '/test',
        icon: 'folder',
        color: 'green'
      });
      initCommand.displaySuccess = jest.fn();

      await initCommand.run();

      expect(logger.debug).toHaveBeenCalledWith('Detected project name: my-project');
    });

    test('creates project via API', async () => {
      initCommand.detectProjectName = jest.fn().mockResolvedValue('project');
      initCommand.createProject = jest.fn().mockResolvedValue({
        name: 'project',
        system_path: process.cwd(),
        icon: 'folder',
        color: 'blue'
      });
      initCommand.displaySuccess = jest.fn();

      await initCommand.run();

      expect(initCommand.createProject).toHaveBeenCalledWith(
        process.cwd(),
        'project'
      );
    });

    test('handles errors and exits with code 1', async () => {
      initCommand.detectProjectName = jest.fn().mockRejectedValue(new Error('Test error'));
      initCommand.handleError = jest.fn();

      await initCommand.run();

      expect(initCommand.handleError).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    test('calls handleError on failure', async () => {
      const error = new Error('API error');
      initCommand.detectProjectName = jest.fn().mockRejectedValue(error);
      initCommand.handleError = jest.fn();

      await initCommand.run();

      expect(initCommand.handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('detectProjectName()', () => {
    test('uses Git remote name when available', async () => {
      const logger = require('../src/logger');
      initCommand.getGitRemoteName = jest.fn().mockReturnValue('repo-from-git');

      const name = await initCommand.detectProjectName();

      expect(name).toBe('repo-from-git');
      expect(logger.debug).toHaveBeenCalledWith('Using project name from Git remote');
    });

    test('uses package.json name when Git remote fails', async () => {
      const logger = require('../src/logger');
      initCommand.getGitRemoteName = jest.fn().mockImplementation(() => {
        throw new Error('No git remote');
      });
      initCommand.getPackageJsonName = jest.fn().mockReturnValue('pkg-name');

      const name = await initCommand.detectProjectName();

      expect(name).toBe('pkg-name');
      expect(logger.debug).toHaveBeenCalledWith('Using project name from package.json');
    });

    test('falls back to directory name', async () => {
      const logger = require('../src/logger');
      initCommand.getGitRemoteName = jest.fn().mockReturnValue(null);
      initCommand.getPackageJsonName = jest.fn().mockReturnValue(null);
      initCommand.getDirectoryName = jest.fn().mockReturnValue('directory-name');

      const name = await initCommand.detectProjectName();

      expect(name).toBe('directory-name');
      expect(logger.debug).toHaveBeenCalledWith('Using directory name as project name');
    });

    test('follows priority order: Git > package.json > directory', async () => {
      initCommand.getGitRemoteName = jest.fn().mockReturnValue(null);
      initCommand.getPackageJsonName = jest.fn().mockReturnValue('from-package');
      initCommand.getDirectoryName = jest.fn().mockReturnValue('from-dir');

      const name = await initCommand.detectProjectName();

      expect(name).toBe('from-package');
      expect(initCommand.getDirectoryName).not.toHaveBeenCalled();
    });

    test('logs debug message when Git remote fails', async () => {
      const logger = require('../src/logger');
      const error = new Error('Git not initialized');
      initCommand.getGitRemoteName = jest.fn().mockImplementation(() => {
        throw error;
      });
      initCommand.getPackageJsonName = jest.fn().mockReturnValue('fallback');

      await initCommand.detectProjectName();

      expect(logger.debug).toHaveBeenCalledWith(
        'Could not detect Git remote name:',
        error.message
      );
    });

    test('logs debug message when package.json fails', async () => {
      const logger = require('../src/logger');
      const error = new Error('No package.json');
      initCommand.getGitRemoteName = jest.fn().mockReturnValue(null);
      initCommand.getPackageJsonName = jest.fn().mockImplementation(() => {
        throw error;
      });
      initCommand.getDirectoryName = jest.fn().mockReturnValue('fallback');

      await initCommand.detectProjectName();

      expect(logger.debug).toHaveBeenCalledWith(
        'Could not read package.json:',
        error.message
      );
    });
  });

  describe('getGitRemoteName()', () => {
    test('extracts name from HTTPS URL', () => {
      execSync.mockReturnValue('https://github.com/user/my-repo.git\n');

      const name = initCommand.getGitRemoteName();

      expect(name).toBe('my-repo');
    });

    test('extracts name from SSH URL', () => {
      execSync.mockReturnValue('git@github.com:user/my-repo.git\n');

      const name = initCommand.getGitRemoteName();

      expect(name).toBe('my-repo');
    });

    test('handles URL with .git suffix', () => {
      execSync.mockReturnValue('https://gitlab.com/user/project.git\n');

      const name = initCommand.getGitRemoteName();

      expect(name).toBe('project');
    });

    test('handles URL without .git suffix', () => {
      execSync.mockReturnValue('https://github.com/user/repo\n');

      const name = initCommand.getGitRemoteName();

      expect(name).toBe('repo');
    });

    test('returns null when Git not initialized', () => {
      execSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const name = initCommand.getGitRemoteName();

      expect(name).toBeNull();
    });

    test('returns null when no origin configured', () => {
      execSync.mockReturnValue('');

      const name = initCommand.getGitRemoteName();

      expect(name).toBeNull();
    });

    test('executes git command in correct directory', () => {
      execSync.mockReturnValue('https://github.com/user/repo.git\n');

      initCommand.getGitRemoteName();

      expect(execSync).toHaveBeenCalledWith(
        'git config --get remote.origin.url',
        expect.objectContaining({ cwd: initCommand.cwd })
      );
    });
  });

  describe('getPackageJsonName()', () => {
    test('extracts name from package.json', () => {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ name: 'my-package' }));

      const name = initCommand.getPackageJsonName();

      expect(name).toBe('my-package');
      expect(fs.readFileSync).toHaveBeenCalledWith(packageJsonPath, 'utf8');
    });

    test('returns null when package.json does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const name = initCommand.getPackageJsonName();

      expect(name).toBeNull();
    });

    test('returns null when name field missing', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const name = initCommand.getPackageJsonName();

      expect(name).toBeNull();
    });

    test('handles invalid JSON gracefully', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{ invalid json }');

      expect(() => initCommand.getPackageJsonName()).toThrow();
    });
  });

  describe('getDirectoryName()', () => {
    test('extracts directory name from current path', () => {
      const name = initCommand.getDirectoryName();

      expect(name).toBe(path.basename(process.cwd()));
    });

    test('returns different names for different cwds', () => {
      const cmd1 = new InitCommand();
      cmd1.cwd = '/path/to/project-a';

      const cmd2 = new InitCommand();
      cmd2.cwd = '/path/to/project-b';

      expect(path.basename(cmd1.cwd)).toBe('project-a');
      expect(path.basename(cmd2.cwd)).toBe('project-b');
    });
  });

  describe('createProject()', () => {
    test('creates project with valid parameters', async () => {
      mockApiClient.client.post.mockResolvedValue({
        data: {
          success: true,
          project: {
            id: 1,
            name: 'test-project',
            system_path: '/test/path'
          }
        }
      });

      const project = await initCommand.createProject('/test/path', 'test-project');

      expect(project.name).toBe('test-project');
      expect(mockApiClient.client.post).toHaveBeenCalledWith(
        '/api/v1/ralph/projects',
        {
          system_path: '/test/path',
          name: 'test-project'
        }
      );
    });

    test('handles unexpected response format', async () => {
      mockApiClient.client.post.mockResolvedValue({
        data: {}
      });

      await expect(initCommand.createProject('/test', 'name'))
        .rejects.toThrow('Unexpected response format from API');
    });

    test('handles 401 unauthorized error', async () => {
      const error = new Error('Unauthorized');
      error.response = {
        status: 401,
        data: { error: 'Invalid token' }
      };
      mockApiClient.client.post.mockRejectedValue(error);

      await expect(initCommand.createProject('/test', 'name'))
        .rejects.toThrow('Invalid API token');
    });

    test('handles 403 forbidden error', async () => {
      const error = new Error('Forbidden');
      error.response = {
        status: 403,
        data: { error: 'Missing permission' }
      };
      mockApiClient.client.post.mockRejectedValue(error);

      await expect(initCommand.createProject('/test', 'name'))
        .rejects.toThrow('API token lacks "ralph_agent" permission');
    });

    test('handles 422 validation error', async () => {
      const error = new Error('Validation');
      error.response = {
        status: 422,
        data: { error: 'Name is required' }
      };
      mockApiClient.client.post.mockRejectedValue(error);

      await expect(initCommand.createProject('/test', ''))
        .rejects.toThrow('Validation error: Name is required');
    });

    test('handles other error codes', async () => {
      const error = new Error('Server error');
      error.response = {
        status: 500,
        data: { error: 'Internal server error' }
      };
      mockApiClient.client.post.mockRejectedValue(error);

      await expect(initCommand.createProject('/test', 'name'))
        .rejects.toThrow('API error (500): Internal server error');
    });

    test('handles network errors', async () => {
      const error = new Error('Network error');
      error.request = {};
      mockApiClient.client.post.mockRejectedValue(error);

      await expect(initCommand.createProject('/test', 'name'))
        .rejects.toThrow('Could not connect to RalphBlaster API');
    });

    test('handles connection refused', async () => {
      const error = new Error('ECONNREFUSED');
      error.request = {};
      mockApiClient.client.post.mockRejectedValue(error);

      await expect(initCommand.createProject('/test', 'name'))
        .rejects.toThrow('Could not connect');
    });

    test('logs project creation', async () => {
      const logger = require('../src/logger');
      mockApiClient.client.post.mockResolvedValue({
        data: {
          success: true,
          project: { name: 'test', system_path: '/test' }
        }
      });

      await initCommand.createProject('/test', 'test');

      expect(logger.info).toHaveBeenCalledWith('Creating project: test');
    });
  });

  describe('displaySuccess()', () => {
    test('displays success message with project details', () => {
      const project = {
        name: 'My Project',
        system_path: '/path/to/project',
        icon: 'rocket',
        color: 'blue'
      };

      initCommand.displaySuccess(project);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Project initialized successfully')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('My Project')
      );
    });

    test('formats icon emoji correctly', () => {
      const project = {
        name: 'Test',
        system_path: '/test',
        icon: 'rocket',
        color: 'blue'
      };

      initCommand.displaySuccess(project);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('🚀')
      );
    });

    test('formats color name correctly', () => {
      const project = {
        name: 'Test',
        system_path: '/test',
        icon: 'folder',
        color: 'light_blue'
      };

      initCommand.displaySuccess(project);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Light Blue')
      );
    });
  });

  describe('getIconEmoji()', () => {
    test('passes through emoji as-is', () => {
      const emoji = initCommand.getIconEmoji('🚀');
      expect(emoji).toBe('🚀');
    });

    test('maps Heroicon folder to emoji', () => {
      const emoji = initCommand.getIconEmoji('folder');
      expect(emoji).toBe('📁');
    });

    test('maps Heroicon rocket to emoji', () => {
      const emoji = initCommand.getIconEmoji('rocket');
      expect(emoji).toBe('🚀');
    });

    test('maps all icon names correctly', () => {
      const icons = {
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

      for (const [iconName, expectedEmoji] of Object.entries(icons)) {
        expect(initCommand.getIconEmoji(iconName)).toBe(expectedEmoji);
      }
    });

    test('returns fallback icon for unknown names', () => {
      const emoji = initCommand.getIconEmoji('unknown-icon');
      expect(emoji).toBe('📁');
    });
  });

  describe('formatColorName()', () => {
    test('converts snake_case to Title Case', () => {
      expect(initCommand.formatColorName('light_blue')).toBe('Light Blue');
      expect(initCommand.formatColorName('dark_green')).toBe('Dark Green');
    });

    test('passes through hex color', () => {
      expect(initCommand.formatColorName('#FF5733')).toBe('#FF5733');
    });

    test('returns default Blue for null', () => {
      expect(initCommand.formatColorName(null)).toBe('Blue');
    });

    test('returns default Blue for undefined', () => {
      expect(initCommand.formatColorName(undefined)).toBe('Blue');
    });

    test('handles single word colors', () => {
      expect(initCommand.formatColorName('blue')).toBe('Blue');
      expect(initCommand.formatColorName('red')).toBe('Red');
    });
  });

  describe('handleError()', () => {
    test('logs error with logger', () => {
      const logger = require('../src/logger');
      const error = new Error('Test error');

      initCommand.handleError(error);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize project: Test error'
      );
    });

    test('provides API token guidance for token errors', () => {
      const error = new Error('Invalid API token');

      initCommand.handleError(error);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ensure your API token is set')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('export RALPH_API_TOKEN')
      );
    });

    test('provides connection guidance for connection errors', () => {
      const error = new Error('Could not connect to API');

      initCommand.handleError(error);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Please check:')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('internet connection')
      );
    });

    test('handles generic errors', () => {
      const logger = require('../src/logger');
      const error = new Error('Some other error');

      initCommand.handleError(error);

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
