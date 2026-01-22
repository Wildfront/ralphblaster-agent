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
      sendStatusEvent: jest.fn().mockResolvedValue()
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
        await callback('Processing...\n');
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
        await callback('Chunk 2\n');
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
        await callback('Valid output');
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
        await callback('Output 2');
        await callback('Output 3');
        await callback('Output 4');
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
});
