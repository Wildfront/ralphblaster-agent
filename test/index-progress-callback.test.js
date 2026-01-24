const RalphAgent = require('../src/index');
const ApiClient = require('../src/api-client');
const Executor = require('../src/executor');

jest.mock('../src/api-client');
jest.mock('../src/executor');
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'error'
}));
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setJobContext: jest.fn(),
  clearJobContext: jest.fn()
}));

describe('RalphAgent Progress Callback Error Handling', () => {
  let agent;
  let mockApiClient;
  let mockExecutor;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApiClient = {
      getNextJob: jest.fn(),
      markJobRunning: jest.fn(),
      markJobCompleted: jest.fn(),
      markJobFailed: jest.fn(),
      sendProgress: jest.fn(),
      sendHeartbeat: jest.fn(),
      sendStatusEvent: jest.fn().mockResolvedValue(),
      addSetupLog: jest.fn().mockResolvedValue()
    };

    mockExecutor = {
      execute: jest.fn(),
      killCurrentProcess: jest.fn(),
      currentProcess: null
    };

    ApiClient.mockImplementation(() => mockApiClient);
    Executor.mockImplementation(() => mockExecutor);

    agent = new RalphAgent();
  });

  afterEach(() => {
    agent.isRunning = false;
    if (agent.heartbeatInterval) {
      clearInterval(agent.heartbeatInterval);
    }
  });

  describe('Progress callback in processJob()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('job completes successfully even when progress update fails', async () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test task'
      };

      // sendProgress will fail
      mockApiClient.sendProgress.mockRejectedValue(
        new Error('Network error sending progress')
      );

      // But execute succeeds
      let progressCallback;
      mockExecutor.execute.mockImplementation(async (job, callback) => {
        progressCallback = callback;
        // Simulate some progress
        await callback('Progress chunk 1\n');
        await callback('Progress chunk 2\n');
        return {
          output: 'Success',
          executionTimeMs: 1000,
          prdContent: 'PRD content'
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      // Job should still complete
      expect(mockApiClient.markJobCompleted).toHaveBeenCalledWith(
        123,
        expect.objectContaining({ output: 'Success' })
      );
      expect(mockApiClient.markJobFailed).not.toHaveBeenCalled();
    });

    test('progress callback is called during execution', async () => {
      const job = {
        id: 456,
        job_type: 'code_execution',
        task_title: 'Implement feature',
        project: { system_path: '/test/path' }
      };

      mockApiClient.sendProgress.mockResolvedValue();

      let progressCallback;
      mockExecutor.execute.mockImplementation(async (job, callback) => {
        progressCallback = callback;
        await callback('Starting...\n');
        jest.advanceTimersByTime(100); // Allow throttle to pass
        await callback('Processing...\n');
        jest.advanceTimersByTime(100); // Allow throttle to pass
        await callback('Done!\n');
        return {
          output: 'Complete',
          summary: 'Task done',
          branchName: 'feature-branch',
          executionTimeMs: 2000
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      expect(mockApiClient.sendProgress).toHaveBeenCalledTimes(3);
      expect(mockApiClient.sendProgress).toHaveBeenNthCalledWith(1, 456, 'Starting...\n');
      expect(mockApiClient.sendProgress).toHaveBeenNthCalledWith(2, 456, 'Processing...\n');
      expect(mockApiClient.sendProgress).toHaveBeenNthCalledWith(3, 456, 'Done!\n');
    });

    test('progress updates continue after one fails', async () => {
      const job = {
        id: 789,
        job_type: 'prd_generation',
        task_title: 'Test task'
      };

      // First progress fails, rest succeed
      mockApiClient.sendProgress
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue();

      let progressCallback;
      mockExecutor.execute.mockImplementation(async (job, callback) => {
        progressCallback = callback;
        await callback('Chunk 1\n');
        jest.advanceTimersByTime(100); // Allow throttle to pass
        await callback('Chunk 2\n');
        jest.advanceTimersByTime(100); // Allow throttle to pass
        await callback('Chunk 3\n');
        return {
          output: 'Success',
          executionTimeMs: 1000,
          prdContent: 'PRD'
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      // All three should be attempted
      expect(mockApiClient.sendProgress).toHaveBeenCalledTimes(3);
      expect(mockApiClient.markJobCompleted).toHaveBeenCalled();
    });

    test('executor does not fail when progress callback throws', async () => {
      const job = {
        id: 999,
        job_type: 'code_execution',
        task_title: 'Test',
        project: { system_path: '/test' }
      };

      mockApiClient.sendProgress.mockRejectedValue(
        new Error('Server unavailable')
      );

      mockExecutor.execute.mockImplementation(async (job, callback) => {
        // Progress callback should not throw back to executor
        await callback('Test output');
        return {
          output: 'Done',
          summary: 'Complete',
          branchName: 'test-branch',
          executionTimeMs: 500
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await expect(agent.processJob(job)).resolves.toBeUndefined();
      expect(mockApiClient.markJobCompleted).toHaveBeenCalled();
      expect(mockApiClient.markJobFailed).not.toHaveBeenCalled();
    });

    test('progress callback handles empty chunks gracefully', async () => {
      const job = {
        id: 111,
        job_type: 'prd_generation',
        task_title: 'Test'
      };

      mockApiClient.sendProgress.mockResolvedValue();

      mockExecutor.execute.mockImplementation(async (job, callback) => {
        await callback('');
        jest.advanceTimersByTime(100);
        await callback('Valid output');
        jest.advanceTimersByTime(100);
        await callback('');
        return {
          output: 'Done',
          executionTimeMs: 100,
          prdContent: 'PRD'
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      expect(mockApiClient.sendProgress).toHaveBeenCalledTimes(3);
      expect(mockApiClient.markJobCompleted).toHaveBeenCalled();
    });

    test('multiple progress errors are all logged without failing job', async () => {
      const job = {
        id: 222,
        job_type: 'code_execution',
        task_title: 'Test',
        project: { system_path: '/test' }
      };

      // All progress updates fail
      mockApiClient.sendProgress.mockRejectedValue(
        new Error('Network timeout')
      );

      mockExecutor.execute.mockImplementation(async (job, callback) => {
        await callback('Output 1');
        jest.advanceTimersByTime(100);
        await callback('Output 2');
        jest.advanceTimersByTime(100);
        await callback('Output 3');
        jest.advanceTimersByTime(100);
        await callback('Output 4');
        jest.advanceTimersByTime(100);
        await callback('Output 5');
        return {
          output: 'Complete',
          summary: 'Done',
          branchName: 'branch',
          executionTimeMs: 1000
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      expect(mockApiClient.sendProgress).toHaveBeenCalledTimes(5);
      expect(mockApiClient.markJobCompleted).toHaveBeenCalled();
      expect(mockApiClient.markJobFailed).not.toHaveBeenCalled();
    });
  });

  describe('Progress callback throttling', () => {
    let originalDateNow;
    let currentTime;

    beforeEach(() => {
      // Mock Date.now() to control time
      currentTime = 1000000;
      originalDateNow = Date.now;
      Date.now = jest.fn(() => currentTime);
    });

    afterEach(() => {
      // Restore original Date.now()
      Date.now = originalDateNow;
    });

    test('throttles rapid progress updates to max 10 per second', async () => {
      const job = {
        id: 333,
        job_type: 'prd_generation',
        task_title: 'Test throttling'
      };

      mockApiClient.sendProgress.mockResolvedValue();

      mockExecutor.execute.mockImplementation(async (job, callback) => {
        // Simulate rapid progress updates (20 updates in quick succession)
        for (let i = 0; i < 20; i++) {
          await callback(`Output ${i}`);
          currentTime += 10; // Advance 10ms between updates
        }
        return {
          output: 'Done',
          executionTimeMs: 200,
          prdContent: 'PRD'
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      // With 100ms throttle, only ~2 updates should go through (200ms / 100ms)
      // First update always goes through, then one more after 100ms
      expect(mockApiClient.sendProgress.mock.calls.length).toBeLessThan(20);
      expect(mockApiClient.sendProgress.mock.calls.length).toBeGreaterThan(0);
    });

    test('allows progress update after throttle period expires', async () => {
      const job = {
        id: 444,
        job_type: 'prd_generation',
        task_title: 'Test throttle expiry'
      };

      mockApiClient.sendProgress.mockResolvedValue();

      mockExecutor.execute.mockImplementation(async (job, callback) => {
        await callback('Update 1');
        currentTime += 50; // Less than 100ms throttle
        await callback('Update 2'); // Should be throttled

        currentTime += 60; // Total 110ms, more than 100ms throttle
        await callback('Update 3'); // Should go through

        return {
          output: 'Done',
          executionTimeMs: 110,
          prdContent: 'PRD'
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      // Should have 2 updates: first one and the one after throttle expires
      expect(mockApiClient.sendProgress).toHaveBeenCalledTimes(2);
      expect(mockApiClient.sendProgress).toHaveBeenNthCalledWith(1, 444, 'Update 1');
      expect(mockApiClient.sendProgress).toHaveBeenNthCalledWith(2, 444, 'Update 3');
    });

    test('allows progress updates across different jobs', async () => {
      const job1 = {
        id: 555,
        job_type: 'prd_generation',
        task_title: 'Job 1'
      };

      const job2 = {
        id: 556,
        job_type: 'prd_generation',
        task_title: 'Job 2'
      };

      mockApiClient.sendProgress.mockResolvedValue();

      // Process first job
      mockExecutor.execute.mockImplementation(async (job, callback) => {
        await callback('Job 1 update');
        return {
          output: 'Done',
          executionTimeMs: 100,
          prdContent: 'PRD'
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job1);

      // Advance time between jobs
      currentTime += 100;

      // Process second job - throttle should be reset
      mockExecutor.execute.mockImplementation(async (job, callback) => {
        await callback('Job 2 update');
        return {
          output: 'Done',
          executionTimeMs: 100,
          prdContent: 'PRD'
        };
      });

      await agent.processJob(job2);

      // Both updates should go through (throttle resets per job)
      expect(mockApiClient.sendProgress).toHaveBeenCalledWith(555, 'Job 1 update');
      expect(mockApiClient.sendProgress).toHaveBeenCalledWith(556, 'Job 2 update');
    });

    test('throttling does not affect job completion', async () => {
      const job = {
        id: 666,
        job_type: 'code_execution',
        task_title: 'Test',
        project: { system_path: '/test' }
      };

      mockApiClient.sendProgress.mockResolvedValue();

      mockExecutor.execute.mockImplementation(async (job, callback) => {
        // Rapid updates
        for (let i = 0; i < 100; i++) {
          await callback(`Line ${i}`);
          currentTime += 5; // Very rapid
        }
        return {
          output: 'Complete',
          summary: 'Done',
          branchName: 'branch',
          executionTimeMs: 500
        };
      });

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();

      await agent.processJob(job);

      // Job should still complete successfully despite throttling
      expect(mockApiClient.markJobCompleted).toHaveBeenCalledWith(
        666,
        expect.objectContaining({ output: 'Complete' })
      );
      expect(mockApiClient.markJobFailed).not.toHaveBeenCalled();
    });
  });
});
