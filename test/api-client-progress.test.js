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
      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.sendProgress(123, 'Some output chunk');

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/123/progress',
        { chunk: 'Some output chunk' }
      );
    });

    test('sends multiple progress chunks for same job', async () => {
      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.sendProgress(456, 'Chunk 1\n');
      await apiClient.sendProgress(456, 'Chunk 2\n');
      await apiClient.sendProgress(456, 'Chunk 3\n');

      expect(mockAxiosInstance.patch).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.patch).toHaveBeenNthCalledWith(
        1,
        '/api/v1/ralphblaster/jobs/456/progress',
        { chunk: 'Chunk 1\n' }
      );
      expect(mockAxiosInstance.patch).toHaveBeenNthCalledWith(
        2,
        '/api/v1/ralphblaster/jobs/456/progress',
        { chunk: 'Chunk 2\n' }
      );
      expect(mockAxiosInstance.patch).toHaveBeenNthCalledWith(
        3,
        '/api/v1/ralphblaster/jobs/456/progress',
        { chunk: 'Chunk 3\n' }
      );
    });

    test('handles empty chunk', async () => {
      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.sendProgress(789, '');

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/789/progress',
        { chunk: '' }
      );
    });

    test('handles large chunk', async () => {
      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const largeChunk = 'x'.repeat(10000);

      await apiClient.sendProgress(111, largeChunk);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/111/progress',
        { chunk: largeChunk }
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
      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const specialChunk = 'Output:\n\t- Item 1\n\t- Item 2\n"quoted"\n\'single\'';

      await apiClient.sendProgress(555, specialChunk);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/555/progress',
        { chunk: specialChunk }
      );
    });

    test('handles unicode characters in chunk', async () => {
      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const unicodeChunk = 'Processing: ✓ Success 🎉\nError: ❌ Failed';

      await apiClient.sendProgress(666, unicodeChunk);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/666/progress',
        { chunk: unicodeChunk }
      );
    });
  });
});
