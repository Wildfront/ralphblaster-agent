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
jest.mock('child_process');
jest.mock('fs');

const GitHelper = require('../src/executor/git-helper');
const { spawn } = require('child_process');
const fs = require('fs');
const EventEmitter = require('events');

describe('GitHelper', () => {
  let gitHelper;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    gitHelper = new GitHelper();
    logger = require('../src/logger');
  });

  describe('runGitCommand', () => {
    test('resolves with output when git command succeeds', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.runGitCommand('/test/path', ['status']);

      mockProcess.stdout.emit('data', Buffer.from('On branch main\n'));
      mockProcess.stdout.emit('data', Buffer.from('nothing to commit\n'));
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('On branch main\nnothing to commit\n');
      expect(spawn).toHaveBeenCalledWith('git', ['status'], { cwd: '/test/path' });
    });

    test('rejects when git command fails with non-zero exit code', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.runGitCommand('/test/path', ['invalid']);

      mockProcess.emit('close', 1);

      await expect(promise).rejects.toThrow('Git command failed with code 1');
    });

    test('rejects when git process encounters an error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.runGitCommand('/test/path', ['status']);

      const error = new Error('spawn ENOENT');
      mockProcess.emit('error', error);

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    test('handles empty output', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.runGitCommand('/test/path', ['status']);

      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('');
    });

    test('accumulates multiple data chunks', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.runGitCommand('/test/path', ['log']);

      mockProcess.stdout.emit('data', Buffer.from('commit 1\n'));
      mockProcess.stdout.emit('data', Buffer.from('commit 2\n'));
      mockProcess.stdout.emit('data', Buffer.from('commit 3\n'));
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('commit 1\ncommit 2\ncommit 3\n');
    });
  });

  describe('getCurrentBranch', () => {
    test('returns trimmed branch name on success', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.getCurrentBranch('/test/worktree');

      mockProcess.stdout.emit('data', Buffer.from('  feature-branch  \n'));
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('feature-branch');
      expect(spawn).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: '/test/worktree' });
    });

    test('returns HEAD when in detached HEAD state', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.getCurrentBranch('/test/worktree');

      mockProcess.stdout.emit('data', Buffer.from('HEAD\n'));
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('HEAD');
    });

    test('throws error when git command fails', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.getCurrentBranch('/test/worktree');

      mockProcess.emit('close', 128);

      await expect(promise).rejects.toThrow('Git command failed with code 128');
    });

    test('throws error on git process error', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();

      spawn.mockReturnValue(mockProcess);

      const promise = gitHelper.getCurrentBranch('/test/worktree');

      const error = new Error('Not a git repository');
      mockProcess.emit('error', error);

      await expect(promise).rejects.toThrow('Not a git repository');
    });
  });

  describe('logGitActivity', () => {
    beforeEach(() => {
      fs.existsSync.mockReturnValue(true);
    });

    test('returns early with warning when worktree path is invalid', async () => {
      fs.existsSync.mockReturnValue(false);

      const result = await gitHelper.logGitActivity('/invalid/path', 'main', 'job-123');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Worktree not found for git activity logging: /invalid/path');
    });

    test('returns early with warning when worktree path is null', async () => {
      const result = await gitHelper.logGitActivity(null, 'main', 'job-123');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Worktree not found for git activity logging: null');
    });

    test('returns comprehensive summary when commits exist', async () => {
      // Setup mocks for all git commands
      let callIndex = 0;
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        // Schedule events asynchronously
        setImmediate(() => {
          if (args.includes('rev-list')) {
            // Commit count
            mockProcess.stdout.emit('data', Buffer.from('3\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('status')) {
            // Uncommitted changes
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('log')) {
            // Last commit info
            mockProcess.stdout.emit('data', Buffer.from('abc1234 - Add feature\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('branch')) {
            // Was pushed check
            mockProcess.stdout.emit('data', Buffer.from('origin/feature-branch\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('diff')) {
            // Change stats
            mockProcess.stdout.emit('data', Buffer.from('3 files changed, 50 insertions(+), 10 deletions(-)\n'));
            mockProcess.emit('close', 0);
          }
        });

        return mockProcess;
      });

      const result = await gitHelper.logGitActivity('/test/worktree', 'feature-branch', 'job-123');

      expect(result).toEqual({
        branchName: 'feature-branch',
        commitCount: 3,
        lastCommitInfo: 'abc1234 - Add feature',
        changeStats: '3 files changed, 50 insertions(+), 10 deletions(-)',
        wasPushed: true,
        hasUncommittedChanges: false,
        summaryText: expect.stringContaining('Git Activity Summary for Job #job-123')
      });

      expect(result.summaryText).toContain('Branch: feature-branch');
      expect(result.summaryText).toContain('New commits: 3');
      expect(result.summaryText).toContain('Latest commit: abc1234 - Add feature');
      expect(result.summaryText).toContain('Pushed to remote: YES ✓');
    });

    test('returns warning summary when no commits exist', async () => {
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        setImmediate(() => {
          if (args.includes('rev-list')) {
            mockProcess.stdout.emit('data', Buffer.from('0\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('status')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('branch')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('diff')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          }
        });

        return mockProcess;
      });

      const result = await gitHelper.logGitActivity('/test/worktree', 'feature-branch', 'job-456');

      expect(result).toEqual({
        branchName: 'feature-branch',
        commitCount: 0,
        lastCommitInfo: null,
        changeStats: null,
        wasPushed: false,
        hasUncommittedChanges: false,
        summaryText: expect.stringContaining('NO COMMITS MADE')
      });

      expect(result.summaryText).toContain('Ralph did not create any commits');
      expect(result.summaryText).toContain('No file changes detected');
    });

    test('detects uncommitted changes when no commits exist', async () => {
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        setImmediate(() => {
          if (args.includes('rev-list')) {
            mockProcess.stdout.emit('data', Buffer.from('0\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('status')) {
            mockProcess.stdout.emit('data', Buffer.from('M file.js\nA newfile.js\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('branch')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('diff')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          }
        });

        return mockProcess;
      });

      const result = await gitHelper.logGitActivity('/test/worktree', 'feature-branch', 'job-789');

      expect(result.hasUncommittedChanges).toBe(true);
      expect(result.summaryText).toContain('Uncommitted changes detected');
      expect(result.summaryText).toContain('work was done but not committed');
    });

    test('calls onProgress callback with summary text', async () => {
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        setImmediate(() => {
          if (args.includes('rev-list')) {
            mockProcess.stdout.emit('data', Buffer.from('1\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('status')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('log')) {
            mockProcess.stdout.emit('data', Buffer.from('xyz9876 - Fix bug\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('branch')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('diff')) {
            mockProcess.stdout.emit('data', Buffer.from('1 file changed, 5 insertions(+)\n'));
            mockProcess.emit('close', 0);
          }
        });

        return mockProcess;
      });

      const onProgress = jest.fn();
      const result = await gitHelper.logGitActivity('/test/worktree', 'bugfix', 'job-100', onProgress);

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Git Activity Summary'));
      expect(onProgress).toHaveBeenCalledWith(result.summaryText);
    });

    test('logs summary to logger', async () => {
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        setImmediate(() => {
          if (args.includes('rev-list')) {
            mockProcess.stdout.emit('data', Buffer.from('2\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('status')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('log')) {
            mockProcess.stdout.emit('data', Buffer.from('def5678 - Update docs\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('branch')) {
            mockProcess.stdout.emit('data', Buffer.from('origin/docs\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('diff')) {
            mockProcess.stdout.emit('data', Buffer.from('2 files changed, 30 insertions(+), 5 deletions(-)\n'));
            mockProcess.emit('close', 0);
          }
        });

        return mockProcess;
      });

      await gitHelper.logGitActivity('/test/worktree', 'docs', 'job-200');

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Git Activity Summary for Job #job-200'));
    });

    test('handles git errors gracefully without throwing', async () => {
      // When git commands fail, they resolve to default values (0, false, etc.)
      // This test verifies the function completes successfully even with git errors
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        setImmediate(() => {
          mockProcess.emit('error', new Error('git not found'));
        });

        return mockProcess;
      });

      const result = await gitHelper.logGitActivity('/test/worktree', 'feature', 'job-300');

      // Should return a valid result even when git commands fail
      expect(result).toBeDefined();
      expect(result.branchName).toBe('feature');
      expect(result.commitCount).toBe(0);
      expect(result.summaryText).toContain('NO COMMITS MADE');
    });

    test('detects when branch was not pushed to remote', async () => {
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        setImmediate(() => {
          if (args.includes('rev-list')) {
            mockProcess.stdout.emit('data', Buffer.from('1\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('status')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('log')) {
            mockProcess.stdout.emit('data', Buffer.from('aaa1111 - Local commit\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('branch')) {
            // No remote branches contain this commit
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('diff')) {
            mockProcess.stdout.emit('data', Buffer.from('1 file changed, 10 insertions(+)\n'));
            mockProcess.emit('close', 0);
          }
        });

        return mockProcess;
      });

      const result = await gitHelper.logGitActivity('/test/worktree', 'local-branch', 'job-400');

      expect(result.wasPushed).toBe(false);
      expect(result.summaryText).toContain('Pushed to remote: NO (local only)');
    });

    test('handles git command errors gracefully and continues', async () => {
      let callCount = 0;
      spawn.mockImplementation((cmd, args, options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();

        setImmediate(() => {
          callCount++;
          if (args.includes('rev-list')) {
            mockProcess.stdout.emit('data', Buffer.from('1\n'));
            mockProcess.emit('close', 0);
          } else if (args.includes('status')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('log')) {
            // Simulate error for log command
            mockProcess.emit('error', new Error('log failed'));
          } else if (args.includes('branch')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          } else if (args.includes('diff')) {
            mockProcess.stdout.emit('data', Buffer.from(''));
            mockProcess.emit('close', 0);
          }
        });

        return mockProcess;
      });

      const result = await gitHelper.logGitActivity('/test/worktree', 'test-branch', 'job-500');

      // Should still return a result despite the error
      expect(result.lastCommitInfo).toBe('Failed to get commit info');
      expect(result.commitCount).toBe(1);
    });
  });
});
