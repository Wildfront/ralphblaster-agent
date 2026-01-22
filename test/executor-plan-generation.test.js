const { spawn } = require('child_process');
const { EventEmitter } = require('events');
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

describe('Executor - Plan Generation', () => {
  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new Executor();
  });

  describe('executePlanGeneration()', () => {
    test('executes plan generation with valid job and prompt', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
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
      const planPromise = executor.executePlanGeneration(job, jest.fn(), startTime);

      // Add minimal delay to ensure executionTimeMs > 0
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('Plan content here'));
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

      const planPromise = executor.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockProcess.stdin.write).toHaveBeenCalledWith(serverPrompt);

      mockProcess.stdout.emit('data', Buffer.from('Plan output'));
      mockProcess.emit('close', 0);

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

      const planPromise = executor.executePlanGeneration(job, jest.fn(), Date.now());

      const planContent = `
## Plan for Feature X

1. Step one
2. Step two
3. Step three
      `.trim();

      mockProcess.stdout.emit('data', Buffer.from(planContent));
      mockProcess.emit('close', 0);

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
      const planPromise = executor.executePlanGeneration(job, jest.fn(), startTime);

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

      const planPromise = executor.executePlanGeneration(job, jest.fn(), Date.now());

      mockProcess.stderr.emit('data', Buffer.from('Error occurred'));
      mockProcess.emit('close', 1);

      await expect(planPromise).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Plan generation failed for job #5'),
        expect.any(String)
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

      const planPromise = executor.executePlanGeneration(job, jest.fn(), Date.now());

      // Should use process.cwd()
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--permission-mode', 'acceptEdits'],
        expect.objectContaining({
          cwd: process.cwd()
        })
      );

      mockProcess.stdout.emit('data', Buffer.from('Plan'));
      mockProcess.emit('close', 0);

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

      const planPromise = executor.executePlanGeneration(job, jest.fn(), Date.now());

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--permission-mode', 'acceptEdits'],
        expect.objectContaining({
          cwd: process.cwd()
        })
      );

      mockProcess.stdout.emit('data', Buffer.from('Plan'));
      mockProcess.emit('close', 0);

      await planPromise;
    });
  });
});
