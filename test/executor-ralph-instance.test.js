const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
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

describe('Executor - runRalphInstance', () => {
  let executor;
  let mockApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockApiClient = {
      sendStatusEvent: jest.fn().mockResolvedValue({})
    };
    executor = new Executor(mockApiClient);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('runRalphInstance - Execution', () => {
    test('executes Ralph with valid parameters', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const instancePath = '/instance/path';
      const worktreePath = '/worktree/path';
      const mainRepoPath = '/main/repo';

      const ralphPromise = executor.runRalphInstance(
        instancePath,
        worktreePath,
        mainRepoPath,
        jest.fn()
      );

      mockProcess.stdout.emit('data', Buffer.from('Ralph output'));
      mockProcess.emit('close', 0);

      const result = await ralphPromise;

      expect(result).toBe('Ralph output');
      expect(spawn).toHaveBeenCalledWith(
        path.join(instancePath, 'ralph.sh'),
        ['10'],
        expect.objectContaining({
          cwd: instancePath,
          shell: false
        })
      );
    });

    test('sets RALPH_WORKTREE_PATH environment variable', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const worktreePath = '/worktree/path';

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        worktreePath,
        '/main',
        null
      );

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            RALPH_WORKTREE_PATH: worktreePath
          })
        })
      );

      mockProcess.emit('close', 0);
      await ralphPromise;
    });

    test('sets RALPH_INSTANCE_DIR environment variable', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const instancePath = '/instance/path';

      const ralphPromise = executor.runRalphInstance(
        instancePath,
        '/worktree',
        '/main',
        null
      );

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            RALPH_INSTANCE_DIR: instancePath
          })
        })
      );

      mockProcess.emit('close', 0);
      await ralphPromise;
    });

    test('sets RALPH_MAIN_REPO environment variable', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const mainRepoPath = '/main/repo';

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        mainRepoPath,
        null
      );

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            RALPH_MAIN_REPO: mainRepoPath
          })
        })
      );

      mockProcess.emit('close', 0);
      await ralphPromise;
    });

    test('handles timeout correctly', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null,
        5000  // 5 second timeout
      );

      jest.advanceTimersByTime(5001);

      await expect(ralphPromise).rejects.toThrow(
        'Ralph execution timed out after 5000ms'
      );
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('tracks process for shutdown cleanup', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      expect(executor.currentProcess).toBe(mockProcess);

      mockProcess.emit('close', 0);
      await ralphPromise;

      expect(executor.currentProcess).toBeNull();
    });

    test('handles stdout data correctly', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const onProgress = jest.fn();

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        onProgress
      );

      mockProcess.stdout.emit('data', Buffer.from('Line 1\n'));
      mockProcess.stdout.emit('data', Buffer.from('Line 2\n'));
      mockProcess.emit('close', 0);

      const result = await ralphPromise;

      expect(result).toBe('Line 1\nLine 2\n');
      expect(onProgress).toHaveBeenCalledWith('Line 1\n');
      expect(onProgress).toHaveBeenCalledWith('Line 2\n');
    });

    test('handles stderr output', async () => {
      const logger = require('../src/logger');
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stderr.emit('data', Buffer.from('Warning message'));
      mockProcess.emit('close', 0);

      await ralphPromise;

      expect(logger.warn).toHaveBeenCalledWith(
        'Ralph stderr:',
        'Warning message'
      );
    });

    test('integrates event detection from output', async () => {
      executor.currentJobId = 456;
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stdout.emit('data', Buffer.from('Writing to app.js'));
      mockProcess.emit('close', 0);

      await ralphPromise;

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();
    });
  });

  describe('runRalphInstance - Exit Codes', () => {
    test('resolves on exit code 0 (completion)', async () => {
      const logger = require('../src/logger');
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stdout.emit('data', Buffer.from('Completed'));
      mockProcess.emit('close', 0);

      const result = await ralphPromise;

      expect(result).toBe('Completed');
      expect(logger.debug).toHaveBeenCalledWith(
        'Ralph execution completed with code 0'
      );
    });

    test('resolves on exit code 1 (max iterations)', async () => {
      const logger = require('../src/logger');
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stdout.emit('data', Buffer.from('Max iterations reached'));
      mockProcess.emit('close', 1);

      const result = await ralphPromise;

      expect(result).toBe('Max iterations reached');
      expect(logger.debug).toHaveBeenCalledWith(
        'Ralph execution completed with code 1'
      );
    });

    test('rejects on other exit codes', async () => {
      const logger = require('../src/logger');
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stderr.emit('data', Buffer.from('Fatal error'));
      mockProcess.emit('close', 2);

      await expect(ralphPromise).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        'Ralph exited with code 2'
      );
    });

    test('includes partial output in error on failure', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stdout.emit('data', Buffer.from('Partial work...'));
      mockProcess.stderr.emit('data', Buffer.from('Error occurred'));
      mockProcess.emit('close', 2);

      try {
        await ralphPromise;
      } catch (error) {
        expect(error.partialOutput).toBe('Partial work...');
      }
    });
  });

  describe('runRalphInstance - Spawn Errors', () => {
    test('handles spawn errors', async () => {
      const logger = require('../src/logger');
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      const error = new Error('ENOENT: ralph.sh not found');
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      await expect(ralphPromise).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to spawn Ralph',
        expect.any(String)
      );
    });

    test('categorizes spawn errors', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      const error = new Error('Permission denied');
      error.code = 'EACCES';
      mockProcess.emit('error', error);

      try {
        await ralphPromise;
      } catch (err) {
        expect(err.category).toBe('permission_denied');
      }
    });

    test('clears currentProcess on spawn error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      expect(executor.currentProcess).toBe(mockProcess);

      mockProcess.emit('error', new Error('Spawn failed'));

      await expect(ralphPromise).rejects.toThrow();
      expect(executor.currentProcess).toBeNull();
    });

    test('includes partial output in spawn error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stdout.emit('data', Buffer.from('Before error...'));
      mockProcess.emit('error', new Error('Failed'));

      try {
        await ralphPromise;
      } catch (error) {
        expect(error.partialOutput).toBe('Before error...');
      }
    });
  });

  describe('runRalphInstance - Error Categorization', () => {
    test('categorizes errors with categorizeError', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stderr.emit('data', Buffer.from('not authenticated'));
      mockProcess.emit('close', 2);

      try {
        await ralphPromise;
      } catch (error) {
        expect(error.category).toBe('not_authenticated');
        expect(error.message).toContain('Claude CLI is not authenticated');
      }
    });

    test('enriches error with technical details', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const ralphPromise = executor.runRalphInstance(
        '/instance',
        '/worktree',
        '/main',
        null
      );

      mockProcess.stderr.emit('data', Buffer.from('Detailed error info'));
      mockProcess.emit('close', 3);

      try {
        await ralphPromise;
      } catch (error) {
        expect(error.technicalDetails).toContain('Detailed error info');
        expect(error.technicalDetails).toContain('3');
      }
    });
  });
});
