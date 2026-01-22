const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const Executor = require('../src/executor');

jest.mock('child_process');
jest.mock('fs');
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

describe('Executor - logGitActivity', () => {
  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new Executor();
    fs.existsSync.mockReturnValue(true);
    // Don't use fake timers for these tests - they interfere with async git operations
  });

  describe('logGitActivity - Basic Functionality', () => {
    test('logs git activity with valid worktree', async () => {
      const logger = require('../src/logger');

      // Mock commit count process
      const mockCommitCountProcess = new EventEmitter();
      mockCommitCountProcess.stdout = new EventEmitter();

      // Mock status process
      const mockStatusProcess = new EventEmitter();
      mockStatusProcess.stdout = new EventEmitter();

      // Mock log process
      const mockLogProcess = new EventEmitter();
      mockLogProcess.stdout = new EventEmitter();

      // Mock branch process
      const mockBranchProcess = new EventEmitter();
      mockBranchProcess.stdout = new EventEmitter();

      // Mock diff process
      const mockDiffProcess = new EventEmitter();
      mockDiffProcess.stdout = new EventEmitter();

      let spawnCallCount = 0;
      spawn.mockImplementation(() => {
        spawnCallCount++;
        if (spawnCallCount === 1) return mockCommitCountProcess;
        if (spawnCallCount === 2) return mockStatusProcess;
        if (spawnCallCount === 3) return mockLogProcess;
        if (spawnCallCount === 4) return mockBranchProcess;
        if (spawnCallCount === 5) return mockDiffProcess;
      });

      const promise = executor.logGitActivity('/worktree/path', 'feature/test', 123);

      // Allow promises to set up listeners
      await Promise.resolve();

      // Emit commit count
      mockCommitCountProcess.stdout.emit('data', Buffer.from('3\n'));
      mockCommitCountProcess.emit('close');

      // Emit status (uncommitted changes)
      mockStatusProcess.stdout.emit('data', Buffer.from(''));
      mockStatusProcess.emit('close');

      // Emit log
      mockLogProcess.stdout.emit('data', Buffer.from('abc1234 - Add feature\n'));
      mockLogProcess.emit('close');

      // Emit branch
      mockBranchProcess.stdout.emit('data', Buffer.from('origin/feature/test\n'));
      mockBranchProcess.emit('close');

      // Emit diff stats
      mockDiffProcess.stdout.emit('data', Buffer.from('5 files changed, 100 insertions(+)\n'));
      mockDiffProcess.emit('close');

      const result = await promise;

      expect(result.commitCount).toBe(3);
      expect(result.branchName).toBe('feature/test');
      expect(logger.info).toHaveBeenCalled();
    });

    test('returns early with warning when worktree not found', async () => {
      const logger = require('../src/logger');
      fs.existsSync.mockReturnValue(false);

      const result = await executor.logGitActivity('/nonexistent', 'branch', 1);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Worktree not found')
      );
    });

    test('returns early with warning when worktree is null', async () => {
      const logger = require('../src/logger');

      const result = await executor.logGitActivity(null, 'branch', 1);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('logGitActivity - Commit Count', () => {
    test('calculates commit count correctly', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('5'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('commit msg'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from('origin/branch'));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from('stats'));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.commitCount).toBe(5);
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['rev-list', '--count', 'HEAD', '^origin/main'],
        expect.any(Object)
      );
    });

    test('returns 0 commit count when git command fails', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        return mockProcess4;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      // Emit events asynchronously to ensure listeners are attached
      setImmediate(() => {
        // First process (commit count) fails
        mockProcess1.emit('error', new Error('Git not found'));

        // Remaining processes succeed
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from(''));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.commitCount).toBe(0);
    });

    test('handles invalid commit count output', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('not-a-number'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('msg'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from(''));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.commitCount).toBe(0);
    });
  });

  describe('logGitActivity - Uncommitted Changes', () => {
    test('detects uncommitted changes', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('1'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(' M file.js\n'));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('msg'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from(''));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.hasUncommittedChanges).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['status', '--porcelain'],
        expect.any(Object)
      );
    });

    test('returns false when no uncommitted changes', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('2'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('msg'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from(''));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.hasUncommittedChanges).toBe(false);
    });

    test('handles git status error gracefully', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        return mockProcess4;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        // Commit count returns 0
        mockProcess1.stdout.emit('data', Buffer.from('0'));
        mockProcess1.emit('close');
        // Status check fails
        mockProcess2.emit('error', new Error('Git error'));
        // Remaining processes (branch and diff - no log since commitCount is 0)
        mockProcess3.stdout.emit('data', Buffer.from(''));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.hasUncommittedChanges).toBe(false);
    });
  });

  describe('logGitActivity - Last Commit Info', () => {
    test('retrieves last commit info when commits exist', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('2'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('abc1234 - Add feature'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from(''));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.lastCommitInfo).toBe('abc1234 - Add feature');
    });

    test('returns "No commits yet" when commit count is 0', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        return mockProcess4;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        // Only 4 processes when commitCount is 0 (no git log)
        mockProcess1.stdout.emit('data', Buffer.from('0'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from(''));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.lastCommitInfo).toBeNull();
    });
  });

  describe('logGitActivity - Remote Push Status', () => {
    test('detects when branch is pushed to remote', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'feature/test', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('1'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('commit'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from('origin/feature/test\n'));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from('stats'));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.wasPushed).toBe(true);
    });

    test('detects when branch is NOT pushed to remote', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'feature/local-only', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('1'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('commit'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from('stats'));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.wasPushed).toBe(false);
    });
  });

  describe('logGitActivity - Change Stats', () => {
    test('retrieves file change statistics', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('1'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('commit'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from('3 files changed, 50 insertions(+), 10 deletions(-)'));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.changeStats).toBe('3 files changed, 50 insertions(+), 10 deletions(-)');
    });

    test('returns null change stats when no commits', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        return mockProcess4;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        // Only 4 processes when commitCount is 0 (no git log)
        mockProcess1.stdout.emit('data', Buffer.from('0'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from(''));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.changeStats).toBeNull();
    });
  });

  describe('logGitActivity - Summary Formatting', () => {
    test('builds comprehensive summary with commits', async () => {
      const logger = require('../src/logger');
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'feature/test', 456);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('3'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('abc1234 - Add feature'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from('origin/feature/test'));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from('5 files changed'));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.summaryText).toContain('Job #456');
      expect(result.summaryText).toContain('feature/test');
      expect(result.summaryText).toContain('New commits: 3');
      expect(result.summaryText).toContain('abc1234');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Job #456'));
    });

    test('builds warning summary when no commits', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        return mockProcess4;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        // Only 4 processes when commitCount is 0 (no git log)
        mockProcess1.stdout.emit('data', Buffer.from('0'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from(''));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.summaryText).toContain('NO COMMITS MADE');
    });

    test('warns about uncommitted changes when no commits', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        return mockProcess4;
      });

      const promise = executor.logGitActivity('/worktree', 'branch', 1);

      setImmediate(() => {
        // Only 4 processes when commitCount is 0 (no git log)
        mockProcess1.stdout.emit('data', Buffer.from('0'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(' M file.js'));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from(''));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result.summaryText).toContain('Uncommitted changes detected');
    });

    test('sends summary to progress callback when provided', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const onProgress = jest.fn();

      const promise = executor.logGitActivity('/worktree', 'branch', 1, onProgress);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('1'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('msg'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from(''));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Git Activity Summary'));
    });
  });

  describe('logGitActivity - Error Handling', () => {
    test('handles errors gracefully and returns error summary', async () => {
      const logger = require('../src/logger');

      spawn.mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const result = await executor.logGitActivity('/worktree', 'branch', 1);

      expect(result.commitCount).toBe(0);
      expect(result.error).toBe('Spawn failed');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to log git activity')
      );
    });
  });

  describe('logGitActivity - Summary Object Structure', () => {
    test('returns correctly structured summary object', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.stdout = new EventEmitter();
      const mockProcess2 = new EventEmitter();
      mockProcess2.stdout = new EventEmitter();
      const mockProcess3 = new EventEmitter();
      mockProcess3.stdout = new EventEmitter();
      const mockProcess4 = new EventEmitter();
      mockProcess4.stdout = new EventEmitter();
      const mockProcess5 = new EventEmitter();
      mockProcess5.stdout = new EventEmitter();

      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockProcess1;
        if (callCount === 2) return mockProcess2;
        if (callCount === 3) return mockProcess3;
        if (callCount === 4) return mockProcess4;
        return mockProcess5;
      });

      const promise = executor.logGitActivity('/worktree', 'feature/test', 1);

      setImmediate(() => {
        mockProcess1.stdout.emit('data', Buffer.from('2'));
        mockProcess1.emit('close');
        mockProcess2.stdout.emit('data', Buffer.from(''));
        mockProcess2.emit('close');
        mockProcess3.stdout.emit('data', Buffer.from('abc - message'));
        mockProcess3.emit('close');
        mockProcess4.stdout.emit('data', Buffer.from(''));
        mockProcess4.emit('close');
        mockProcess5.stdout.emit('data', Buffer.from('stats'));
        mockProcess5.emit('close');
      });

      // Give setImmediate a chance to run before awaiting
      await new Promise(resolve => setImmediate(resolve));

      const result = await promise;

      expect(result).toHaveProperty('branchName');
      expect(result).toHaveProperty('commitCount');
      expect(result).toHaveProperty('lastCommitInfo');
      expect(result).toHaveProperty('changeStats');
      expect(result).toHaveProperty('wasPushed');
      expect(result).toHaveProperty('hasUncommittedChanges');
      expect(result).toHaveProperty('summaryText');
    });
  });
});
