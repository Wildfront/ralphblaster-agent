/**
 * Progress Batching Tests
 * Tests for batched progress update functionality in api-client
 */

const ApiClient = require('../src/api-client');

describe('Progress Batching', () => {
  let apiClient;
  let mockAxiosInstance;

  beforeEach(() => {
    // Mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn()
    };

    // Set required environment variable
    process.env.RALPHBLASTER_API_TOKEN = 'test-token';

    apiClient = new ApiClient('test-agent');
    apiClient.client = mockAxiosInstance;

    // Mock successful responses
    mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.RALPHBLASTER_API_TOKEN;

    // Clear all timers
    jest.clearAllTimers();
  });

  describe('Batching Behavior', () => {
    test('batches multiple chunks into single request', async () => {
      jest.useFakeTimers();

      // Send 10 chunks
      for (let i = 0; i < 10; i++) {
        await apiClient.sendProgress(1, `chunk ${i}`);
      }

      // No requests yet (buffered)
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();

      // Advance time to trigger batch send
      jest.advanceTimersByTime(200);
      await Promise.resolve(); // Let promises resolve

      // Should have sent 1 batched request with 10 chunks
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/1/progress_batch',
        {
          updates: expect.arrayContaining([
            { chunk: 'chunk 0', timestamp: expect.any(Number) },
            { chunk: 'chunk 9', timestamp: expect.any(Number) }
          ])
        }
      );

      jest.useRealTimers();
    });

    test('flushes immediately when buffer reaches max size (50)', async () => {
      // Send 50 chunks (max batch size)
      for (let i = 0; i < 50; i++) {
        await apiClient.sendProgress(1, `chunk ${i}`);
      }

      // Should have flushed immediately without waiting for timer
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post.mock.calls[0][1].updates).toHaveLength(50);
    });

    test('sends multiple batches when exceeding max size', async () => {
      // Send 75 chunks
      for (let i = 0; i < 75; i++) {
        await apiClient.sendProgress(1, `chunk ${i}`);
      }

      // First batch of 50 should have been sent immediately
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post.mock.calls[0][1].updates).toHaveLength(50);

      // Remaining 25 should be buffered
      expect(apiClient.progressBuffer.get(1)).toHaveLength(25);
    });

    test('batches chunks per job ID separately', async () => {
      jest.useFakeTimers();

      // Send chunks for two different jobs
      await apiClient.sendProgress(1, 'job1-chunk1');
      await apiClient.sendProgress(2, 'job2-chunk1');
      await apiClient.sendProgress(1, 'job1-chunk2');
      await apiClient.sendProgress(2, 'job2-chunk2');

      // Advance timer
      jest.advanceTimersByTime(200);
      await Promise.resolve();

      // Should have sent 2 batched requests (one per job)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('Timer Management', () => {
    test('schedules flush timer on first chunk', async () => {
      jest.useFakeTimers();

      await apiClient.sendProgress(1, 'chunk1');

      // Timer should be set
      expect(apiClient.progressTimers.has(1)).toBe(true);

      jest.useRealTimers();
    });

    test('does not create multiple timers for same job', async () => {
      jest.useFakeTimers();

      await apiClient.sendProgress(1, 'chunk1');
      const firstTimer = apiClient.progressTimers.get(1);

      await apiClient.sendProgress(1, 'chunk2');
      const secondTimer = apiClient.progressTimers.get(1);

      // Should be the same timer
      expect(firstTimer).toBe(secondTimer);

      jest.useRealTimers();
    });

    test('clears timer after flush', async () => {
      jest.useFakeTimers();

      await apiClient.sendProgress(1, 'chunk1');

      expect(apiClient.progressTimers.has(1)).toBe(true);

      // Trigger flush
      jest.advanceTimersByTime(200);
      await Promise.resolve();

      // Timer should be cleared
      expect(apiClient.progressTimers.has(1)).toBe(false);

      jest.useRealTimers();
    });
  });

  describe('Manual Flush', () => {
    test('flushProgressBuffer sends pending chunks', async () => {
      await apiClient.sendProgress(1, 'chunk1');
      await apiClient.sendProgress(1, 'chunk2');

      // Manually flush
      await apiClient.flushProgressBuffer(1);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post.mock.calls[0][1].updates).toHaveLength(2);
    });

    test('flushProgressBuffer handles empty buffer gracefully', async () => {
      // Flush empty buffer
      await apiClient.flushProgressBuffer(999);

      // Should not make any requests
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    test('flushProgressBuffer clears buffer after sending', async () => {
      await apiClient.sendProgress(1, 'chunk1');
      await apiClient.sendProgress(1, 'chunk2');

      await apiClient.flushProgressBuffer(1);

      // Buffer should be empty
      expect(apiClient.progressBuffer.get(1)).toHaveLength(0);
    });
  });

  describe('Integration with Job Completion', () => {
    test('markJobCompleted flushes pending progress', async () => {
      // Send some progress
      await apiClient.sendProgress(1, 'chunk1');
      await apiClient.sendProgress(1, 'chunk2');

      // Mark job as completed
      await apiClient.markJobCompleted(1, { output: 'result', executionTimeMs: 1000 });

      // Progress should have been flushed
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/1/progress_batch',
        expect.any(Object)
      );

      // Completion request should have been sent
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/1',
        expect.objectContaining({
          status: 'completed'
        })
      );
    });

    test('markJobFailed flushes pending progress', async () => {
      // Send some progress
      await apiClient.sendProgress(1, 'chunk1');

      // Mark job as failed
      await apiClient.markJobFailed(1, 'Test error');

      // Progress should have been flushed
      expect(mockAxiosInstance.post).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('continues on batch send error after retries', async () => {
      const error = new Error('API error');
      error.response = { status: 503 }; // Retryable error
      mockAxiosInstance.post.mockRejectedValue(error);

      // Send chunks (will auto-flush at 50)
      for (let i = 0; i < 50; i++) {
        await apiClient.sendProgress(1, `chunk ${i}`);
      }

      // Should have tried initial + 2 retries = 3 total
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    }, 10000); // Increase timeout for retries

    test('clears buffer even on flush error', async () => {
      const error = new Error('API error');
      error.response = { status: 503 };
      mockAxiosInstance.post.mockRejectedValue(error);

      await apiClient.sendProgress(1, 'chunk1');
      await apiClient.flushProgressBuffer(1);

      // Buffer should still be cleared to prevent retry loops
      expect(apiClient.progressBuffer.get(1)).toHaveLength(0);
    }, 10000);
  });

  describe('Performance', () => {
    test('reduces API calls by 90% for heavy output', async () => {
      jest.useFakeTimers();

      // Simulate 100 chunks (would be 100 API calls without batching)
      for (let i = 0; i < 100; i++) {
        await apiClient.sendProgress(1, `chunk ${i}`);
      }

      // First 50 sent immediately, then advance timer for remaining 50
      jest.advanceTimersByTime(200);
      await Promise.resolve();

      // Should have sent only 2 batched requests (90% reduction)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});
