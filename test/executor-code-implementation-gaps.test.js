const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const Executor = require('../src/executor');
const WorktreeManager = require('../src/worktree-manager');
const RalphInstanceManager = require('../src/ralph-instance-manager');

jest.mock('child_process');
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    copyFile: jest.fn(),
    access: jest.fn()
  }
}));
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'info'
}));
jest.mock('../src/worktree-manager');
jest.mock('../src/ralph-instance-manager');
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('Executor - Code Implementation Gaps', () => {
  let executor;
  let mockApiClient;

  // Helper to emit events after async operations complete
  const emitAfterSpawn = async (mockProcess, data, exitCode) => {
    await new Promise(resolve => setImmediate(resolve));
    mockProcess.stdout.emit('data', Buffer.from(data));
    mockProcess.emit('close', exitCode);
  };

  const emitErrorAfterSpawn = async (mockProcess, errorData, exitCode) => {
    await new Promise(resolve => setImmediate(resolve));
    mockProcess.stderr.emit('data', Buffer.from(errorData));
    mockProcess.emit('close', exitCode);
  };

  // Helper to setup spawn mock with git processes for logGitActivity
  const setupSpawnWithGitProcesses = () => {
    const mockProcess = new EventEmitter();
    mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.killed = false;

    // Mock git processes for logGitActivity
    const mockGitProcesses = [];
    for (let i = 0; i < 5; i++) {
      const gitProcess = new EventEmitter();
      gitProcess.stdout = new EventEmitter();
      gitProcess.stderr = new EventEmitter();
      mockGitProcesses.push(gitProcess);
    }

    let spawnCallCount = 0;
    spawn.mockImplementation(() => {
      spawnCallCount++;
      if (spawnCallCount === 1) return mockProcess; // Ralph process
      return mockGitProcesses[spawnCallCount - 2]; // Git processes
    });

    return { mockProcess, mockGitProcesses };
  };

  // Helper to emit git process events
  const emitGitProcessEvents = async (mockGitProcesses) => {
    await new Promise(resolve => setImmediate(() => {
      mockGitProcesses.forEach(gitProc => {
        gitProc.stdout.emit('data', Buffer.from('0'));
        gitProc.emit('close', 0);
      });
      resolve();
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient = {
      sendStatusEvent: jest.fn().mockResolvedValue({}),
      updateJobMetadata: jest.fn().mockResolvedValue({})
    };
    executor = new Executor(mockApiClient);

    // Setup default mocks
    fs.existsSync.mockReturnValue(true);
    fsPromises.mkdir.mockResolvedValue(undefined);
    fsPromises.writeFile.mockResolvedValue(undefined);
    fsPromises.copyFile.mockResolvedValue(undefined);
    fsPromises.access.mockResolvedValue(undefined);

    // Mock logGitActivity to avoid spawning git processes in these tests
    executor.logGitActivity = jest.fn().mockResolvedValue({
      branchName: 'test-branch',
      commitCount: 1,
      lastCommitInfo: 'abc1234 - Test commit',
      changeStats: '1 file changed',
      wasPushed: false,
      hasUncommittedChanges: false,
      summaryText: 'Git summary'
    });
  });

  describe('executeCodeImplementation - Path Validation', () => {
    test('fails with invalid project path', async () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: null
        }
      };

      await expect(executor.executeCodeImplementation(job, jest.fn(), Date.now()))
        .rejects.toThrow('Invalid or unsafe project path');
    });

    test('fails with missing project path', async () => {
      const job = {
        id: 2,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {}
      };

      await expect(executor.executeCodeImplementation(job, jest.fn(), Date.now()))
        .rejects.toThrow('Invalid or unsafe project path');
    });

    test('fails when project path does not exist', async () => {
      const job = {
        id: 3,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/nonexistent/path'
        }
      };

      fs.existsSync.mockReturnValue(false);

      await expect(executor.executeCodeImplementation(job, jest.fn(), Date.now()))
        .rejects.toThrow('Project path does not exist');
    });
  });

  describe('executeCodeImplementation - Prompt Validation', () => {
    test('fails with empty prompt', async () => {
      const job = {
        id: 4,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: '',
        project: {
          system_path: '/valid/path'
        }
      };

      await expect(executor.executeCodeImplementation(job, jest.fn(), Date.now()))
        .rejects.toThrow('No prompt provided by server');
    });

    test('fails with whitespace-only prompt', async () => {
      const job = {
        id: 5,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: '   \n  \t  ',
        project: {
          system_path: '/valid/path'
        }
      };

      await expect(executor.executeCodeImplementation(job, jest.fn(), Date.now()))
        .rejects.toThrow('No prompt provided by server');
    });

    test('validates prompt before execution', async () => {
      const job = {
        id: 6,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'rm -rf /',
        project: {
          system_path: '/valid/path'
        }
      };

      await expect(executor.executeCodeImplementation(job, jest.fn(), Date.now()))
        .rejects.toThrow('dangerous deletion command');
    });
  });

  describe('executeCodeImplementation - Worktree Flow', () => {
    test('creates worktree before execution', async () => {
      const job = {
        id: 7,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-7')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockWorktreeManager.createWorktree).toHaveBeenCalledWith(job);
    });

    test('cleans up worktree when auto-cleanup enabled', async () => {
      const job = {
        id: 8,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path',
          auto_cleanup_worktrees: true
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-8')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockWorktreeManager.removeWorktree).toHaveBeenCalledWith(job);
    });

    test('preserves worktree when auto-cleanup disabled', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 9,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path',
          auto_cleanup_worktrees: false
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-9')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockWorktreeManager.removeWorktree).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Auto-cleanup disabled')
      );
    });

    test('cleans up worktree on execution failure', async () => {
      const job = {
        id: 10,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path',
          auto_cleanup_worktrees: true
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-10')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(false),
        readProgressSummary: jest.fn().mockResolvedValue('Failed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      // Attach error handler immediately to prevent unhandled rejection warning
      const errorPromise = execPromise.catch(err => err);

      await emitErrorAfterSpawn(mockProcess, 'Error', 2);
      await emitGitProcessEvents(mockGitProcesses);

      // Wait for the promise to settle
      const error = await errorPromise;
      expect(error).toBeDefined();
      expect(error.message).toContain('exit code 2');

      // Cleanup should still happen
      expect(mockWorktreeManager.removeWorktree).toHaveBeenCalled();
    });
  });

  describe('executeCodeImplementation - Ralph Instance Creation', () => {
    test('creates Ralph instance with correct parameters', async () => {
      const job = {
        id: 11,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-11')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockRalphManager.createInstance).toHaveBeenCalledWith(
        '/worktree/path',
        'Write code',
        11
      );
    });
  });

  describe('executeCodeImplementation - Log File Saving', () => {
    test('saves execution log to .ralph-logs directory', async () => {
      const job = {
        id: 12,
        job_type: 'code_execution',
        task_title: 'Test Task',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-12')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Ralph output', 0);
      await emitGitProcessEvents(mockGitProcesses);

      await execPromise;

      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.ralph-logs'),
        { recursive: true }
      );

      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('job-12.log'),
        expect.stringContaining('Test Task')
      );
    });

    test('creates log directory when it does not exist', async () => {
      const job = {
        id: 13,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-13')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });

    test('copies progress.txt to logs', async () => {
      const job = {
        id: 14,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-14')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(fsPromises.copyFile).toHaveBeenCalledWith(
        expect.stringContaining('progress.txt'),
        expect.stringContaining('job-14-progress.txt')
      );
    });

    test('copies prd.json to logs', async () => {
      const job = {
        id: 15,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-15')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(fsPromises.copyFile).toHaveBeenCalledWith(
        expect.stringContaining('prd.json'),
        expect.stringContaining('job-15-prd.json')
      );
    });

    test('handles missing progress.txt gracefully', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 16,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-16')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      // Mock file access to reject for progress.txt
      fsPromises.access = jest.fn().mockRejectedValue(new Error('File not found'));

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);
      await emitGitProcessEvents(mockGitProcesses);

      const result = await execPromise;

      // Should complete successfully even without progress.txt
      expect(result.ralphComplete).toBe(true);
    });
  });

  describe('executeCodeImplementation - Completion Signal Detection', () => {
    test('detects completion signal correctly', async () => {
      const job = {
        id: 17,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-17')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Completed successfully'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);
      await emitGitProcessEvents(mockGitProcesses);

      const result = await execPromise;

      expect(result.ralphComplete).toBe(true);
      expect(mockRalphManager.hasCompletionSignal).toHaveBeenCalled();
    });
  });

  describe('executeCodeImplementation - Progress Summary', () => {
    test('reads progress summary from instance', async () => {
      const job = {
        id: 18,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-18')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Implementation complete'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);
      await emitGitProcessEvents(mockGitProcesses);

      const result = await execPromise;

      expect(result.summary).toBe('Implementation complete');
      expect(mockRalphManager.readProgressSummary).toHaveBeenCalledWith('/instance/path');
    });
  });

  describe('executeCodeImplementation - Branch Name Retrieval', () => {
    test('gets branch name from prd.json', async () => {
      const job = {
        id: 19,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-19')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue('feature/from-prd')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);
      await emitGitProcessEvents(mockGitProcesses);

      const result = await execPromise;

      expect(result.branchName).toBe('feature/from-prd');
    });

    test('falls back to worktreeManager for branch name', async () => {
      const job = {
        id: 20,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-20')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue(null)  // No branch from prd.json
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);
      await emitGitProcessEvents(mockGitProcesses);

      const result = await execPromise;

      expect(result.branchName).toBe('ralph/ticket-1/job-20');
      expect(mockWorktreeManager.getBranchName).toHaveBeenCalledWith(job);
    });
  });

  describe('executeCodeImplementation - Status Events', () => {
    test('emits setup_started event', async () => {
      const job = {
        id: 21,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-21')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Output'));
        mockProcess.emit('close', 0);
      });

      await execPromise;

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        21,
        'setup_started',
        'Setting up workspace...'
      );
    });

    test('emits git_operations events', async () => {
      const job = {
        id: 22,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/test'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-22')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        22,
        'git_operations',
        'Creating Git worktree...'
      );

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        22,
        'git_operations',
        expect.stringContaining('Worktree ready at')
      );
    });

    test('emits claude_started event', async () => {
      const job = {
        id: 23,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-23')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        23,
        'claude_started',
        'Claude is analyzing and executing the task...'
      );
    });

    test('emits progress_update events', async () => {
      const job = {
        id: 24,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-24')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        24,
        'progress_update',
        expect.any(String),
        expect.objectContaining({ percentage: expect.any(Number) })
      );
    });

    test('emits job_completed event', async () => {
      const job = {
        id: 25,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-25')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      const mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;

      spawn.mockReturnValue(mockProcess);

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);

      await execPromise;

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        25,
        'job_completed',
        'Task completed successfully'
      );
    });
  });

  describe('executeCodeImplementation - Git Activity Metadata', () => {
    test('includes gitActivity in result object', async () => {
      const job = {
        id: 26,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/valid/path'
        }
      };

      const mockWorktreeManager = {
        createWorktree: jest.fn().mockResolvedValue('/worktree/path'),
        removeWorktree: jest.fn().mockResolvedValue(undefined),
        getBranchName: jest.fn().mockReturnValue('ralph/ticket-1/job-26')
      };

      const mockRalphManager = {
        createInstance: jest.fn().mockResolvedValue('/instance/path'),
        hasCompletionSignal: jest.fn().mockReturnValue(true),
        readProgressSummary: jest.fn().mockResolvedValue('Done'),
        getBranchName: jest.fn().mockResolvedValue('feature/test')
      };

      WorktreeManager.mockImplementation(() => mockWorktreeManager);
      RalphInstanceManager.mockImplementation(() => mockRalphManager);

      // Mock logGitActivity
      executor.logGitActivity = jest.fn().mockResolvedValue({
        commitCount: 3,
        lastCommitInfo: 'abc1234 - Add feature',
        changeStats: '5 files changed, 100 insertions(+)',
        wasPushed: true,
        hasUncommittedChanges: false
      });

      const { mockProcess, mockGitProcesses } = setupSpawnWithGitProcesses();

      const execPromise = executor.executeCodeImplementation(job, jest.fn(), Date.now());

      await emitAfterSpawn(mockProcess, 'Output', 0);
      await emitGitProcessEvents(mockGitProcesses);

      const result = await execPromise;

      expect(result.gitActivity).toEqual({
        commitCount: 3,
        lastCommit: 'abc1234 - Add feature',
        changes: '5 files changed, 100 insertions(+)',
        pushedToRemote: true,
        hasUncommittedChanges: false
      });
    });
  });
});
