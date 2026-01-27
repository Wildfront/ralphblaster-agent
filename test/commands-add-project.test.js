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

const AddProjectCommand = require('../src/commands/add-project');
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

describe('AddProjectCommand', () => {
  let addProjectCommand;
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
      },
      requestWithFallback: jest.fn()
    };

    ApiClient.mockImplementation(() => mockApiClient);
    addProjectCommand = new AddProjectCommand();
  });

  describe('run()', () => {
    test('runs successful project registration', async () => {
      const logger = require('../src/logger');

      addProjectCommand.detectProjectName = jest.fn().mockResolvedValue('test-project');
      addProjectCommand.createProject = jest.fn().mockResolvedValue({
        name: 'test-project',
        system_path: '/test/path',
        icon: 'rocket',
        color: 'blue'
      });
      addProjectCommand.displaySuccess = jest.fn();

      await addProjectCommand.run();

      expect(logger.info).toHaveBeenCalledWith('Registering project with RalphBlaster...');
      expect(addProjectCommand.detectProjectName).toHaveBeenCalled();
      expect(addProjectCommand.createProject).toHaveBeenCalled();
      expect(addProjectCommand.displaySuccess).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    test('handles errors gracefully', async () => {
      addProjectCommand.detectProjectName = jest.fn().mockRejectedValue(new Error('Test error'));
      addProjectCommand.handleError = jest.fn();

      await addProjectCommand.run();

      expect(addProjectCommand.handleError).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('detectProjectName()', () => {
    test('uses Git remote name when available', async () => {
      const logger = require('../src/logger');
      addProjectCommand.getGitRemoteName = jest.fn().mockReturnValue('repo-from-git');

      const name = await addProjectCommand.detectProjectName();

      expect(name).toBe('repo-from-git');
      expect(logger.debug).toHaveBeenCalledWith('Using project name from Git remote');
    });

    test('uses package.json name when Git remote fails', async () => {
      const logger = require('../src/logger');
      addProjectCommand.getGitRemoteName = jest.fn().mockImplementation(() => {
        throw new Error('No git remote');
      });
      addProjectCommand.getPackageJsonName = jest.fn().mockReturnValue('pkg-name');

      const name = await addProjectCommand.detectProjectName();

      expect(name).toBe('pkg-name');
      expect(logger.debug).toHaveBeenCalledWith('Using project name from package.json');
    });

    test('falls back to directory name', async () => {
      const logger = require('../src/logger');
      addProjectCommand.getGitRemoteName = jest.fn().mockReturnValue(null);
      addProjectCommand.getPackageJsonName = jest.fn().mockReturnValue(null);
      addProjectCommand.getDirectoryName = jest.fn().mockReturnValue('directory-name');

      const name = await addProjectCommand.detectProjectName();

      expect(name).toBe('directory-name');
      expect(logger.debug).toHaveBeenCalledWith('Using directory name as project name');
    });
  });

  describe('getGitRemoteName()', () => {
    test('extracts name from HTTPS URL', () => {
      execSync.mockReturnValue('https://github.com/user/my-repo.git\n');

      const name = addProjectCommand.getGitRemoteName();

      expect(name).toBe('my-repo');
    });

    test('extracts name from SSH URL', () => {
      execSync.mockReturnValue('git@github.com:user/my-repo.git\n');

      const name = addProjectCommand.getGitRemoteName();

      expect(name).toBe('my-repo');
    });

    test('returns null when Git not initialized', () => {
      execSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const name = addProjectCommand.getGitRemoteName();

      expect(name).toBeNull();
    });
  });

  describe('getPackageJsonName()', () => {
    test('extracts name from package.json', () => {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ name: 'my-package' }));

      const name = addProjectCommand.getPackageJsonName();

      expect(name).toBe('my-package');
      expect(fs.readFileSync).toHaveBeenCalledWith(packageJsonPath, 'utf8');
    });

    test('returns null when package.json does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const name = addProjectCommand.getPackageJsonName();

      expect(name).toBeNull();
    });
  });

  describe('createProject()', () => {
    test('creates project with valid parameters', async () => {
      mockApiClient.requestWithFallback.mockResolvedValue({
        data: {
          success: true,
          project: {
            id: 1,
            name: 'test-project',
            system_path: '/test/path'
          }
        }
      });

      const project = await addProjectCommand.createProject('/test/path', 'test-project');

      expect(project.name).toBe('test-project');
      expect(mockApiClient.requestWithFallback).toHaveBeenCalledWith(
        'post',
        '/projects',
        {
          system_path: '/test/path',
          name: 'test-project'
        }
      );
    });

    test('handles 401 unauthorized error', async () => {
      const error = new Error('Unauthorized');
      error.response = {
        status: 401,
        data: { error: 'Invalid token' }
      };
      mockApiClient.requestWithFallback.mockRejectedValue(error);

      await expect(addProjectCommand.createProject('/test', 'name'))
        .rejects.toThrow('Please run "ralphblaster init" first');
    });

    test('handles network errors', async () => {
      const error = new Error('Network error');
      error.request = {};
      mockApiClient.requestWithFallback.mockRejectedValue(error);

      await expect(addProjectCommand.createProject('/test', 'name'))
        .rejects.toThrow('Could not connect to RalphBlaster API');
    });
  });

  describe('displaySuccess()', () => {
    test('displays success message with next steps', () => {
      const logger = require('../src/logger');
      const project = {
        name: 'My Project',
        system_path: '/path/to/project',
        icon: 'rocket',
        color: 'blue'
      };

      addProjectCommand.displaySuccess(project);

      expect(logger.info).toHaveBeenCalledWith(
        'Project registered successfully!',
        {
          name: 'My Project',
          path: '/path/to/project',
          icon: '🚀',
          color: 'Blue'
        }
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Start the agent: ralphblaster'));
    });
  });

  describe('handleError()', () => {
    test('provides guidance for init required error', () => {
      const logger = require('../src/logger');
      const error = new Error('Please run "ralphblaster init" first');

      addProjectCommand.handleError(error);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to register project: Please run "ralphblaster init" first'
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ralphblaster init --token=your_token_here')
      );
    });

    test('provides guidance for connection errors', () => {
      const error = new Error('Could not connect to API');

      addProjectCommand.handleError(error);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Please check:')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('internet connection')
      );
    });
  });
});
