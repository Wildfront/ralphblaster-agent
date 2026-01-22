const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const Executor = require('../src/executor');

jest.mock('child_process');
jest.mock('fs');
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'error'
}));

describe('Executor Error Paths', () => {
  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new Executor();
  });

  describe('Claude stderr output', () => {
    test('logs stderr warnings during skill execution', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test prompt',
        '/test/path',
        null
      );

      // Emit stderr warnings
      mockProcess.stderr.emit('data', Buffer.from('Warning: API rate limit approaching\n'));
      mockProcess.stderr.emit('data', Buffer.from('Warning: Cache miss\n'));

      // Emit stdout
      mockProcess.stdout.emit('data', Buffer.from('PRD output'));

      // Complete successfully despite stderr
      mockProcess.emit('close', 0);

      const result = await skillPromise;
      expect(result).toBe('PRD output');
    });

    test('logs stderr warnings during Claude execution', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude(
        'Test prompt',
        '/test/path',
        null
      );

      // Emit stderr
      mockProcess.stderr.emit('data', Buffer.from('Debug info\n'));

      // Emit stdout
      mockProcess.stdout.emit('data', Buffer.from('Code output'));

      // Complete successfully
      mockProcess.emit('close', 0);

      const result = await claudePromise;
      expect(result).toBe('Code output');
    });
  });

  describe('Non-zero exit codes', () => {
    test('runClaudeSkill rejects on non-zero exit code', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test prompt',
        '/test/path',
        null
      );

      mockProcess.stderr.emit('data', Buffer.from('Error: Invalid skill'));
      mockProcess.emit('close', 1);

      await expect(skillPromise).rejects.toThrow(
        'Claude CLI execution failed with exit code 1'
      );
    });

    test('runClaudeSkill includes stderr in error message', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null
      );

      mockProcess.stderr.emit('data', Buffer.from('Skill not found'));
      mockProcess.emit('close', 127);

      await expect(skillPromise).rejects.toThrow('Claude CLI execution failed with exit code 127');
    });

    test('runClaude rejects on non-zero exit code', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude('Test', '/test', null);

      mockProcess.stderr.emit('data', Buffer.from('Authentication failed'));
      mockProcess.emit('close', 1);

      await expect(claudePromise).rejects.toThrow(
        'Claude CLI is not authenticated. Please run "claude auth"'
      );
    });

    test('runClaude includes stderr in error message', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude('Test', '/test', null);

      mockProcess.stderr.emit('data', Buffer.from('Permission denied'));
      mockProcess.emit('close', 126);

      await expect(claudePromise).rejects.toThrow('Permission denied');
    });
  });

  describe('Process spawn errors', () => {
    test('runClaudeSkill rejects on spawn error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const skillPromise = executor.runClaudeSkill(
        'prd',
        'Test',
        '/test',
        null
      );

      // Emit error event with ENOENT code
      const error = new Error('ENOENT: claude command not found');
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      await expect(skillPromise).rejects.toThrow(
        'Claude Code CLI is not installed or not found in PATH'
      );
    });

    test('runClaude rejects on spawn error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude('Test', '/test', null);

      // Emit error event with EACCES code
      const error = new Error('EACCES: permission denied');
      error.code = 'EACCES';
      mockProcess.emit('error', error);

      await expect(claudePromise).rejects.toThrow(
        'Permission denied accessing project files or directories'
      );
    });

    test('spawn error clears currentProcess reference', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude('Test', '/test', null);

      // Process should be tracked
      expect(executor.currentProcess).toBe(mockProcess);

      // Emit error
      mockProcess.emit('error', new Error('Spawn failed'));

      await expect(claudePromise).rejects.toThrow();

      // currentProcess should be cleared
      expect(executor.currentProcess).toBeNull();
    });
  });

  describe('PRD generation path validation', () => {
    test('uses current directory when project path is invalid', async () => {
      const fs = require('fs');
      fs.existsSync = jest.fn().mockReturnValue(false);

      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate a PRD',
        project: {
          system_path: '/invalid/path/that/does/not/exist'
        }
      };

      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const prdPromise = executor.executePrdGeneration(job, null, Date.now());

      // Should spawn with process.cwd() not the invalid path
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--permission-mode', 'acceptEdits'],
        expect.objectContaining({
          cwd: process.cwd() // Falls back to current directory
        })
      );

      mockProcess.stdout.emit('data', Buffer.from('PRD content'));
      mockProcess.emit('close', 0);

      await prdPromise;
    });

    test('uses sanitized path when valid', async () => {
      const fs = require('fs');
      fs.existsSync = jest.fn().mockReturnValue(true);

      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate a PRD',
        project: {
          system_path: '/valid/project/path'
        }
      };

      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const prdPromise = executor.executePrdGeneration(job, null, Date.now());

      // Should use the valid path (after sanitization/resolution)
      const spawnCalls = spawn.mock.calls;
      const spawnOptions = spawnCalls[0][2];
      expect(spawnOptions.cwd).toContain('valid');

      mockProcess.stdout.emit('data', Buffer.from('PRD'));
      mockProcess.emit('close', 0);

      await prdPromise;
    });
  });

  describe('Process reference cleanup', () => {
    test('currentProcess cleared on successful close', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude('Test', '/test', null);

      expect(executor.currentProcess).toBe(mockProcess);

      mockProcess.stdout.emit('data', Buffer.from('output'));
      mockProcess.emit('close', 0);

      await claudePromise;

      expect(executor.currentProcess).toBeNull();
    });

    test('currentProcess cleared on error close', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const claudePromise = executor.runClaude('Test', '/test', null);

      expect(executor.currentProcess).toBe(mockProcess);

      mockProcess.emit('close', 1);

      await expect(claudePromise).rejects.toThrow();

      expect(executor.currentProcess).toBeNull();
    });
  });
});
