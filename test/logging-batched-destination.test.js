/**
 * Tests for BatchedDestination
 * Tests batching behavior, flush timing, and error handling
 */

const BatchedDestination = require('../src/logging/destinations/batched-destination');
const BaseDestination = require('../src/logging/destinations/base-destination');

// Mock destination for testing
class MockDestination extends BaseDestination {
  constructor(config = {}) {
    super(config);
    this.writes = [];
    this.batches = [];
    this.writeDelay = config.writeDelay || 0;
    this.shouldFail = config.shouldFail || false;
    this.batchShouldFail = config.batchShouldFail || false;
  }

  async write(level, message, metadata = {}) {
    if (this.writeDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.writeDelay));
    }

    if (this.shouldFail) {
      throw new Error('Write failed');
    }

    this.writes.push({ level, message, metadata });
  }

  async sendBatch(logs) {
    if (this.batchShouldFail) {
      throw new Error('Batch send failed');
    }

    this.batches.push(logs);
  }

  shouldLog(level) {
    // Filter out debug logs for testing
    return level !== 'debug';
  }
}

describe('BatchedDestination', () => {
  let mockDestination;
  let batchedDestination;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    if (batchedDestination) {
      await batchedDestination.close();
    }
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('requires a destination to wrap', () => {
      expect(() => {
        new BatchedDestination(null);
      }).toThrow('BatchedDestination requires a destination to wrap');
    });

    test('initializes with default config', () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      expect(batchedDestination.maxBatchSize).toBe(10);
      expect(batchedDestination.flushInterval).toBe(2000);
      expect(batchedDestination.useBatchSend).toBe(true);
    });

    test('accepts custom config', () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        maxBatchSize: 20,
        flushInterval: 5000,
        useBatchSend: false
      });

      expect(batchedDestination.maxBatchSize).toBe(20);
      expect(batchedDestination.flushInterval).toBe(5000);
      expect(batchedDestination.useBatchSend).toBe(false);
    });

    test('starts automatic flush timer', () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        flushInterval: 2000
      });

      expect(batchedDestination.flushTimer).toBeDefined();
      expect(batchedDestination.flushTimer).not.toBeNull();
    });
  });

  describe('write()', () => {
    test('buffers log entries', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'test message 1');
      await batchedDestination.write('warn', 'test message 2');

      expect(batchedDestination.getBufferSize()).toBe(2);
    });

    test('includes timestamp in buffered entries', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'test');

      expect(batchedDestination.buffer[0].timestamp).toBeDefined();
      expect(batchedDestination.buffer[0].level).toBe('info');
      expect(batchedDestination.buffer[0].message).toBe('test');
    });

    test('includes metadata in buffered entries', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'test', { key: 'value' });

      expect(batchedDestination.buffer[0].metadata).toEqual({ key: 'value' });
    });

    test('omits metadata when empty', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'test', {});

      expect(batchedDestination.buffer[0].metadata).toBeUndefined();
    });

    test('flushes automatically when buffer reaches maxBatchSize', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        maxBatchSize: 3
      });

      await batchedDestination.write('info', 'message 1');
      await batchedDestination.write('info', 'message 2');
      await batchedDestination.write('info', 'message 3'); // Should trigger flush

      expect(batchedDestination.getBufferSize()).toBe(0);
      expect(mockDestination.batches.length).toBe(1);
      expect(mockDestination.batches[0].length).toBe(3);
    });

    test('sends immediately when shutting down', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      batchedDestination.isShuttingDown = true;
      await batchedDestination.write('info', 'urgent message');

      // Should not buffer, should write directly
      expect(batchedDestination.getBufferSize()).toBe(0);
      expect(mockDestination.writes.length).toBe(1);
      expect(mockDestination.writes[0].message).toBe('urgent message');
    });

    test('handles write errors gracefully during shutdown', async () => {
      mockDestination = new MockDestination({ shouldFail: true });
      batchedDestination = new BatchedDestination(mockDestination);

      batchedDestination.isShuttingDown = true;

      // Should not throw
      await expect(
        batchedDestination.write('info', 'message')
      ).resolves.toBeUndefined();
    });
  });

  describe('flush()', () => {
    test('does nothing when buffer is empty', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.flush();

      expect(mockDestination.batches.length).toBe(0);
      expect(mockDestination.writes.length).toBe(0);
    });

    test('uses sendBatch when destination supports it', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        useBatchSend: true
      });

      await batchedDestination.write('info', 'message 1');
      await batchedDestination.write('info', 'message 2');
      await batchedDestination.flush();

      expect(mockDestination.batches.length).toBe(1);
      expect(mockDestination.batches[0].length).toBe(2);
      expect(mockDestination.writes.length).toBe(0); // No individual writes
    });

    test('falls back to individual sends when useBatchSend is false', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        useBatchSend: false
      });

      await batchedDestination.write('info', 'message 1');
      await batchedDestination.write('info', 'message 2');
      await batchedDestination.flush();

      expect(mockDestination.batches.length).toBe(0);
      expect(mockDestination.writes.length).toBe(2);
    });

    test('falls back to individual sends when sendBatch is not available', async () => {
      // Create a destination without sendBatch method
      const BaseDestination = require('../src/logging/destinations/base-destination');
      class NoBatchDestination extends BaseDestination {
        constructor() {
          super();
          this.writes = [];
        }
        async write(level, message, metadata = {}) {
          this.writes.push({ level, message, metadata });
        }
      }

      mockDestination = new NoBatchDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        useBatchSend: true
      });

      await batchedDestination.write('info', 'message 1', { data: 'test1' });
      await batchedDestination.write('info', 'message 2', { data: 'test2' });
      await batchedDestination.flush();

      expect(mockDestination.writes.length).toBe(2);
      expect(mockDestination.writes[0].message).toBe('message 1');
      expect(mockDestination.writes[1].message).toBe('message 2');
    });

    test('clears buffer after successful flush', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'message');
      expect(batchedDestination.getBufferSize()).toBe(1);

      await batchedDestination.flush();
      expect(batchedDestination.getBufferSize()).toBe(0);
    });

    test('falls back to individual sends when batch send fails', async () => {
      mockDestination = new MockDestination({ batchShouldFail: true });
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'message 1');
      await batchedDestination.write('info', 'message 2');
      await batchedDestination.flush();

      // Should fallback to individual writes
      expect(mockDestination.writes.length).toBe(2);
    });

    test('handles errors during individual send fallback', async () => {
      mockDestination = new MockDestination({
        batchShouldFail: true,
        shouldFail: true
      });
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'message');

      // Should not throw, errors are caught
      await expect(batchedDestination.flush()).resolves.toBeUndefined();
    });
  });

  describe('Automatic flush timer', () => {
    test('flushes automatically after flushInterval', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        flushInterval: 1000
      });

      await batchedDestination.write('info', 'message 1');
      expect(batchedDestination.getBufferSize()).toBe(1);

      // Advance timer
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Allow promises to resolve

      expect(batchedDestination.getBufferSize()).toBe(0);
      expect(mockDestination.batches.length).toBe(1);
    });

    test('flushes multiple times on schedule', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        flushInterval: 1000
      });

      // First batch
      await batchedDestination.write('info', 'batch 1');
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Second batch
      await batchedDestination.write('info', 'batch 2');
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockDestination.batches.length).toBe(2);
    });
  });

  describe('close()', () => {
    test('sets isShuttingDown flag', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.close();

      expect(batchedDestination.isShuttingDown).toBe(true);
    });

    test('stops automatic flush timer', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      expect(batchedDestination.flushTimer).not.toBeNull();

      await batchedDestination.close();

      expect(batchedDestination.flushTimer).toBeNull();
    });

    test('flushes remaining buffered logs', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'message 1');
      await batchedDestination.write('info', 'message 2');

      await batchedDestination.close();

      expect(batchedDestination.getBufferSize()).toBe(0);
      expect(mockDestination.batches.length).toBe(1);
      expect(mockDestination.batches[0].length).toBe(2);
    });

    test('closes wrapped destination', async () => {
      mockDestination = new MockDestination();
      const closeSpy = jest.spyOn(mockDestination, 'close');

      batchedDestination = new BatchedDestination(mockDestination);
      await batchedDestination.close();

      expect(closeSpy).toHaveBeenCalled();
    });

    test('handles destination without close method', async () => {
      mockDestination = new MockDestination();
      delete mockDestination.close;

      batchedDestination = new BatchedDestination(mockDestination);

      // Should not throw
      await expect(batchedDestination.close()).resolves.toBeUndefined();
    });
  });

  describe('shouldLog()', () => {
    test('delegates to wrapped destination', () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      expect(batchedDestination.shouldLog('info')).toBe(true);
      expect(batchedDestination.shouldLog('debug')).toBe(false); // Filtered by mock
    });
  });

  describe('handleError()', () => {
    test('delegates to wrapped destination', () => {
      mockDestination = new MockDestination();
      const handleErrorSpy = jest.spyOn(mockDestination, 'handleError');

      batchedDestination = new BatchedDestination(mockDestination);
      const error = new Error('test error');

      batchedDestination.handleError(error, 'info', 'test message');

      expect(handleErrorSpy).toHaveBeenCalledWith(error, 'info', 'test message');
    });

    test('handles destination without handleError gracefully', () => {
      mockDestination = new MockDestination();
      delete mockDestination.handleError;

      batchedDestination = new BatchedDestination(mockDestination);
      const error = new Error('test error');

      // Should not throw
      expect(() => {
        batchedDestination.handleError(error, 'info', 'test');
      }).not.toThrow();
    });
  });

  describe('getBufferSize()', () => {
    test('returns current buffer size', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      expect(batchedDestination.getBufferSize()).toBe(0);

      await batchedDestination.write('info', 'message 1');
      expect(batchedDestination.getBufferSize()).toBe(1);

      await batchedDestination.write('info', 'message 2');
      expect(batchedDestination.getBufferSize()).toBe(2);

      await batchedDestination.flush();
      expect(batchedDestination.getBufferSize()).toBe(0);
    });
  });

  describe('Integration scenarios', () => {
    test('handles rapid writes efficiently', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination, {
        maxBatchSize: 5
      });

      // Write 12 logs rapidly
      for (let i = 0; i < 12; i++) {
        await batchedDestination.write('info', `message ${i}`);
      }

      // Should have flushed twice (5 + 5) with 2 remaining
      expect(mockDestination.batches.length).toBe(2);
      expect(batchedDestination.getBufferSize()).toBe(2);
    });

    test('handles concurrent flush and write', async () => {
      mockDestination = new MockDestination({ writeDelay: 50 });
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'message 1');

      // Start flush (won't complete immediately due to writeDelay)
      const flushPromise = batchedDestination.flush();

      // Write more while flushing
      await batchedDestination.write('info', 'message 2');

      await flushPromise;

      // Second message should be in buffer
      expect(batchedDestination.getBufferSize()).toBe(1);
    });

    test('preserves log order in batches', async () => {
      mockDestination = new MockDestination();
      batchedDestination = new BatchedDestination(mockDestination);

      await batchedDestination.write('info', 'first');
      await batchedDestination.write('warn', 'second');
      await batchedDestination.write('error', 'third');
      await batchedDestination.flush();

      expect(mockDestination.batches[0][0].message).toBe('first');
      expect(mockDestination.batches[0][1].message).toBe('second');
      expect(mockDestination.batches[0][2].message).toBe('third');
    });
  });
});
