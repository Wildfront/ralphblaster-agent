const axios = require('axios');
const ApiClient = require('../src/api-client');

jest.mock('axios');
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  logLevel: 'error'
}));
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('ApiClient Progress Updates', () => {
  let apiClient;
  let mockAxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      get: jest.fn(),
      patch: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };

    axios.create.mockReturnValue(mockAxiosInstance);

    apiClient = new ApiClient();
  });

  describe('sendProgress()', () => {
    test('sends progress update successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.sendProgress(123, 'Some output chunk');

      // Should be buffered, not sent yet
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();

      // Flush buffer to send batch
      await apiClient.flushProgressBuffer(123);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/123/progress_batch',
        { updates: [{ chunk: 'Some output chunk', timestamp: expect.any(Number) }] }
      );
    });

    test('sends multiple progress chunks for same job', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.sendProgress(456, 'Chunk 1\n');
      await apiClient.sendProgress(456, 'Chunk 2\n');
      await apiClient.sendProgress(456, 'Chunk 3\n');

      // Should be buffered, not sent yet
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();

      // Flush buffer to send all chunks in one batch
      await apiClient.flushProgressBuffer(456);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/456/progress_batch',
        {
          updates: [
            { chunk: 'Chunk 1\n', timestamp: expect.any(Number) },
            { chunk: 'Chunk 2\n', timestamp: expect.any(Number) },
            { chunk: 'Chunk 3\n', timestamp: expect.any(Number) }
          ]
        }
      );
    });

    test('handles empty chunk', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.sendProgress(789, '');

      // Flush buffer to send batch
      await apiClient.flushProgressBuffer(789);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/789/progress_batch',
        { updates: [{ chunk: '', timestamp: expect.any(Number) }] }
      );
    });

    test('handles large chunk', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const largeChunk = 'x'.repeat(10000);

      await apiClient.sendProgress(111, largeChunk);

      // Flush buffer to send batch
      await apiClient.flushProgressBuffer(111);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/111/progress_batch',
        { updates: [{ chunk: largeChunk, timestamp: expect.any(Number) }] }
      );
    });

    test('does not throw on network error', async () => {
      mockAxiosInstance.patch.mockRejectedValue(
        new Error('Network error')
      );

      // Should not throw
      await expect(
        apiClient.sendProgress(222, 'test chunk')
      ).resolves.toBeUndefined();
    });

    test('does not throw on API error', async () => {
      const error = new Error('API Error');
      error.response = {
        status: 500,
        data: { error: 'Internal server error' }
      };
      mockAxiosInstance.patch.mockRejectedValue(error);

      // Should not throw
      await expect(
        apiClient.sendProgress(333, 'test chunk')
      ).resolves.toBeUndefined();
    });

    test('does not throw on timeout', async () => {
      const error = new Error('Timeout');
      error.code = 'ECONNABORTED';
      mockAxiosInstance.patch.mockRejectedValue(error);

      // Should not throw
      await expect(
        apiClient.sendProgress(444, 'test chunk')
      ).resolves.toBeUndefined();
    });

    test('handles chunks with special characters', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const specialChunk = 'Output:\n\t- Item 1\n\t- Item 2\n"quoted"\n\'single\'';

      await apiClient.sendProgress(555, specialChunk);

      // Flush buffer to send batch
      await apiClient.flushProgressBuffer(555);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/555/progress_batch',
        { updates: [{ chunk: specialChunk, timestamp: expect.any(Number) }] }
      );
    });

    test('handles unicode characters in chunk', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const unicodeChunk = 'Processing: ✓ Success 🎉\nError: ❌ Failed';

      await apiClient.sendProgress(666, unicodeChunk);

      // Flush buffer to send batch
      await apiClient.flushProgressBuffer(666);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/666/progress_batch',
        { updates: [{ chunk: unicodeChunk, timestamp: expect.any(Number) }] }
      );
    });
  });
});
