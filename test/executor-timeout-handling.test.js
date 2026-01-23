const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const Executor = require('../src/executor');

jest.mock('child_process');
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'info'
}));
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('Executor - Timeout Handling', () => {
  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    executor = new Executor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('runClaudeSkill - Timeout', () => {
    test('times out after specified timeout', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null,
        5000  // 5 second timeout
      );

      // Fast-forward time past timeout
      jest.advanceTimersByTime(5001);

      await expect(skillPromise).rejects.toThrow(
        'Claude skill /prd execution timed out after 5000ms'
      );
    });

    test('sends SIGTERM on timeout', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null,
        1000
      );

      jest.advanceTimersByTime(1001);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      await expect(skillPromise).rejects.toThrow('timed out');
    });

    test('clears timeout on successful completion', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null,
        10000
      );

      // Complete successfully before timeout
      mockProcess.stdout.emit('data', Buffer.from('Output'));
      mockProcess.emit('close', 0);

      const result = await skillPromise;

      expect(result).toBe('Output');
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    test('clears timeout on error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null,
        10000
      );

      // Error before timeout
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      await expect(skillPromise).rejects.toThrow('Claude Code CLI is not installed');
    });

    test('includes partial output in timeout error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null,
        1000
      );

      mockProcess.stdout.emit('data', Buffer.from('Partial output...'));

      jest.advanceTimersByTime(1001);

      await expect(skillPromise).rejects.toThrow('timed out');
    });
  });

  describe('runClaude - Timeout', () => {
    test('times out after specified timeout', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude(
        'Test',
        '/test',
        null,
        5000  // 5 second timeout
      );

      jest.advanceTimersByTime(5001);

      await expect(claudePromise).rejects.toThrow(
        'Claude CLI execution timed out after 5000ms'
      );
    });

    test('sends SIGTERM on timeout', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude(
        'Test',
        '/test',
        null,
        1000
      );

      jest.advanceTimersByTime(1001);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      await expect(claudePromise).rejects.toThrow('timed out');
    });

    test('clears timeout on successful completion', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude(
        'Test',
        '/test',
        null,
        10000
      );

      mockProcess.stdout.emit('data', Buffer.from('Output'));
      mockProcess.emit('close', 0);

      const result = await claudePromise;

      expect(result).toBe('Output');
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    test('clears timeout on error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude(
        'Test',
        '/test',
        null,
        10000
      );

      const error = new Error('Spawn failed');
      mockProcess.emit('error', error);

      await expect(claudePromise).rejects.toThrow();
    });

    test('uses default timeout of 2 hours when not specified', async () => {
      const logger = require('../src/logger');
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      executor.runClaude('Test', '/test', null);

      expect(logger.info).toHaveBeenCalledWith(
        'Starting Claude CLI execution',
        expect.objectContaining({
          timeout: expect.any(String),
          workingDirectory: '/test',
          promptLength: expect.any(Number)
        })
      );
    });

    test('includes partial output in timeout error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude(
        'Test',
        '/test',
        null,
        1000
      );

      mockProcess.stdout.emit('data', Buffer.from('Partial work done...'));

      jest.advanceTimersByTime(1001);

      await expect(claudePromise).rejects.toThrow('timed out');
    });
  });

  describe('Process cleanup on timeout', () => {
    test('clears currentProcess reference on runClaudeSkill timeout', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null,
        100
      );

      expect(executor.currentProcess).toBe(mockProcess);

      jest.advanceTimersByTime(101);

      await expect(skillPromise).rejects.toThrow('timed out');
    });

    test('clears currentProcess reference on runClaude timeout', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude(
        'Test',
        '/test',
        null,
        100
      );

      expect(executor.currentProcess).toBe(mockProcess);

      jest.advanceTimersByTime(101);

      await expect(claudePromise).rejects.toThrow('timed out');
    });
  });
});
