const CodeExecutionHandler = require('../../src/executor/job-handlers/code-execution');
const WorktreeManager = require('../../src/worktree-manager');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

// Mock dependencies
jest.mock('../../src/worktree-manager');
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    appendFile: jest.fn()
  }
}));

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('CodeExecutionHandler', () => {
  let handler;
  let mockPromptValidator;
  let mockPathHelper;
  let mockClaudeRunner;
  let mockGitHelper;
  let mockApiClient;
  let mockWorktreeManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock prompt validator
    mockPromptValidator = {
      validatePrompt: jest.fn()
    };

    // Mock path helper
    mockPathHelper = {
      validateProjectPathStrict: jest.fn(),
      validateProjectPathWithFallback: jest.fn()
    };

    // Mock Claude runner
    mockClaudeRunner = {
      runClaudeDirectly: jest.fn(),
      resetCapturedStderr: jest.fn(),
      capturedStderr: ''
    };

    // Mock Git helper
    mockGitHelper = {
      logGitActivity: jest.fn()
    };

    // Mock API client
    mockApiClient = {
      sendStatusEvent: jest.fn(),
      updateJobMetadata: jest.fn()
    };

    // Mock WorktreeManager instance
    mockWorktreeManager = {
      createWorktree: jest.fn(),
      removeWorktree: jest.fn().mockResolvedValue(undefined),
      getBranchName: jest.fn()
    };
    WorktreeManager.mockImplementation(() => mockWorktreeManager);

    // Setup fs.promises mocks
    fsPromises.mkdir.mockResolvedValue(undefined);
    fsPromises.writeFile.mockResolvedValue(undefined);
    fsPromises.appendFile.mockResolvedValue(undefined);

    // Create handler instance
    handler = new CodeExecutionHandler(
      mockPromptValidator,
      mockPathHelper,
      mockClaudeRunner,
      mockGitHelper,
      mockApiClient
    );
  });

  describe('constructor', () => {
    test('initializes with all dependencies', () => {
      expect(handler.promptValidator).toBe(mockPromptValidator);
      expect(handler.pathHelper).toBe(mockPathHelper);
      expect(handler.claudeRunner).toBe(mockClaudeRunner);
      expect(handler.gitHelper).toBe(mockGitHelper);
      expect(handler.apiClient).toBe(mockApiClient);
    });

    test('works without optional apiClient', () => {
      const handlerWithoutApi = new CodeExecutionHandler(
        mockPromptValidator,
        mockPathHelper,
        mockClaudeRunner,
        mockGitHelper
      );
      expect(handlerWithoutApi.apiClient).toBeUndefined();
    });
  });

  describe('executeCodeImplementation()', () => {
    const createMockJob = (overrides = {}) => ({
      id: 1,
      job_type: 'code_execution',
      task_title: 'Test Task',
      prompt: 'Write some code',
      project: {
        system_path: '/test/project',
        auto_cleanup_worktrees: true
      },
      ...overrides
    });

    const mockOnProgress = jest.fn();
    const startTime = Date.now();

    describe('validation', () => {
      test('validates prompt for security', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 1,
          lastCommitInfo: {},
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockPromptValidator.validatePrompt).toHaveBeenCalledWith('Write some code');
      });

      test('throws error for invalid project path', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockImplementation(() => {
          throw new Error('Invalid or unsafe project path: /test/project');
        });

        await expect(handler.executeCodeImplementation(job, mockOnProgress, startTime))
          .rejects.toThrow('Invalid or unsafe project path: /test/project');
      });

      test('throws error for non-existent project path', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockImplementation(() => {
          throw new Error('Project path does not exist: /test/project');
        });

        await expect(handler.executeCodeImplementation(job, mockOnProgress, startTime))
          .rejects.toThrow('Project path does not exist: /test/project');
      });

      test('throws error when prompt is missing', async () => {
        const job = createMockJob({ prompt: '' });
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);

        await expect(handler.executeCodeImplementation(job, mockOnProgress, startTime))
          .rejects.toThrow('No prompt provided by server');
      });

      test('throws error when prompt is only whitespace', async () => {
        const job = createMockJob({ prompt: '   ' });
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);

        await expect(handler.executeCodeImplementation(job, mockOnProgress, startTime))
          .rejects.toThrow('No prompt provided by server');
      });
    });

    describe('worktree management', () => {
      test('creates worktree before execution', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockWorktreeManager.createWorktree).toHaveBeenCalledWith(job);
      });

      test('removes worktree on successful completion when auto-cleanup enabled', async () => {
        const job = createMockJob({ project: { system_path: '/test/project', auto_cleanup_worktrees: true } });
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockWorktreeManager.removeWorktree).toHaveBeenCalledWith(job);
      });

      test('keeps worktree when auto-cleanup disabled', async () => {
        const job = createMockJob({ project: { system_path: '/test/project', auto_cleanup_worktrees: false } });
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockWorktreeManager.getBranchName.mockReturnValue('feature/test');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockWorktreeManager.removeWorktree).not.toHaveBeenCalled();
      });

      test('removes worktree on error when auto-cleanup enabled', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockRejectedValue(new Error('Claude failed'));

        await expect(handler.executeCodeImplementation(job, mockOnProgress, startTime))
          .rejects.toThrow('Claude failed');

        expect(mockWorktreeManager.removeWorktree).toHaveBeenCalledWith(job);
      });
    });

    describe('Claude execution', () => {
      test('runs Claude in worktree with prompt', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
          '/test/worktree',
          'Write some code',
          job,
          mockOnProgress
        );
      });

      test('resets captured stderr before execution', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockClaudeRunner.resetCapturedStderr).toHaveBeenCalled();
      });
    });

    describe('git activity logging', () => {
      test('logs git activity after successful execution', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test-branch'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 2,
          lastCommitInfo: { sha: 'abc123' },
          changeStats: { files: 3 },
          wasPushed: true,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockGitHelper.logGitActivity).toHaveBeenCalledWith(
          '/test/worktree',
          'feature/test-branch',
          job.id,
          mockOnProgress
        );
      });

      test('includes git activity in result', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 2,
          lastCommitInfo: { sha: 'abc123' },
          changeStats: { files: 3 },
          wasPushed: true,
          hasUncommittedChanges: false
        });

        const result = await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(result.gitActivity).toEqual({
          commitCount: 2,
          lastCommit: { sha: 'abc123' },
          changes: { files: 3 },
          pushedToRemote: true,
          hasUncommittedChanges: false
        });
      });
    });

    describe('progress tracking', () => {
      test('sends setup events when apiClient available', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
          job.id,
          'setup_started',
          'Setting up workspace...'
        );
        expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
          job.id,
          'progress_update',
          'Initializing...',
          { percentage: 5 }
        );
      });

      test('sends git operation events', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree/ralph-job-1');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
          job.id,
          'git_operations',
          'Creating Git worktree...'
        );
        expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
          job.id,
          'git_operations',
          'Worktree ready at ralph-job-1'
        );
      });

      test('sends Claude started events', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
          job.id,
          'claude_started',
          'Claude is analyzing and executing the task...'
        );
      });

      test('sends completion events', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
          job.id,
          'job_completed',
          'Task completed successfully'
        );
        expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
          job.id,
          'progress_update',
          'Complete',
          { percentage: 100 }
        );
      });

      test('updates job metadata with worktree path', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(mockApiClient.updateJobMetadata).toHaveBeenCalledWith(
          job.id,
          { worktree_path: '/test/worktree' }
        );
      });

      test('works without apiClient', async () => {
        const handlerWithoutApi = new CodeExecutionHandler(
          mockPromptValidator,
          mockPathHelper,
          mockClaudeRunner,
          mockGitHelper
        );

        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        const result = await handlerWithoutApi.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(result).toBeDefined();
        expect(result.summary).toBe('Completed task: Test Task');
      });
    });

    describe('log file persistence', () => {
      test('saves execution output to log file', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'Claude output here',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(fsPromises.mkdir).toHaveBeenCalledWith(
          '/test/project/.rb-logs',
          { recursive: true }
        );
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
          '/test/project/.rb-logs/job-1.log',
          expect.stringContaining('Claude output here')
        );
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
          '/test/project/.rb-logs/job-1.log',
          expect.stringContaining('Job #1 - Test Task')
        );
      });

      test('saves stderr to separate error log if present', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.capturedStderr = 'Some error output';
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        expect(fsPromises.writeFile).toHaveBeenCalledWith(
          '/test/project/.rb-logs/job-1-stderr.log',
          'Some error output'
        );
      });

      test('does not save stderr log when empty', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.capturedStderr = '';
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        await handler.executeCodeImplementation(job, mockOnProgress, startTime);

        const writeFileCalls = fsPromises.writeFile.mock.calls;
        const stderrLogCall = writeFileCalls.find(call => call[0].includes('stderr.log'));
        expect(stderrLogCall).toBeUndefined();
      });

      test('saves error details to log file on failure', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');

        const error = new Error('Execution failed');
        error.category = 'execution_error';
        error.technicalDetails = 'Stack trace here';
        error.partialOutput = 'Partial output here';

        mockClaudeRunner.capturedStderr = 'Error stderr';
        mockClaudeRunner.runClaudeDirectly.mockRejectedValue(error);

        await expect(handler.executeCodeImplementation(job, mockOnProgress, startTime))
          .rejects.toThrow('Execution failed');

        expect(fsPromises.writeFile).toHaveBeenCalledWith(
          '/test/project/.rb-logs/job-1-error.log',
          expect.stringContaining('Job #1 - FAILED')
        );
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
          '/test/project/.rb-logs/job-1-error.log',
          expect.stringContaining('Execution failed')
        );
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
          '/test/project/.rb-logs/job-1-error.log',
          expect.stringContaining('execution_error')
        );
      });

      test('handles log save failures gracefully', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'test output',
          branchName: 'feature/test'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 0,
          lastCommitInfo: null,
          changeStats: {},
          wasPushed: false,
          hasUncommittedChanges: false
        });

        // Make log file writing fail
        fsPromises.writeFile.mockRejectedValue(new Error('Disk full'));

        // Should still succeed even if logging fails
        const result = await handler.executeCodeImplementation(job, mockOnProgress, startTime);
        expect(result).toBeDefined();
        expect(result.summary).toBe('Completed task: Test Task');
      });
    });

    describe('return value', () => {
      test('returns complete result object', async () => {
        const job = createMockJob();
        mockPathHelper.validateProjectPathStrict.mockReturnValue('/test/project');
        fs.existsSync.mockReturnValue(true);
        mockWorktreeManager.createWorktree.mockResolvedValue('/test/worktree');
        mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
          output: 'Claude output',
          branchName: 'feature/test-branch'
        });
        mockGitHelper.logGitActivity.mockResolvedValue({
          commitCount: 3,
          lastCommitInfo: { sha: 'abc123', message: 'Test commit' },
          changeStats: { files: 5, insertions: 100, deletions: 20 },
          wasPushed: true,
          hasUncommittedChanges: false
        });

        const testStartTime = Date.now();
        const result = await handler.executeCodeImplementation(job, mockOnProgress, testStartTime);

        expect(result).toEqual({
          output: 'Claude output',
          summary: 'Completed task: Test Task',
          branchName: 'feature/test-branch',
          executionTimeMs: expect.any(Number),
          gitActivity: {
            commitCount: 3,
            lastCommit: { sha: 'abc123', message: 'Test commit' },
            changes: { files: 5, insertions: 100, deletions: 20 },
            pushedToRemote: true,
            hasUncommittedChanges: false
          }
        });
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
