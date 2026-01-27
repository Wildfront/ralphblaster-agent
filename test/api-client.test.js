const ApiClient = require('../src/api-client');
const axios = require('axios');

// Mock axios
jest.mock('axios');

// Mock config
jest.mock('../src/config', () => ({
  apiUrl: 'http://localhost:3000',
  apiToken: 'test-token'
}));

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('ApiClient', () => {
  let apiClient;
  let mockAxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock axios instance with interceptors
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      interceptors: {
        request: {
          use: jest.fn()
        },
        response: {
          use: jest.fn()
        }
      }
    };

    axios.create.mockReturnValue(mockAxiosInstance);
    apiClient = new ApiClient();
  });

  describe('getNextJob()', () => {
    test('returns null on 204 status', async () => {
      mockAxiosInstance.get.mockResolvedValue({ status: 204 });

      const result = await apiClient.getNextJob();

      expect(result).toBeNull();
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/ralphblaster/jobs/next', {
        params: { timeout: 30 },
        timeout: 35000  // Updated to 30s + 5s buffer = 35s
      });
    });

    test('uses proper timeout values - server timeout plus buffer', async () => {
      mockAxiosInstance.get.mockResolvedValue({ status: 204 });

      await apiClient.getNextJob();

      const getNextJobCall = mockAxiosInstance.get.mock.calls[0];
      const serverTimeout = getNextJobCall[1].params.timeout;
      const clientTimeout = getNextJobCall[1].timeout;

      // Verify client timeout is server timeout + reasonable buffer
      expect(clientTimeout).toBe(serverTimeout * 1000 + 5000);

      // Verify buffer is reasonable (should be 5 seconds)
      const bufferMs = clientTimeout - (serverTimeout * 1000);
      expect(bufferMs).toBe(5000);

      // Verify client timeout doesn't waste too much time
      expect(clientTimeout).toBeLessThan(40000); // Should be well under 40s
    });

    test('returns job on success', async () => {
      const mockJob = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test task'
      };

      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: { success: true, job: mockJob }
      });

      const result = await apiClient.getNextJob();

      expect(result).toEqual(mockJob);
    });

    test('rejects invalid job from API', async () => {
      const invalidJob = {
        id: -1, // Invalid ID
        job_type: 'prd_generation',
        task_title: 'Test task'
      };

      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: { success: true, job: invalidJob }
      });

      const result = await apiClient.getNextJob();

      expect(result).toBeNull();
    });

    test('handles 403 permission error', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 403 }
      });

      await expect(apiClient.getNextJob()).rejects.toThrow('Invalid API token permissions');
    });

    test('handles ECONNREFUSED', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        code: 'ECONNREFUSED'
      });

      const result = await apiClient.getNextJob();

      expect(result).toBeNull();
    });

    test('handles 204 in error response', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 204 }
      });

      const result = await apiClient.getNextJob();

      expect(result).toBeNull();
    });

    test('handles generic errors gracefully', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      const result = await apiClient.getNextJob();

      expect(result).toBeNull();
    });
  });

  describe('markJobRunning()', () => {
    test('sends correct status', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.markJobRunning(1);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/api/v1/ralphblaster/jobs/1', {
        status: 'running'
      });
    });

    test('throws error on API failure', async () => {
      mockAxiosInstance.patch.mockRejectedValue(new Error('API error'));

      await expect(apiClient.markJobRunning(1)).rejects.toThrow('API error');
    });
  });

  describe('markJobCompleted()', () => {
    test('includes prd_content for prd jobs', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      const result = {
        output: 'Output text',
        prdContent: 'PRD content here',
        executionTimeMs: 1000
      };

      await apiClient.markJobCompleted(1, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/api/v1/ralphblaster/jobs/1', {
        status: 'completed',
        output: 'Output text',
        execution_time_ms: 1000,
        prd_content: 'PRD content here'
      });
    });

    test('includes summary/branch for code jobs', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      const result = {
        output: 'Output text',
        summary: 'Implemented feature X',
        branchName: 'feature/test',
        executionTimeMs: 2000
      };

      await apiClient.markJobCompleted(1, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/api/v1/ralphblaster/jobs/1', {
        status: 'completed',
        output: 'Output text',
        execution_time_ms: 2000,
        summary: 'Implemented feature X',
        branch_name: 'feature/test'
      });
    });

    test('throws error on API failure', async () => {
      mockAxiosInstance.patch.mockRejectedValue(new Error('API error'));

      await expect(apiClient.markJobCompleted(1, { output: '', executionTimeMs: 0 }))
        .rejects.toThrow('API error');
    });
  });

  describe('markJobFailed()', () => {
    test('sends error and partial output', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.markJobFailed(1, 'Error message', 'Partial output');

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/api/v1/ralphblaster/jobs/1', {
        status: 'failed',
        error: 'Error message',
        output: 'Partial output'
      });
    });

    test('does not throw on API error', async () => {
      mockAxiosInstance.patch.mockRejectedValue(new Error('API error'));

      // Should not throw
      await expect(apiClient.markJobFailed(1, 'Error')).resolves.toBeUndefined();
    });
  });

  describe('sendHeartbeat()', () => {
    test('sends heartbeat with running status', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.sendHeartbeat(1);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/api/v1/ralphblaster/jobs/1', {
        status: 'running',
        heartbeat: true
      });
    });

    test('continues on API failure (logs warning)', async () => {
      mockAxiosInstance.patch.mockRejectedValue(new Error('API error'));

      await expect(apiClient.sendHeartbeat(1)).resolves.toBeUndefined();
    });
  });

  describe('API endpoint fallback', () => {
    test('uses new endpoints by default', async () => {
      mockAxiosInstance.get.mockResolvedValue({ status: 204 });

      await apiClient.getNextJob();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/ralphblaster/jobs/next', expect.any(Object));
    });

    test('falls back to old endpoints on 404', async () => {
      // First call fails with 404 (new endpoint not found)
      mockAxiosInstance.get
        .mockRejectedValueOnce({
          response: { status: 404 }
        })
        // Second call succeeds (old endpoint works)
        .mockResolvedValueOnce({ status: 204 });

      await apiClient.getNextJob();

      // Should have tried both endpoints
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(1, '/api/v1/ralphblaster/jobs/next', expect.any(Object));
      expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(2, '/api/v1/ralph/jobs/next', expect.any(Object));
    });

    test('continues using old endpoints after fallback', async () => {
      // First call triggers fallback
      mockAxiosInstance.get
        .mockRejectedValueOnce({ response: { status: 404 } })
        .mockResolvedValueOnce({ status: 204 })
        // Subsequent calls should use old endpoint
        .mockResolvedValueOnce({ status: 204 });

      await apiClient.getNextJob(); // Triggers fallback
      await apiClient.getNextJob(); // Should use old endpoint

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(3, '/api/v1/ralph/jobs/next', expect.any(Object));
    });

    test('does not fall back on non-404 errors', async () => {
      mockAxiosInstance.patch.mockRejectedValue({
        response: { status: 500 }
      });

      await expect(apiClient.markJobRunning(1)).rejects.toMatchObject({
        response: { status: 500 }
      });

      // Should only try once (no fallback)
      expect(mockAxiosInstance.patch).toHaveBeenCalledTimes(1);
    });

    test('fallback works for POST requests', async () => {
      mockAxiosInstance.post
        .mockRejectedValueOnce({ response: { status: 404 } })
        .mockResolvedValueOnce({ data: { success: true } });

      await apiClient.sendStatusEvent(1, 'test_event', 'Test message');

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        1,
        '/api/v1/ralphblaster/jobs/1/events',
        expect.any(Object)
      );
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        2,
        '/api/v1/ralph/jobs/1/events',
        expect.any(Object)
      );
    });

    test('fallback works for PATCH requests', async () => {
      mockAxiosInstance.patch
        .mockRejectedValueOnce({ response: { status: 404 } })
        .mockResolvedValueOnce({});

      await apiClient.markJobRunning(1);

      expect(mockAxiosInstance.patch).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.patch).toHaveBeenNthCalledWith(
        1,
        '/api/v1/ralphblaster/jobs/1',
        expect.any(Object)
      );
      expect(mockAxiosInstance.patch).toHaveBeenNthCalledWith(
        2,
        '/api/v1/ralph/jobs/1',
        expect.any(Object)
      );
    });
  });
});
