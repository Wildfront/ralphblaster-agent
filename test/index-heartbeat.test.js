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
  error: jest.fn()
}));

const ApiClient = require('../src/api-client');
const Executor = require('../src/executor');

describe('RalphAgent - Heartbeat', () => {
  let agent;
  let mockApiClient;
  let mockExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

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

  describe('startHeartbeat()', () => {
    test('sends heartbeat every 60s', () => {
      mockApiClient.sendHeartbeat.mockResolvedValue();

      agent.startHeartbeat(1);

      // No heartbeat yet
      expect(mockApiClient.sendHeartbeat).not.toHaveBeenCalled();

      // After 60 seconds
      jest.advanceTimersByTime(60000);
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(1);
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledWith(1);

      // After another 60 seconds
      jest.advanceTimersByTime(60000);
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(2);

      // After another 60 seconds
      jest.advanceTimersByTime(60000);
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(3);
    });

    test('sets heartbeatInterval', () => {
      agent.startHeartbeat(1);

      expect(agent.heartbeatInterval).not.toBeNull();
      expect(typeof agent.heartbeatInterval).toBe('object');
    });
  });

  describe('stopHeartbeat()', () => {
    test('clears interval', () => {
      agent.startHeartbeat(1);
      expect(agent.heartbeatInterval).not.toBeNull();

      agent.stopHeartbeat();

      expect(agent.heartbeatInterval).toBeNull();
    });

    test('stops sending heartbeats after stopped', () => {
      mockApiClient.sendHeartbeat.mockResolvedValue();

      agent.startHeartbeat(1);

      // First heartbeat
      jest.advanceTimersByTime(60000);
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(1);

      // Stop heartbeat
      agent.stopHeartbeat();

      // Advance time - should not send more heartbeats
      jest.advanceTimersByTime(60000);
      jest.advanceTimersByTime(60000);
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(1);
    });

    test('handles being called when no interval exists', () => {
      agent.heartbeatInterval = null;

      // Should not throw
      expect(() => agent.stopHeartbeat()).not.toThrow();
    });
  });

  describe('heartbeat error handling', () => {
    test('continues on API failure (logs warning)', async () => {
      mockApiClient.sendHeartbeat.mockRejectedValue(new Error('API error'));

      agent.startHeartbeat(1);

      // Advance to trigger heartbeat
      jest.advanceTimersByTime(60000);

      // Wait for promise to settle
      await Promise.resolve();

      // Heartbeat should have been attempted
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(1);

      // Interval should still be active - next heartbeat should still fire
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(2);
    });

    test('heartbeat continues after transient failures', async () => {
      // First call fails, second succeeds
      mockApiClient.sendHeartbeat
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce();

      agent.startHeartbeat(1);

      // First heartbeat fails
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(1);

      // Second heartbeat succeeds
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledTimes(2);
    });
  });
});
