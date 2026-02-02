const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const Executor = require('../src/executor');

jest.mock('child_process');
jest.mock('fs', () => ({
  existsSync: jest.fn()
}));
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
  error: jest.fn(),
  event: jest.fn()
}));
jest.mock('../src/utils/log-file-helper', () => ({
  createJobLogStream: jest.fn(),
  writeCompletionFooterToStream: jest.fn(),
  createLogAndProgressCallbackStream: jest.fn()
}));
jest.mock('../src/executor/git-helper', () => {
  return jest.fn().mockImplementation(() => ({
    getCurrentBranch: jest.fn().mockResolvedValue('test-branch')
  }));
});

describe('Executor - Plan Generation', () => {
  let executor;
  let LogFileHelper;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get LogFileHelper mock
    LogFileHelper = require('../src/utils/log-file-helper');

    // Setup LogFileHelper mocks
    const mockStream = {
      write: jest.fn(),
      end: jest.fn()
    };

    LogFileHelper.createJobLogStream.mockResolvedValue({
      logFile: '/test/.rb-logs/job-1.log',
      logStream: mockStream
    });

    LogFileHelper.createLogAndProgressCallbackStream.mockImplementation((stream, onProgress) => {
      const callback = async (chunk) => {
        stream.write(chunk);
        if (onProgress) {
          onProgress(chunk);
        }
      };
      Object.defineProperty(callback, 'totalChunks', {
        get: () => 0
      });
      return callback;
    });

    fs.existsSync.mockReturnValue(true);
    executor = new Executor();
  });

  describe('executePlanGeneration()', () => {
    test('executes plan generation with valid job and prompt', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Create a plan for feature X',
        project: {
          system_path: '/test/path'
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

      const startTime = Date.now();
      const planPromise = executor.executePrdGeneration(job, jest.fn(), startTime);

      // Add minimal delay to ensure executionTimeMs > 0
      setTimeout(() => {
        // Emit stream-json formatted event with content
        const streamEvent = JSON.stringify({ type: 'content_block_delta', delta: { text: 'Plan content here' } });
        mockProcess.stdout.emit('data', Buffer.from(streamEvent + '\n'));
        mockProcess.emit('close', 0);
      }, 1);

      const result = await planPromise;

      expect(result.output).toBe('Plan content here');
      expect(result.prdContent).toBe('Plan content here');
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    test('uses server-provided prompt', async () => {
      const serverPrompt = 'Server generated prompt for planning';
      const job = {
        id: 2,
        prd_mode: 'plan',
        prompt: serverPrompt,
        project: { system_path: '/test' }
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

      const planPromise = executor.executePrdGeneration(job, jest.fn(), Date.now());

      // Wait for async operations to complete before emitting events
      setTimeout(() => {
        expect(mockProcess.stdin.write).toHaveBeenCalledWith(serverPrompt);
        mockProcess.stdout.emit('data', Buffer.from('Plan output'));
        mockProcess.emit('close', 0);
      }, 1);

      await planPromise;
    });

    test('parses plan generation output correctly', async () => {
      const job = {
        id: 3,
        prd_mode: 'plan',
        prompt: 'Test',
        project: { system_path: '/test' }
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

      const planPromise = executor.executePrdGeneration(job, jest.fn(), Date.now());

      const planContent = `
## Plan for Feature X

1. Step one
2. Step two
3. Step three
      `.trim();

      // Wait for async operations to complete before emitting events
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(planContent));
        mockProcess.emit('close', 0);
      }, 1);

      const result = await planPromise;

      expect(result.output).toContain('Step one');
      expect(result.prdContent).toContain('Step two');
    });

    test('tracks execution time accurately', async () => {
      const job = {
        id: 4,
        prd_mode: 'plan',
        prompt: 'Test',
        project: { system_path: '/test' }
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

      const startTime = Date.now();
      const planPromise = executor.executePrdGeneration(job, jest.fn(), startTime);

      // Simulate delay
      await new Promise(resolve => setTimeout(resolve, 50));

      mockProcess.stdout.emit('data', Buffer.from('Plan'));
      mockProcess.emit('close', 0);

      const result = await planPromise;

      expect(result.executionTimeMs).toBeGreaterThanOrEqual(50);
    });

    test('handles plan generation error and logs correctly', async () => {
      const logger = require('../src/logger');
      const job = {
        id: 5,
        prd_mode: 'plan',
        prompt: 'Test',
        project: { system_path: '/test' }
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

      const planPromise = executor.executePrdGeneration(job, jest.fn(), Date.now());

      // Wait for async operations to complete before emitting events
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Error occurred'));
        mockProcess.emit('close', 1);
      }, 1);

      await expect(planPromise).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Plan generation failed for job #5')
      );
    });

    test('handles missing project path gracefully', async () => {
      const job = {
        id: 6,
        prd_mode: 'plan',
        prompt: 'Test plan'
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

      const planPromise = executor.executePrdGeneration(job, jest.fn(), Date.now());

      // Wait for async operations to complete before checking spawn
      setTimeout(() => {
        // Should use process.cwd()
        expect(spawn).toHaveBeenCalledWith(
          'claude',
          ['-p', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--verbose'],
          expect.objectContaining({
            cwd: process.cwd()
          })
        );

        mockProcess.stdout.emit('data', Buffer.from('Plan'));
        mockProcess.emit('close', 0);
      }, 1);

      await planPromise;
    });

    test('handles invalid project path fallback', async () => {
      const job = {
        id: 7,
        prd_mode: 'plan',
        prompt: 'Test',
        project: {
          system_path: null
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

      const planPromise = executor.executePrdGeneration(job, jest.fn(), Date.now());

      // Wait for async operations to complete before checking spawn
      setTimeout(() => {
        expect(spawn).toHaveBeenCalledWith(
          'claude',
          ['-p', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--verbose'],
          expect.objectContaining({
            cwd: process.cwd()
          })
        );

        mockProcess.stdout.emit('data', Buffer.from('Plan'));
        mockProcess.emit('close', 0);
      }, 1);

      await planPromise;
    });

    test('forwards all Claude output to onProgress callback without filtering', async () => {
      const job = {
        id: 8,
        prd_mode: 'plan',
        prompt: 'Test',
        project: { system_path: '/test' }
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

      const onProgress = jest.fn();
      const planPromise = executor.executePrdGeneration(job, onProgress, Date.now());

      // Wait for async operations to complete before emitting events
      setTimeout(() => {
        // Emit various chunks - some that match keywords, some that don't
        mockProcess.stderr.emit('data', Buffer.from('Reading file.js\n'));
        mockProcess.stderr.emit('data', Buffer.from('Some other output\n'));
        mockProcess.stderr.emit('data', Buffer.from('Random debug info\n'));
        mockProcess.stderr.emit('data', Buffer.from('Analyzing code...\n'));

        // Emit final output and close
        mockProcess.stdout.emit('data', Buffer.from('Plan content'));
        mockProcess.emit('close', 0);
      }, 10);

      await planPromise;

      // Verify ALL chunks were forwarded (not filtered)
      // Note: The onProgress callback is wrapped by LogFileHelper, so we check
      // that it was called with all the chunks
      expect(onProgress).toHaveBeenCalledWith('Reading file.js\n');
      expect(onProgress).toHaveBeenCalledWith('Some other output\n');
      expect(onProgress).toHaveBeenCalledWith('Random debug info\n');
      expect(onProgress).toHaveBeenCalledWith('Analyzing code...\n');
    });
  });
});
