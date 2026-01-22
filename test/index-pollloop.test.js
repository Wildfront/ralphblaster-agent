const RalphAgent = require('../src/index');
const ApiClient = require('../src/api-client');
const Executor = require('../src/executor');

// Mock dependencies
jest.mock('../src/api-client');
jest.mock('../src/executor');
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'error'
}));

describe('RalphAgent Poll Loop', () => {
  let agent;
  let mockApiClient;
  let mockExecutor;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock instances
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

  describe('pollLoop()', () => {
    test('processes jobs when available and continues polling', async () => {
      jest.useFakeTimers();

      const job1 = { id: 1, job_type: 'prd_generation', task_title: 'Task 1' };
      const job2 = { id: 2, job_type: 'code_execution', task_title: 'Task 2', project: { system_path: '/path' } };

      let callCount = 0;
      mockApiClient.getNextJob.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(job1);
        if (callCount === 2) return Promise.resolve(job2);
        // Stop after 2 jobs
        agent.isRunning = false;
        return Promise.resolve(null);
      });

      mockExecutor.execute.mockResolvedValue({ output: 'success', executionTimeMs: 1000 });

      // Set isRunning to true before starting poll loop
      agent.isRunning = true;

      // Start the poll loop
      const pollPromise = agent.pollLoop();

      // Advance timers to allow sleep/delays to complete
      await jest.advanceTimersByTimeAsync(10000);

      // Wait for completion
      await pollPromise;

      expect(mockApiClient.getNextJob).toHaveBeenCalledTimes(3);
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    test('continues polling when no jobs available', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      mockApiClient.getNextJob.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve(null); // No jobs
        }
        // Stop after 3 attempts
        agent.isRunning = false;
        return Promise.resolve(null);
      });

      agent.isRunning = true;
      const pollPromise = agent.pollLoop();

      // Advance timers to allow sleep/delays to complete
      await jest.advanceTimersByTimeAsync(10000);

      await pollPromise;

      expect(mockApiClient.getNextJob).toHaveBeenCalledTimes(3);
      expect(mockExecutor.execute).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('stops polling when isRunning becomes false', async () => {
      jest.useFakeTimers();

      mockApiClient.getNextJob.mockImplementation(async () => {
        // Immediately stop
        agent.isRunning = false;
        return null;
      });

      agent.isRunning = true;
      const pollPromise = agent.pollLoop();

      // Advance timers
      await jest.advanceTimersByTimeAsync(1000);

      await pollPromise;

      expect(mockApiClient.getNextJob).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    test('handles errors in poll loop and retries after delay', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      mockApiClient.getNextJob.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network error');
        }
        // Stop after error
        agent.isRunning = false;
        return Promise.resolve(null);
      });

      agent.isRunning = true;

      // Start poll loop
      const pollPromise = agent.pollLoop();

      // Fast-forward time for initial delay + error retry delay
      await jest.advanceTimersByTimeAsync(10000);

      await pollPromise;

      expect(mockApiClient.getNextJob).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    test('polls for next job after processing with rate limiting', async () => {
      jest.useFakeTimers();

      const job = { id: 1, job_type: 'prd_generation', task_title: 'Task' };

      let callCount = 0;
      mockApiClient.getNextJob.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(job);
        // Stop after 1 job
        agent.isRunning = false;
        return Promise.resolve(null);
      });

      mockExecutor.execute.mockResolvedValue({ output: 'success', executionTimeMs: 1000 });

      agent.isRunning = true;
      const pollPromise = agent.pollLoop();

      // Advance timers to handle rate limiting
      await jest.advanceTimersByTimeAsync(5000);

      await pollPromise;

      expect(mockApiClient.getNextJob).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    test('handles multiple consecutive errors gracefully', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      mockApiClient.getNextJob.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error(`Error ${callCount}`);
        }
        agent.isRunning = false;
        return Promise.resolve(null);
      });

      agent.isRunning = true;
      const pollPromise = agent.pollLoop();

      // Fast-forward through error delays (with exponential backoff)
      await jest.advanceTimersByTimeAsync(20000);

      await pollPromise;

      expect(mockApiClient.getNextJob).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });
  });
});
