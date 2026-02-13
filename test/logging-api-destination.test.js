/**
 * Tests for API log destinations (batched and unbatched)
 * Tests API client integration, batching, and error handling
 */

const ApiDestination = require('../src/logging/destinations/api-destination');
const ApiDestinationUnbatched = require('../src/logging/destinations/internal/api-destination-unbatched');

// Mock API client
class MockApiClient {
  constructor(config = {}) {
    this.addSetupLogCalls = [];
    this.addSetupLogBatchCalls = [];
    this.shouldFail = config.shouldFail || false;
    this.shouldFailBatch = config.shouldFailBatch || false;
  }

  async addSetupLog(jobId, level, message, metadata) {
    if (this.shouldFail) {
      throw new Error('API call failed');
    }
    this.addSetupLogCalls.push({ jobId, level, message, metadata });
  }

  async addSetupLogBatch(jobId, logs) {
    if (this.shouldFailBatch) {
      throw new Error('Batch API call failed');
    }
    this.addSetupLogBatchCalls.push({ jobId, logs });
  }
}

describe('ApiDestinationUnbatched', () => {
  let mockApiClient;

  beforeEach(() => {
    mockApiClient = new MockApiClient();
  });

  describe('Constructor', () => {
    test('requires apiClient in config', () => {
      expect(() => {
        new ApiDestinationUnbatched({ jobId: 123 });
      }).toThrow('ApiDestinationUnbatched requires apiClient');
    });

    test('requires jobId in config', () => {
      expect(() => {
        new ApiDestinationUnbatched({ apiClient: mockApiClient });
      }).toThrow('ApiDestinationUnbatched requires jobId');
    });

    test('accepts valid config', () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      expect(destination.apiClient).toBe(mockApiClient);
      expect(destination.jobId).toBe(123);
      expect(destination.useBatchEndpoint).toBe(true);
    });

    test('accepts useBatchEndpoint option', () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123,
        useBatchEndpoint: false
      });

      expect(destination.useBatchEndpoint).toBe(false);
    });

    test('rejects null jobId', () => {
      expect(() => {
        new ApiDestinationUnbatched({
          apiClient: mockApiClient,
          jobId: null
        });
      }).toThrow('ApiDestinationUnbatched requires jobId');
    });

    test('accepts jobId of 0', () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 0
      });

      expect(destination.jobId).toBe(0);
    });
  });

  describe('write()', () => {
    test('calls apiClient.addSetupLog with correct parameters', async () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 456
      });

      await destination.write('info', 'test message', { key: 'value' });

      expect(mockApiClient.addSetupLogCalls.length).toBe(1);
      expect(mockApiClient.addSetupLogCalls[0]).toEqual({
        jobId: 456,
        level: 'info',
        message: 'test message',
        metadata: { key: 'value' }
      });
    });

    test('sends null metadata when empty', async () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      await destination.write('warn', 'warning', {});

      expect(mockApiClient.addSetupLogCalls[0].metadata).toBeNull();
    });

    test('sends null metadata when not provided', async () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      await destination.write('error', 'error message');

      expect(mockApiClient.addSetupLogCalls[0].metadata).toBeNull();
    });

    test('handles API errors gracefully', async () => {
      mockApiClient.shouldFail = true;
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      // Should not throw
      await expect(
        destination.write('info', 'test')
      ).resolves.toBeUndefined();
    });

    test('calls handleError on API failure', async () => {
      mockApiClient.shouldFail = true;
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      const handleErrorSpy = jest.spyOn(destination, 'handleError');

      await destination.write('info', 'test');

      expect(handleErrorSpy).toHaveBeenCalledWith(
        expect.any(Error),
        'info',
        'test'
      );
    });
  });

  describe('sendBatch()', () => {
    test('calls apiClient.addSetupLogBatch when useBatchEndpoint is true', async () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 789,
        useBatchEndpoint: true
      });

      const logs = [
        { level: 'info', message: 'log 1', metadata: { a: 1 } },
        { level: 'warn', message: 'log 2', metadata: { b: 2 } }
      ];

      await destination.sendBatch(logs);

      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(1);
      expect(mockApiClient.addSetupLogBatchCalls[0]).toEqual({
        jobId: 789,
        logs
      });
    });

    test('falls back to individual sends when useBatchEndpoint is false', async () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123,
        useBatchEndpoint: false
      });

      const logs = [
        { level: 'info', message: 'log 1', metadata: { a: 1 } },
        { level: 'warn', message: 'log 2', metadata: { b: 2 } }
      ];

      await destination.sendBatch(logs);

      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(0);
      expect(mockApiClient.addSetupLogCalls.length).toBe(2);
    });

    test('falls back to individual sends when batch method unavailable', async () => {
      // Create a mock without batch method
      const noBatchClient = {
        addSetupLog: jest.fn().mockResolvedValue(undefined),
        addSetupLogCalls: []
      };
      noBatchClient.addSetupLog.mockImplementation(async (jobId, level, message, metadata) => {
        noBatchClient.addSetupLogCalls.push({ jobId, level, message, metadata });
      });

      const destination = new ApiDestinationUnbatched({
        apiClient: noBatchClient,
        jobId: 123,
        useBatchEndpoint: true
      });

      const logs = [
        { level: 'info', message: 'log 1', metadata: { id: 1 } }
      ];

      await destination.sendBatch(logs);

      expect(noBatchClient.addSetupLogCalls.length).toBe(1);
      expect(noBatchClient.addSetupLogCalls[0].message).toBe('log 1');
    });

    test('handles empty batch gracefully', async () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      await expect(destination.sendBatch([])).resolves.toBeUndefined();

      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(0);
      expect(mockApiClient.addSetupLogCalls.length).toBe(0);
    });

    test('throws on batch send failure', async () => {
      mockApiClient.shouldFailBatch = true;
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      const logs = [{ level: 'info', message: 'test', metadata: {} }];

      await expect(destination.sendBatch(logs)).rejects.toThrow('Batch API call failed');
    });

    test('handles individual send failures in fallback', async () => {
      mockApiClient.shouldFail = true;
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123,
        useBatchEndpoint: false
      });

      const logs = [
        { level: 'info', message: 'log 1', metadata: {} },
        { level: 'warn', message: 'log 2', metadata: {} }
      ];

      // Should not throw (errors caught internally)
      await expect(destination.sendBatch(logs)).resolves.toBeUndefined();
    });
  });

  describe('sendIndividually()', () => {
    test('sends logs one by one', async () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      const logs = [
        { level: 'info', message: 'first', metadata: { id: 1 } },
        { level: 'warn', message: 'second', metadata: { id: 2 } },
        { level: 'error', message: 'third', metadata: { id: 3 } }
      ];

      await destination.sendIndividually(logs);

      expect(mockApiClient.addSetupLogCalls.length).toBe(3);
      expect(mockApiClient.addSetupLogCalls[0].message).toBe('first');
      expect(mockApiClient.addSetupLogCalls[1].message).toBe('second');
      expect(mockApiClient.addSetupLogCalls[2].message).toBe('third');
    });

    test('continues on individual failures', async () => {
      let callCount = 0;
      mockApiClient.addSetupLog = jest.fn(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Second call failed');
        }
      });

      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      const logs = [
        { level: 'info', message: 'first', metadata: {} },
        { level: 'info', message: 'second', metadata: {} },
        { level: 'info', message: 'third', metadata: {} }
      ];

      // Should not throw
      await expect(
        destination.sendIndividually(logs)
      ).resolves.toBeUndefined();

      // All three should be attempted
      expect(mockApiClient.addSetupLog).toHaveBeenCalledTimes(3);
    });
  });

  describe('handleError()', () => {
    test('is silent by default', () => {
      const destination = new ApiDestinationUnbatched({
        apiClient: mockApiClient,
        jobId: 123
      });

      const error = new Error('test error');

      // Should not throw or log
      expect(() => {
        destination.handleError(error, 'info', 'test message');
      }).not.toThrow();
    });
  });
});

describe('ApiDestination (batched)', () => {
  let mockApiClient;

  beforeEach(() => {
    mockApiClient = new MockApiClient();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('requires apiClient', () => {
      expect(() => {
        new ApiDestination({ jobId: 123 });
      }).toThrow();
    });

    test('requires jobId', () => {
      expect(() => {
        new ApiDestination({ apiClient: mockApiClient });
      }).toThrow();
    });

    test('creates batched destination with config', () => {
      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        maxBatchSize: 20,
        flushInterval: 5000,
        useBatchEndpoint: false
      });

      expect(destination.destination).toBeDefined();
      expect(destination.destination).toBeInstanceOf(ApiDestinationUnbatched);
      expect(destination.maxBatchSize).toBe(20);
      expect(destination.flushInterval).toBe(5000);
      expect(destination.useBatchSend).toBe(false);
    });
  });

  describe('Integration with batching', () => {
    test('buffers logs before sending', async () => {
      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        maxBatchSize: 5
      });

      await destination.write('info', 'message 1');
      await destination.write('info', 'message 2');
      await destination.write('info', 'message 3');

      // Should be buffered, not sent yet
      expect(mockApiClient.addSetupLogCalls.length).toBe(0);
      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(0);

      await destination.close();
    });

    test('flushes on maxBatchSize', async () => {
      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        maxBatchSize: 3
      });

      await destination.write('info', 'message 1');
      await destination.write('info', 'message 2');
      await destination.write('info', 'message 3'); // Should trigger flush

      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(1);
      expect(mockApiClient.addSetupLogBatchCalls[0].logs.length).toBe(3);

      await destination.close();
    });

    test('flushes on timer interval', async () => {
      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        flushInterval: 1000
      });

      await destination.write('info', 'message');

      // Advance timer
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(1);

      await destination.close();
    });

    test('uses batch endpoint by default', async () => {
      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        maxBatchSize: 2
      });

      await destination.write('info', 'message 1');
      await destination.write('info', 'message 2');

      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(1);
      expect(mockApiClient.addSetupLogCalls.length).toBe(0);

      await destination.close();
    });

    test('falls back to individual sends on batch failure', async () => {
      mockApiClient.shouldFailBatch = true;

      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        maxBatchSize: 2
      });

      await destination.write('info', 'message 1');
      await destination.write('info', 'message 2');

      // Batch should fail, fall back to individual
      expect(mockApiClient.addSetupLogCalls.length).toBe(2);

      await destination.close();
    });

    test('flushes remaining logs on close', async () => {
      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        maxBatchSize: 10
      });

      await destination.write('info', 'message 1');
      await destination.write('info', 'message 2');

      // Close should flush
      await destination.close();

      expect(mockApiClient.addSetupLogBatchCalls.length).toBe(1);
      expect(mockApiClient.addSetupLogBatchCalls[0].logs.length).toBe(2);
    });
  });

  describe('Error handling', () => {
    test('continues on API errors', async () => {
      mockApiClient.shouldFail = true;

      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        useBatchEndpoint: false, // Use individual sends
        maxBatchSize: 2
      });

      // Should not throw
      await expect(async () => {
        await destination.write('info', 'message 1');
        await destination.write('info', 'message 2');
        await destination.close();
      }).not.toThrow();
    });

    test('handles batch and fallback both failing', async () => {
      mockApiClient.shouldFailBatch = true;
      mockApiClient.shouldFail = true;

      const destination = new ApiDestination({
        apiClient: mockApiClient,
        jobId: 123,
        maxBatchSize: 2
      });

      // Should not throw
      await expect(async () => {
        await destination.write('info', 'message 1');
        await destination.write('info', 'message 2');
        await destination.close();
      }).not.toThrow();
    });
  });
});
