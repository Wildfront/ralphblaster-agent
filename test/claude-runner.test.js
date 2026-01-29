jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  event: jest.fn()
}));

const ClaudeRunner = require('../src/executor/claude-runner');
const { spawn } = require('child_process');
const EventEmitter = require('events');

// Mock child_process
jest.mock('child_process');

describe('ClaudeRunner', () => {
  let claudeRunner;
  let mockErrorHandler;
  let mockGitHelper;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock dependencies
    mockErrorHandler = {
      categorizeError: jest.fn((error, stderr, exitCode) => ({
        category: 'test_error',
        userMessage: 'Test error message',
        technicalDetails: 'Test technical details'
      }))
    };

    mockGitHelper = {
      getCurrentBranch: jest.fn().mockResolvedValue('test-branch')
    };

    claudeRunner = new ClaudeRunner(mockErrorHandler, mockGitHelper);
  });

  describe('constructor', () => {
    test('creates instance with dependencies', () => {
      expect(claudeRunner).toBeInstanceOf(ClaudeRunner);
      expect(claudeRunner.errorHandler).toBe(mockErrorHandler);
      expect(claudeRunner.gitHelper).toBe(mockGitHelper);
    });

    test('initializes with null currentProcess', () => {
      expect(claudeRunner.currentProcess).toBeNull();
    });

    test('initializes with null currentJobId', () => {
      expect(claudeRunner.currentJobId).toBeNull();
    });

    test('initializes with empty capturedStderr', () => {
      expect(claudeRunner.capturedStderr).toBe('');
    });
  });

  describe('getSanitizedEnv()', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('includes allowed environment variables', () => {
      process.env.PATH = '/usr/bin:/bin';
      process.env.HOME = '/home/user';
      process.env.USER = 'testuser';
      process.env.LANG = 'en_US.UTF-8';
      process.env.NODE_ENV = 'test';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.PATH).toBe('/usr/bin:/bin');
      expect(env.HOME).toBe('/home/user');
      expect(env.USER).toBe('testuser');
      expect(env.LANG).toBe('en_US.UTF-8');
      expect(env.NODE_ENV).toBe('test');
    });

    test('excludes RALPH_API_TOKEN', () => {
      process.env.RALPH_API_TOKEN = 'secret-token';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.RALPH_API_TOKEN).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('excludes environment variables ending with _TOKEN', () => {
      process.env.GITHUB_TOKEN = 'github-secret';
      process.env.API_TOKEN = 'api-secret';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.API_TOKEN).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('excludes environment variables ending with _SECRET', () => {
      process.env.DATABASE_SECRET = 'db-secret';
      process.env.APP_SECRET = 'app-secret';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.DATABASE_SECRET).toBeUndefined();
      expect(env.APP_SECRET).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('excludes environment variables ending with _KEY', () => {
      process.env.API_KEY = 'api-key';
      process.env.SECRET_KEY = 'secret-key';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.API_KEY).toBeUndefined();
      expect(env.SECRET_KEY).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('excludes environment variables ending with _PASSWORD', () => {
      process.env.DB_PASSWORD = 'db-pass';
      process.env.USER_PASSWORD = 'user-pass';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.DB_PASSWORD).toBeUndefined();
      expect(env.USER_PASSWORD).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('excludes AWS credentials', () => {
      process.env.AWS_ACCESS_KEY_ID = 'aws-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('excludes Azure credentials', () => {
      process.env.AZURE_CLIENT_ID = 'azure-id';
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.AZURE_CLIENT_ID).toBeUndefined();
      expect(env.AZURE_CLIENT_SECRET).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('excludes Google Cloud credentials', () => {
      process.env.GCP_PROJECT_ID = 'gcp-project';
      process.env.GOOGLE_API_KEY = 'google-key';
      process.env.PATH = '/usr/bin:/bin';

      const env = claudeRunner.getSanitizedEnv();

      expect(env.GCP_PROJECT_ID).toBeUndefined();
      expect(env.GOOGLE_API_KEY).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    test('returns only whitelisted vars even if no sensitive vars present', () => {
      process.env = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        SOME_RANDOM_VAR: 'value',
        ANOTHER_VAR: 'another'
      };

      const env = claudeRunner.getSanitizedEnv();

      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/user');
      expect(env.SOME_RANDOM_VAR).toBeUndefined();
      expect(env.ANOTHER_VAR).toBeUndefined();
    });
  });

  describe('runClaude()', () => {
    let mockProcess;

    beforeEach(() => {
      mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);
    });

    test('spawns Claude CLI with correct arguments', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      // Simulate successful completion
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('test output\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--verbose'],
        expect.objectContaining({
          cwd: '/test/dir',
          shell: false
        })
      );
    });

    test('writes prompt to stdin', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('output\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('test prompt');
      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    test('resolves with raw terminal output', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Reading file.js...\n'));
        mockProcess.stdout.emit('data', Buffer.from('Writing output...\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toBe('Reading file.js...\nWriting output...\n');
    });

    test('calls onProgress callback with output', async () => {
      const onProgress = jest.fn();
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', onProgress, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Hello\n'));
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(onProgress).toHaveBeenCalledWith('Hello\n');
      expect(onProgress).toHaveBeenCalledWith('done\n');
    });

    test('times out after specified timeout', async () => {
      jest.useFakeTimers();
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      jest.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow('Claude CLI execution timed out after 1000ms');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    test('rejects on non-zero exit code', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stderr.emit('data', Buffer.from('Error: something went wrong'));
        mockProcess.emit('close', 1);
      });

      await expect(promise).rejects.toThrow('Test error message');
      expect(mockErrorHandler.categorizeError).toHaveBeenCalled();
    });

    test('rejects on spawn error', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        const error = new Error('spawn failed');
        error.code = 'ENOENT';
        mockProcess.emit('error', error);
      });

      await expect(promise).rejects.toThrow('Test error message');
      expect(mockErrorHandler.categorizeError).toHaveBeenCalled();
    });

    test('clears currentProcess on successful completion', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      expect(claudeRunner.currentProcess).toBe(mockProcess);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(claudeRunner.currentProcess).toBeNull();
    });

    test('clears currentProcess on error', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      expect(claudeRunner.currentProcess).toBe(mockProcess);

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });

      await expect(promise).rejects.toThrow();

      expect(claudeRunner.currentProcess).toBeNull();
    });

    test('concatenates multiple output chunks', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('partial output'));
        mockProcess.stdout.emit('data', Buffer.from(' final\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toBe('partial output final\n');
    });

    test('returns all raw output', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('This is not JSON\n'));
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toBe('This is not JSON\ndone\n');
    });

    test('includes partial output in error', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('assistant output\n'));
        mockProcess.stderr.emit('data', Buffer.from('error occurred'));
        mockProcess.emit('close', 1);
      });

      await expect(promise).rejects.toThrow();

      const errorCall = mockErrorHandler.categorizeError.mock.calls[0];
      expect(errorCall[0]).toBeInstanceOf(Error);
      expect(errorCall[1]).toContain('error occurred');
      expect(errorCall[2]).toBe(1);
    });

    test('handles stdin write failure', async () => {
      mockProcess.stdin.write.mockImplementation(() => {
        throw new Error('stdin write failed');
      });

      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      await expect(promise).rejects.toThrow('Failed to write prompt to Claude: stdin write failed');
    });
  });

  describe('runClaudeDirectly()', () => {
    let mockProcess;
    let mockJob;
    let mockApiClient;

    beforeEach(() => {
      mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);

      mockJob = { id: 123 };
      mockApiClient = {
        sendProgress: jest.fn().mockResolvedValue(undefined)
      };
    });

    test('spawns Claude CLI in worktree path', async () => {
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--verbose'],
        expect.objectContaining({
          cwd: '/worktree/path',
          shell: false
        })
      );
    });

    test('resolves with output, branch name, and duration', async () => {
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('test result\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toEqual({
        output: 'test result\n',
        branchName: 'test-branch',
        duration: expect.any(Number)
      });
      expect(mockGitHelper.getCurrentBranch).toHaveBeenCalledWith('/worktree/path');
    });

    test('sends progress to API client', async () => {
      claudeRunner.apiClient = mockApiClient;
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('assistant output\n'));
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(mockApiClient.sendProgress).toHaveBeenCalled();
    });

    test('calls onProgress callback', async () => {
      const onProgress = jest.fn();
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, onProgress);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(onProgress).toHaveBeenCalled();
    });

    test('captures stderr to instance variable', async () => {
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stderr.emit('data', Buffer.from('warning message'));
        mockProcess.stderr.emit('data', Buffer.from(' continued'));
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(claudeRunner.capturedStderr).toBe('warning message continued');
    });

    test('times out after 2 hours', async () => {
      jest.useFakeTimers();
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      jest.advanceTimersByTime(7200001); // 2 hours + 1ms

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    test('rejects with categorized error on failure', async () => {
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stderr.emit('data', Buffer.from('error occurred'));
        mockProcess.emit('close', 1);
      });

      await expect(promise).rejects.toThrow('Test error message');
      expect(mockErrorHandler.categorizeError).toHaveBeenCalled();
    });

    test('rejects on spawn error', async () => {
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        const error = new Error('spawn failed');
        mockProcess.emit('error', error);
      });

      await expect(promise).rejects.toThrow('Test error message');
    });

    test('clears currentProcess on completion', async () => {
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('done\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(claudeRunner.currentProcess).toBeNull();
    });
  });

  describe('setJobId()', () => {
    test('sets currentJobId', () => {
      claudeRunner.setJobId(456);

      expect(claudeRunner.currentJobId).toBe(456);
    });

    test('updates jobId during execution', () => {
      claudeRunner.setJobId(123);
      expect(claudeRunner.currentJobId).toBe(123);

      claudeRunner.setJobId(789);
      expect(claudeRunner.currentJobId).toBe(789);
    });
  });

  describe('setApiClient()', () => {
    test('sets apiClient', () => {
      const mockClient = { sendProgress: jest.fn() };
      claudeRunner.setApiClient(mockClient);

      expect(claudeRunner.apiClient).toBe(mockClient);
    });
  });

  describe('resetCapturedStderr()', () => {
    test('resets capturedStderr to empty string', () => {
      claudeRunner.capturedStderr = 'some error output';

      claudeRunner.resetCapturedStderr();

      expect(claudeRunner.capturedStderr).toBe('');
    });
  });
});
