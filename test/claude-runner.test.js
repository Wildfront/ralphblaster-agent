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
  let mockEventDetector;
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

    mockEventDetector = {
      detectAndEmit: jest.fn(),
      reset: jest.fn()
    };

    mockGitHelper = {
      getCurrentBranch: jest.fn().mockResolvedValue('test-branch')
    };

    claudeRunner = new ClaudeRunner(mockErrorHandler, mockEventDetector, mockGitHelper);
  });

  describe('constructor', () => {
    test('creates instance with dependencies', () => {
      expect(claudeRunner).toBeInstanceOf(ClaudeRunner);
      expect(claudeRunner.errorHandler).toBe(mockErrorHandler);
      expect(claudeRunner.eventDetector).toBe(mockEventDetector);
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
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"test output"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'],
        expect.objectContaining({
          cwd: '/test/dir',
          shell: false
        })
      );
    });

    test('writes prompt to stdin', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"output"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('test prompt');
      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    test('resolves with final result from stream-json', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"final result text"}\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toBe('final result text');
    });

    test('calls onProgress callback with output', async () => {
      const onProgress = jest.fn();
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', onProgress, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n'));
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('type":"assistant'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('type":"result'));
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

    test('calls detectAndEmit for each JSON line', async () => {
      claudeRunner.currentJobId = 123;
      const mockApiClient = {};
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":{"content":[]}}\n'));
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(mockEventDetector.detectAndEmit).toHaveBeenCalledTimes(2);
    });

    test('logs Claude events', async () => {
      const logClaudeEventSpy = jest.spyOn(claudeRunner, 'logClaudeEvent');
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"system","subtype":"init","model":"claude-3"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(logClaudeEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system', subtype: 'init', model: 'claude-3' })
      );
    });

    test('clears currentProcess on successful completion', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      expect(claudeRunner.currentProcess).toBe(mockProcess);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
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

    test('handles incomplete JSON lines in buffer', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result",'));
        mockProcess.stdout.emit('data', Buffer.from('"result":"final"}\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toBe('final');
    });

    test('handles non-JSON output gracefully', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('This is not JSON\n'));
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toBe('done');
    });

    test('falls back to raw stdout if no result event', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":{}}\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toContain('type":"assistant');
    });

    test('includes partial output in error', async () => {
      const promise = claudeRunner.runClaude('test prompt', '/test/dir', null, 1000);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":{}}\n'));
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
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'],
        expect.objectContaining({
          cwd: '/worktree/path',
          shell: false
        })
      );
    });

    test('resolves with output, branch name, and duration', async () => {
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"test result"}\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;

      expect(result).toEqual({
        output: 'test result',
        branchName: 'test-branch',
        duration: expect.any(Number)
      });
      expect(mockGitHelper.getCurrentBranch).toHaveBeenCalledWith('/worktree/path');
    });

    test('sends progress to API client', async () => {
      claudeRunner.apiClient = mockApiClient;
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, null);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":{}}\n'));
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(mockApiClient.sendProgress).toHaveBeenCalled();
    });

    test('calls onProgress callback', async () => {
      const onProgress = jest.fn();
      const promise = claudeRunner.runClaudeDirectly('/worktree/path', 'prompt', mockJob, onProgress);

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
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
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
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
        mockProcess.stdout.emit('data', Buffer.from('{"type":"result","result":"done"}\n'));
        mockProcess.emit('close', 0);
      });

      await promise;

      expect(claudeRunner.currentProcess).toBeNull();
    });
  });

  describe('logClaudeEvent()', () => {
    const logger = require('../src/logger');

    test('logs system init event', () => {
      const event = {
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet-3.5'
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Claude session started'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('claude-sonnet-3.5'));
    });

    test('logs assistant text message', () => {
      const event = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello, I will help you' }
          ]
        }
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Hello, I will help you'));
    });

    test('logs assistant tool use', () => {
      const event = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: '/test/file.js' }
            }
          ]
        }
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Read'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('file.js'));
    });

    test('logs tool use with command', () => {
      const event = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'npm install' }
            }
          ]
        }
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Bash'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('npm install'));
    });

    test('logs tool use with pattern', () => {
      const event = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Grep',
              input: { pattern: 'function.*test' }
            }
          ]
        }
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Grep'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('function.*test'));
    });

    test('truncates long commands', () => {
      const longCommand = 'a'.repeat(100);
      const event = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: longCommand }
            }
          ]
        }
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('...'));
    });

    test('logs result success event', () => {
      const event = {
        type: 'result',
        subtype: 'success',
        duration_ms: 15000,
        num_turns: 10,
        total_cost_usd: 0.0542
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Completed'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('10 turns'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('$0.0542'));
    });

    test('logs result error event', () => {
      const event = {
        type: 'result',
        is_error: true,
        error: 'Something went wrong'
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed'));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
    });

    test('logs user tool result', () => {
      const event = {
        type: 'user',
        tool_use_result: {
          file: {
            filePath: '/test/file.js',
            numLines: 100
          }
        }
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('100 lines'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('file.js'));
    });

    test('logs text tool result', () => {
      const event = {
        type: 'user',
        tool_use_result: {
          type: 'text',
          output: 'line1\nline2\nline3'
        }
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('3 lines'));
    });

    test('handles missing cost in result', () => {
      const event = {
        type: 'result',
        subtype: 'success',
        duration_ms: 1000,
        num_turns: 5
      };

      claudeRunner.logClaudeEvent(event);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('$0.00'));
    });

    test('handles events without expected fields', () => {
      const event = { type: 'unknown' };

      expect(() => claudeRunner.logClaudeEvent(event)).not.toThrow();
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
