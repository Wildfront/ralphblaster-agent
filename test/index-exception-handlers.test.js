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

describe('RalphAgent Exception Handlers', () => {
  let agent;
  let mockApiClient;
  let mockExecutor;
  let originalProcessOn;
  let processListeners;

  beforeEach(() => {
    jest.clearAllMocks();

    // Capture process.on listeners
    processListeners = {};
    originalProcessOn = process.on;
    process.on = jest.fn((event, handler) => {
      processListeners[event] = handler;
      return process;
    });

    // Create mock instances
    mockApiClient = {
      getNextJob: jest.fn(),
      markJobRunning: jest.fn(),
      markJobCompleted: jest.fn(),
      markJobFailed: jest.fn(),
      sendProgress: jest.fn(),
      sendHeartbeat: jest.fn()
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
    process.on = originalProcessOn;
  });

  describe('setupShutdownHandlers()', () => {
    test('registers SIGINT handler', () => {
      agent.setupShutdownHandlers();

      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    test('registers SIGTERM handler', () => {
      agent.setupShutdownHandlers();

      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    test('registers uncaughtException handler', () => {
      agent.setupShutdownHandlers();

      expect(process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    });

    test('registers unhandledRejection handler', () => {
      agent.setupShutdownHandlers();

      expect(process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    });

    test('SIGINT handler calls stop()', async () => {
      jest.useFakeTimers();
      const stopSpy = jest.spyOn(agent, 'stop');

      agent.setupShutdownHandlers();

      // Trigger SIGINT
      processListeners.SIGINT();

      expect(stopSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    test('SIGTERM handler calls stop()', async () => {
      jest.useFakeTimers();
      const stopSpy = jest.spyOn(agent, 'stop');

      agent.setupShutdownHandlers();

      // Trigger SIGTERM
      processListeners.SIGTERM();

      expect(stopSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    test('uncaughtException handler calls stop()', async () => {
      jest.useFakeTimers();
      const stopSpy = jest.spyOn(agent, 'stop');

      agent.setupShutdownHandlers();

      // Trigger uncaught exception
      const testError = new Error('Uncaught test error');
      processListeners.uncaughtException(testError);

      expect(stopSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    test('unhandledRejection handler calls stop()', async () => {
      jest.useFakeTimers();
      const stopSpy = jest.spyOn(agent, 'stop');

      agent.setupShutdownHandlers();

      // Trigger unhandled rejection
      const testReason = 'Promise rejection reason';
      const testPromise = Promise.reject(testReason);

      // Prevent Node.js from seeing this as an unhandled rejection
      testPromise.catch(() => {});

      processListeners.unhandledRejection(testReason, testPromise);

      expect(stopSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    test('uncaughtException handler receives error object', () => {
      const stopSpy = jest.spyOn(agent, 'stop').mockImplementation(() => {});

      agent.setupShutdownHandlers();

      const testError = new Error('Database connection failed');
      processListeners.uncaughtException(testError);

      expect(stopSpy).toHaveBeenCalled();
      // The handler should have received the error (though it just logs it)
    });

    test('unhandledRejection handler receives reason and promise', () => {
      const stopSpy = jest.spyOn(agent, 'stop').mockImplementation(() => {});

      agent.setupShutdownHandlers();

      const testReason = { code: 'ERR_NETWORK', message: 'Network failure' };
      const testPromise = Promise.reject(testReason);

      // Prevent Node.js from seeing this as an unhandled rejection
      testPromise.catch(() => {});

      processListeners.unhandledRejection(testReason, testPromise);

      expect(stopSpy).toHaveBeenCalled();
    });
  });
});
