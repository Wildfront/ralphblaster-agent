const RalphAgent = require('../src/index');

// Mock dependencies
jest.mock('../src/api-client');
jest.mock('../src/executor');
jest.mock('../src/config', () => ({
  apiUrl: 'http://localhost:3000',
  apiToken: 'test-token',
  pollInterval: 5000
}));
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setJobContext: jest.fn(),
  clearJobContext: jest.fn()
}));

const ApiClient = require('../src/api-client');
const Executor = require('../src/executor');

describe('RalphAgent - Graceful Shutdown', () => {
  let agent;
  let mockApiClient;
  let mockExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup mocks
    mockApiClient = {
      getNextJob: jest.fn(),
      markJobRunning: jest.fn(),
      markJobCompleted: jest.fn(),
      markJobFailed: jest.fn(),
      sendHeartbeat: jest.fn(),
      sendProgress: jest.fn()
    };

    mockExecutor = {
      execute: jest.fn(),
      currentProcess: null,
      killCurrentProcess: jest.fn()
    };

    ApiClient.mockImplementation(() => mockApiClient);
    Executor.mockImplementation(() => mockExecutor);

    agent = new RalphAgent();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('stop()', () => {
    test('clears heartbeat interval', async () => {
      agent.heartbeatInterval = setInterval(() => {}, 1000);
      const intervalId = agent.heartbeatInterval;

      await agent.stop();

      expect(agent.heartbeatInterval).toBeNull();
    });

    test('kills running Claude process', async () => {
      mockExecutor.currentProcess = { kill: jest.fn() };

      await agent.stop();

      expect(mockExecutor.killCurrentProcess).toHaveBeenCalled();
    });

    test('marks current job as failed', async () => {
      agent.currentJob = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test'
      };

      mockApiClient.markJobFailed.mockResolvedValue();

      await agent.stop();

      expect(mockApiClient.markJobFailed).toHaveBeenCalledWith(
        1,
        'Agent shutdown during execution'
      );
    });

    test('handles case when no current job', async () => {
      agent.currentJob = null;

      await agent.stop();

      expect(mockApiClient.markJobFailed).not.toHaveBeenCalled();
    });

    test('handles error when marking job failed during shutdown', async () => {
      agent.currentJob = { id: 1 };
      mockApiClient.markJobFailed.mockRejectedValue(new Error('API error'));

      // Should not throw
      await expect(agent.stop()).resolves.not.toThrow();
    });
  });

  describe('processJob() - stopHeartbeat called', () => {
    test('stopHeartbeat is called before marking job complete', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test'
      };

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobCompleted.mockResolvedValue();
      mockApiClient.sendStatusEvent = jest.fn().mockResolvedValue();
      mockExecutor.execute.mockResolvedValue({
        output: 'output',
        executionTimeMs: 1000
      });

      const callOrder = [];
      const stopHeartbeatSpy = jest.spyOn(agent, 'stopHeartbeat').mockImplementation(() => {
        callOrder.push('stopHeartbeat');
      });
      mockApiClient.markJobCompleted.mockImplementation(async () => {
        callOrder.push('markJobCompleted');
      });

      await agent.processJob(job);

      expect(stopHeartbeatSpy).toHaveBeenCalled();
      expect(callOrder).toEqual(['stopHeartbeat', 'markJobCompleted']);
    });

    test('stopHeartbeat is called before marking job failed', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test'
      };

      mockApiClient.markJobRunning.mockResolvedValue();
      mockApiClient.markJobFailed.mockResolvedValue();
      mockApiClient.sendStatusEvent = jest.fn().mockResolvedValue();
      mockExecutor.execute.mockRejectedValue(new Error('Execution failed'));

      const callOrder = [];
      const stopHeartbeatSpy = jest.spyOn(agent, 'stopHeartbeat').mockImplementation(() => {
        callOrder.push('stopHeartbeat');
      });
      mockApiClient.markJobFailed.mockImplementation(async () => {
        callOrder.push('markJobFailed');
      });

      await agent.processJob(job);

      expect(stopHeartbeatSpy).toHaveBeenCalled();
      expect(callOrder).toEqual(['stopHeartbeat', 'markJobFailed']);
    });
  });
});
