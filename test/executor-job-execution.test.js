const Executor = require('../src/executor');
const { spawn } = require('child_process');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

// Mock child_process
jest.mock('child_process');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    appendFile: jest.fn(),
    copyFile: jest.fn(),
    access: jest.fn()
  }
}));

// Mock config
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'info'
}));

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('Executor - Job Execution', () => {
  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new Executor();

    // Setup fs.promises mocks to return resolved promises
    fsPromises.mkdir.mockResolvedValue(undefined);
    fsPromises.writeFile.mockResolvedValue(undefined);
    fsPromises.appendFile.mockResolvedValue(undefined);
  });

  describe('execute()', () => {
    test('routes prd_generation jobs correctly', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      // Mock the executePrdGeneration method
      executor.executePrdGeneration = jest.fn().mockResolvedValue({
        output: 'PRD output',
        prdContent: 'PRD content',
        executionTimeMs: 1000
      });

      const result = await executor.execute(job, jest.fn());

      expect(executor.executePrdGeneration).toHaveBeenCalledWith(
        job,
        expect.any(Function),
        expect.any(Number)
      );
      expect(result.prdContent).toBe('PRD content');
    });

    test('routes code_execution jobs correctly', async () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test Code',
        prompt: 'Write code',
        project: {
          system_path: '/test/path'
        }
      };

      // Mock the executeCodeImplementation method
      executor.executeCodeImplementation = jest.fn().mockResolvedValue({
        output: 'Code output',
        summary: 'Implemented feature',
        branchName: 'feature/test',
        executionTimeMs: 2000
      });

      const result = await executor.execute(job, jest.fn());

      expect(executor.executeCodeImplementation).toHaveBeenCalledWith(
        job,
        expect.any(Function),
        expect.any(Number)
      );
      expect(result.summary).toBe('Implemented feature');
    });

    test('throws error for unknown job type', async () => {
      const job = {
        id: 1,
        job_type: 'unknown_type',
        task_title: 'Test'
      };

      await expect(executor.execute(job, jest.fn()))
        .rejects.toThrow('Unknown job type: unknown_type');
    });
  });

  describe('executeCodeImplementation()', () => {
    test('fails for non-existent path', async () => {
      const job = {
        id: 1,
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

    test('fails for invalid path', async () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test',
        prompt: 'Write code',
        project: {
          system_path: '/etc/passwd' // Should be blocked
        }
      };

      await expect(executor.executeCodeImplementation(job, jest.fn(), Date.now()))
        .rejects.toThrow('Invalid or unsafe project path');
    });
  });

  describe('executePrdGeneration()', () => {
    test('uses process.cwd() when no project path', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      // Mock spawn to return a successful process
      const mockProcess = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };

      spawn.mockReturnValue(mockProcess);

      // Simulate successful completion
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      });
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('PRD output')), 0);
        }
      });

      const promise = executor.executePrdGeneration(job, jest.fn(), Date.now());
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--permission-mode', 'acceptEdits', '--debug'],
        expect.objectContaining({
          cwd: process.cwd()
        })
      );
    });

    test('uses server-provided prompt when available', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Server provided prompt'
      };

      const mockProcess = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };

      spawn.mockReturnValue(mockProcess);

      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      });
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('PRD output')), 0);
        }
      });

      await executor.executePrdGeneration(job, jest.fn(), Date.now());

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('Server provided prompt');
    });
  });

  // parseOutput() tests removed - function no longer exists in refactored code
  // The new implementation uses direct Claude execution without RALPH_SUMMARY/RALPH_BRANCH markers
});
