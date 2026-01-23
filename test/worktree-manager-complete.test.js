const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const WorktreeManager = require('../src/worktree-manager');

jest.mock('child_process');
jest.mock('fs', () => ({
  promises: {
    access: jest.fn()
  }
}));
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  event: jest.fn()
}));

describe('WorktreeManager - Complete Coverage', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new WorktreeManager();
  });

  describe('createWorktree()', () => {
    test('creates worktree with valid job', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 123,
        task_id: 456,
        project: {
          system_path: '/project/path'
        }
      };

      // Mock git --version
      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();
      mockVersionProcess.kill = jest.fn();

      // Mock git worktree add
      const mockWorktreeProcess = new EventEmitter();
      mockWorktreeProcess.stdout = new EventEmitter();
      mockWorktreeProcess.stderr = new EventEmitter();
      mockWorktreeProcess.kill = jest.fn();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockVersionProcess;
        return mockWorktreeProcess;
      });

      // Mock access to throw (worktree doesn't exist)
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const createPromise = manager.createWorktree(job);

      mockVersionProcess.stdout.emit('data', Buffer.from('git version 2.30.0'));
      mockVersionProcess.emit('close', 0);

      // Wait for promise to continue to next git command
      await new Promise(resolve => setImmediate(resolve));

      mockWorktreeProcess.emit('close', 0);

      const result = await createPromise;

      expect(result).toContain('path-worktrees/job-123');
      expect(logger.event).toHaveBeenCalledWith(
        'worktree.created',
        expect.objectContaining({
          component: 'worktree',
          operation: 'create'
        })
      );
    });

    test('checks git version before creating worktree', async () => {
      const job = {
        id: 1,
        task_id: 1,
        project: { system_path: '/test' }
      };

      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();
      mockVersionProcess.kill = jest.fn();

      const mockWorktreeProcess = new EventEmitter();
      mockWorktreeProcess.stdout = new EventEmitter();
      mockWorktreeProcess.stderr = new EventEmitter();
      mockWorktreeProcess.kill = jest.fn();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockVersionProcess;
        return mockWorktreeProcess;
      });

      fs.access.mockRejectedValue(new Error('ENOENT'));

      const createPromise = manager.createWorktree(job);

      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['--version'],
        expect.objectContaining({ cwd: '/test' })
      );

      mockVersionProcess.emit('close', 0);

      // Wait for promise to continue to next git command
      await new Promise(resolve => setImmediate(resolve));

      mockWorktreeProcess.emit('close', 0);

      await createPromise;
    });

    test.skip('removes existing worktree before creating new one', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      const logger = require('../src/logger');
      const job = {
        id: 2,
        task_id: 2,
        project: { system_path: '/test' }
      };

      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();
      mockVersionProcess.kill = jest.fn();

      const mockRemoveProcess = new EventEmitter();
      mockRemoveProcess.stdout = new EventEmitter();
      mockRemoveProcess.stderr = new EventEmitter();
      mockRemoveProcess.kill = jest.fn();

      const mockAddProcess = new EventEmitter();
      mockAddProcess.stdout = new EventEmitter();
      mockAddProcess.stderr = new EventEmitter();
      mockAddProcess.kill = jest.fn();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockVersionProcess;
        if (callCount === 2) return mockRemoveProcess;
        return mockAddProcess;
      });

      // Mock access to succeed (worktree exists)
      fs.access.mockResolvedValue(undefined);

      const createPromise = manager.createWorktree(job);

      mockVersionProcess.emit('close', 0);

      // Wait for promise to continue to remove worktree
      await Promise.resolve();
      await Promise.resolve();

      mockRemoveProcess.emit('close', 0);

      // Wait for sleep(500) after removal and advance timers
      await Promise.resolve();
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();

      mockAddProcess.emit('close', 0);

      const result = await createPromise;

      expect(result).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already exists')
      );
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', expect.any(String), '--force'],
        expect.any(Object)
      );

      jest.useRealTimers();
    });

    test('executes git worktree add command', async () => {
      const job = {
        id: 3,
        task_id: 3,
        project: { system_path: '/test' }
      };

      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();
      mockVersionProcess.kill = jest.fn();

      const mockWorktreeProcess = new EventEmitter();
      mockWorktreeProcess.stdout = new EventEmitter();
      mockWorktreeProcess.stderr = new EventEmitter();
      mockWorktreeProcess.kill = jest.fn();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockVersionProcess;
        return mockWorktreeProcess;
      });

      fs.access.mockRejectedValue(new Error('ENOENT'));

      const createPromise = manager.createWorktree(job);

      mockVersionProcess.emit('close', 0);

      // Wait for promise to resolve and continue to next git command
      await new Promise(resolve => setImmediate(resolve));

      expect(spawn).toHaveBeenCalledWith(
        'git',
        [
          'worktree',
          'add',
          '-b',
          'blaster/ticket-3/job-3',
          '/test-worktrees/job-3',
          'HEAD'
        ],
        expect.any(Object)
      );

      mockWorktreeProcess.emit('close', 0);

      await createPromise;
    });

    test('creates branch with -b flag', async () => {
      const job = {
        id: 4,
        task_id: 4,
        project: { system_path: '/test' }
      };

      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();
      mockVersionProcess.kill = jest.fn();

      const mockWorktreeProcess = new EventEmitter();
      mockWorktreeProcess.stdout = new EventEmitter();
      mockWorktreeProcess.stderr = new EventEmitter();
      mockWorktreeProcess.kill = jest.fn();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockVersionProcess;
        return mockWorktreeProcess;
      });

      fs.access.mockRejectedValue(new Error('ENOENT'));

      const createPromise = manager.createWorktree(job);

      mockVersionProcess.emit('close', 0);

      // Wait for promise to continue to next git command
      await new Promise(resolve => setImmediate(resolve));

      mockWorktreeProcess.emit('close', 0);

      await createPromise;

      expect(spawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['-b', 'blaster/ticket-4/job-4']),
        expect.any(Object)
      );
    });

    test('generates correct path', async () => {
      const job = {
        id: 5,
        task_id: 5,
        project: { system_path: '/test/project' }
      };

      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();
      mockVersionProcess.kill = jest.fn();

      const mockWorktreeProcess = new EventEmitter();
      mockWorktreeProcess.stdout = new EventEmitter();
      mockWorktreeProcess.stderr = new EventEmitter();
      mockWorktreeProcess.kill = jest.fn();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockVersionProcess;
        return mockWorktreeProcess;
      });

      fs.access.mockRejectedValue(new Error('ENOENT'));

      const createPromise = manager.createWorktree(job);

      mockVersionProcess.emit('close', 0);

      // Wait for promise to continue to next git command
      await new Promise(resolve => setImmediate(resolve));

      mockWorktreeProcess.emit('close', 0);

      const result = await createPromise;

      expect(result).toBe('/test/project-worktrees/job-5');
    });

    test('handles error and logs correctly', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 6,
        task_id: 6,
        project: { system_path: '/test' }
      };

      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockVersionProcess);
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const createPromise = manager.createWorktree(job);

      mockVersionProcess.stderr.emit('data', Buffer.from('Git error'));
      mockVersionProcess.emit('close', 1);

      await expect(createPromise).rejects.toThrow('Failed to create worktree');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create worktree'),
        expect.any(Object)
      );
    });

    test('includes error details in thrown error', async () => {
      const job = {
        id: 7,
        task_id: 7,
        project: { system_path: '/test' }
      };

      const mockVersionProcess = new EventEmitter();
      mockVersionProcess.stdout = new EventEmitter();
      mockVersionProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockVersionProcess);
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const createPromise = manager.createWorktree(job);

      mockVersionProcess.stderr.emit('data', Buffer.from('Permission denied'));
      mockVersionProcess.emit('close', 128);

      try {
        await createPromise;
      } catch (error) {
        expect(error.message).toContain('Permission denied');
      }
    });
  });

  describe('removeWorktree()', () => {
    test('removes worktree with valid job', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 8,
        task_id: 8,
        project: { system_path: '/test' }
      };

      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const removePromise = manager.removeWorktree(job);

      mockProcess.emit('close', 0);

      await removePromise;

      expect(logger.event).toHaveBeenCalledWith(
        'worktree.removing',
        expect.objectContaining({
          component: 'worktree',
          operation: 'remove'
        })
      );
      expect(logger.event).toHaveBeenCalledWith(
        'worktree.removed',
        expect.objectContaining({
          component: 'worktree',
          operation: 'remove'
        })
      );
    });

    test('uses --force flag for removal', async () => {
      const job = {
        id: 9,
        task_id: 9,
        project: { system_path: '/test' }
      };

      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const removePromise = manager.removeWorktree(job);

      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', expect.any(String), '--force'],
        expect.any(Object)
      );

      mockProcess.emit('close', 0);

      await removePromise;
    });

    test('handles errors gracefully without throwing', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 10,
        task_id: 10,
        project: { system_path: '/test' }
      };

      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const removePromise = manager.removeWorktree(job);

      mockProcess.stderr.emit('data', Buffer.from('Worktree not found'));
      mockProcess.emit('close', 1);

      // Should not throw
      await expect(removePromise).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove worktree'),
        expect.any(Object)
      );
    });

    test('logs errors but continues execution', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 11,
        task_id: 11,
        project: { system_path: '/test' }
      };

      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const removePromise = manager.removeWorktree(job);

      mockProcess.emit('error', new Error('Git not found'));

      await removePromise;

      expect(logger.error).toHaveBeenCalled();
    });

    test('does not delete branch after removal', async () => {
      const job = {
        id: 12,
        task_id: 12,
        project: { system_path: '/test' }
      };

      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const removePromise = manager.removeWorktree(job);

      mockProcess.emit('close', 0);

      await removePromise;

      // Should only call git worktree remove, not git branch -d
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove']),
        expect.any(Object)
      );
    });
  });

  describe('getWorktreePath()', () => {
    test('generates worktree path with correct format', () => {
      const job = {
        id: 13,
        project: { system_path: '/test/path' }
      };

      const path = manager.getWorktreePath(job);

      expect(path).toBe('/test/path-worktrees/job-13');
    });

    test('generates path with different job IDs', () => {
      const job1 = {
        id: 100,
        project: { system_path: '/test' }
      };

      const job2 = {
        id: 200,
        project: { system_path: '/test' }
      };

      const path1 = manager.getWorktreePath(job1);
      const path2 = manager.getWorktreePath(job2);

      expect(path1).toBe('/test-worktrees/job-100');
      expect(path2).toBe('/test-worktrees/job-200');
      expect(path1).not.toBe(path2);
    });

    test('handles different system paths', () => {
      const job = {
        id: 1,
        project: { system_path: '/different/path' }
      };

      const path = manager.getWorktreePath(job);

      expect(path).toBe('/different/path-worktrees/job-1');
    });
  });

  describe('getBranchName()', () => {
    test('generates branch name with format blaster/ticket-X/job-Y', () => {
      const job = {
        id: 14,
        task_id: 15
      };

      const branchName = manager.getBranchName(job);

      expect(branchName).toBe('blaster/ticket-15/job-14');
    });

    test('generates branch name with different task and job IDs', () => {
      const job1 = {
        id: 100,
        task_id: 200
      };

      const job2 = {
        id: 300,
        task_id: 400
      };

      const branch1 = manager.getBranchName(job1);
      const branch2 = manager.getBranchName(job2);

      expect(branch1).toBe('blaster/ticket-200/job-100');
      expect(branch2).toBe('blaster/ticket-400/job-300');
    });

    test('uses task_id not task for ticket number', () => {
      const job = {
        id: 50,
        task_id: 99
      };

      const branchName = manager.getBranchName(job);

      expect(branchName).toContain('ticket-99');
    });
  });

  describe('execGit()', () => {
    test('executes git command successfully', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status']);

      mockProcess.stdout.emit('data', Buffer.from('On branch main'));
      mockProcess.emit('close', 0);

      const result = await execPromise;

      expect(result.stdout).toBe('On branch main');
      expect(result.stderr).toBe('');
    });

    test('executes with custom timeout', async () => {
      jest.useFakeTimers();
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status'], 5000);

      jest.advanceTimersByTime(5001);

      await expect(execPromise).rejects.toThrow('timed out after 5000ms');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      jest.useRealTimers();
    });

    test('cleans up process on timeout', async () => {
      jest.useFakeTimers();
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status'], 1000);

      jest.advanceTimersByTime(1001);

      await expect(execPromise).rejects.toThrow();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      jest.useRealTimers();
    });

    test('captures stdout correctly', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['log']);

      mockProcess.stdout.emit('data', Buffer.from('commit 1\n'));
      mockProcess.stdout.emit('data', Buffer.from('commit 2\n'));
      mockProcess.emit('close', 0);

      const result = await execPromise;

      expect(result.stdout).toBe('commit 1\ncommit 2\n');
    });

    test('captures stderr correctly', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status']);

      mockProcess.stderr.emit('data', Buffer.from('Warning: something\n'));
      mockProcess.emit('close', 0);

      const result = await execPromise;

      expect(result.stderr).toBe('Warning: something\n');
    });

    test('resolves on exit code 0', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status']);

      mockProcess.stdout.emit('data', Buffer.from('Success'));
      mockProcess.emit('close', 0);

      await expect(execPromise).resolves.toEqual({
        stdout: 'Success',
        stderr: ''
      });
    });

    test('rejects on non-zero exit code', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['invalid']);

      mockProcess.stderr.emit('data', Buffer.from('Invalid command'));
      mockProcess.emit('close', 1);

      await expect(execPromise).rejects.toThrow('Git command failed (exit code 1)');
    });

    test('handles spawn errors', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status']);

      mockProcess.emit('error', new Error('ENOENT: git not found'));

      await expect(execPromise).rejects.toThrow('Failed to execute git');
    });

    test('uses shell=false for security', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status']);

      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['status'],
        expect.objectContaining({ shell: false })
      );

      mockProcess.emit('close', 0);
      await execPromise;
    });

    test('includes stderr in error message when command fails', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['fail']);

      mockProcess.stderr.emit('data', Buffer.from('fatal: bad object'));
      mockProcess.emit('close', 128);

      try {
        await execPromise;
      } catch (error) {
        expect(error.message).toContain('fatal: bad object');
      }
    });

    test('uses default timeout of 30 seconds', async () => {
      jest.useFakeTimers();
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status']);

      // Advance to just before default timeout
      jest.advanceTimersByTime(29999);

      // Should not timeout yet
      expect(mockProcess.kill).not.toHaveBeenCalled();

      // Advance past default timeout
      jest.advanceTimersByTime(2);

      await expect(execPromise).rejects.toThrow('timed out after 30000ms');
      jest.useRealTimers();
    });

    test('clears timeout on success', async () => {
      jest.useFakeTimers();
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status'], 10000);

      mockProcess.emit('close', 0);

      await execPromise;

      // Advance past timeout - should not reject
      jest.advanceTimersByTime(10001);

      expect(mockProcess.kill).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('clears timeout on error', async () => {
      jest.useFakeTimers();
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status'], 10000);

      mockProcess.emit('error', new Error('Spawn failed'));

      await expect(execPromise).rejects.toThrow('Failed to execute git');

      jest.advanceTimersByTime(10001);

      // Should not call kill again
      expect(mockProcess.kill).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('does not reject twice on timeout', async () => {
      jest.useFakeTimers();
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      spawn.mockReturnValue(mockProcess);

      const execPromise = manager.execGit('/test', ['status'], 1000);

      jest.advanceTimersByTime(1001);

      // Process closes after timeout
      mockProcess.emit('close', 1);

      await expect(execPromise).rejects.toThrow('timed out');
      jest.useRealTimers();
    });
  });
});
