// Mock config before requiring ApiClient
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

const ApiClient = require('../src/api-client');
const axios = require('axios');

jest.mock('axios');

describe('ApiClient - Batch Operations and Metadata Validation', () => {
  let apiClient;
  let mockAxiosInstance;
  const logger = require('../src/logger');

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };

    axios.create.mockReturnValue(mockAxiosInstance);
    apiClient = new ApiClient();
  });

  describe('addSetupLogBatch - Timeout Configuration', () => {
    test('uses 30s timeout for batch operations', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      const logs = [
        { timestamp: '2024-01-01T00:00:00Z', level: 'info', message: 'Log 1' },
        { timestamp: '2024-01-01T00:00:01Z', level: 'info', message: 'Log 2' }
      ];

      await apiClient.addSetupLogBatch(123, logs);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/123/setup_logs',
        { logs: logs },
        { timeout: 30000 } // 30s timeout for batch operations
      );
    });

    test('handles timeout errors gracefully', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      timeoutError.code = 'ECONNABORTED';
      mockAxiosInstance.post.mockRejectedValue(timeoutError);

      const logs = [
        { timestamp: '2024-01-01T00:00:00Z', level: 'info', message: 'Log 1' }
      ];

      await expect(apiClient.addSetupLogBatch(123, logs)).rejects.toThrow();
      expect(logger.debug).toHaveBeenCalledWith(
        'Error sending batch setup logs for job #123: timeout of 30000ms exceeded'
      );
    });

    test('does nothing when logs array is empty', async () => {
      await apiClient.addSetupLogBatch(123, []);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    test('does nothing when logs is null', async () => {
      await apiClient.addSetupLogBatch(123, null);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('updateJobMetadata - Validation', () => {
    test('rejects null metadata', async () => {
      await apiClient.updateJobMetadata(123, null);

      expect(mockAxiosInstance.patch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('Invalid metadata: must be an object');
    });

    test('rejects undefined metadata', async () => {
      await apiClient.updateJobMetadata(123, undefined);

      expect(mockAxiosInstance.patch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('Invalid metadata: must be an object');
    });

    test('rejects non-object metadata', async () => {
      await apiClient.updateJobMetadata(123, 'not an object');

      expect(mockAxiosInstance.patch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('Invalid metadata: must be an object');
    });

    test('rejects metadata that is too large (>10KB)', async () => {
      const largeMetadata = {
        data: 'x'.repeat(15000) // 15KB of data
      };

      await apiClient.updateJobMetadata(123, largeMetadata);

      expect(mockAxiosInstance.patch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Metadata too large')
      );
    });

    test('accepts valid metadata within size limits', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const validMetadata = {
        branch: 'feature-123',
        commits: 3,
        files_changed: 5
      };

      await apiClient.updateJobMetadata(123, validMetadata);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/123/metadata',
        { metadata: validMetadata }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Metadata updated for job #123',
        validMetadata
      );
    });

    test('handles metadata with exactly 10KB of data', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      // Create metadata that's close to but under 10KB
      const metadata = {
        data: 'x'.repeat(9500)
      };

      await apiClient.updateJobMetadata(123, metadata);

      // Should succeed since it's under 10KB
      expect(mockAxiosInstance.patch).toHaveBeenCalled();
    });

    test('handles metadata serialization errors', async () => {
      const circularMetadata = {};
      circularMetadata.self = circularMetadata; // Create circular reference

      await apiClient.updateJobMetadata(123, circularMetadata);

      expect(mockAxiosInstance.patch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error serializing metadata')
      );
    });

    test('handles API errors gracefully', async () => {
      mockAxiosInstance.patch.mockRejectedValue(new Error('Network error'));

      const validMetadata = { branch: 'feature-123' };

      await apiClient.updateJobMetadata(123, validMetadata);

      expect(logger.warn).toHaveBeenCalledWith(
        'Error updating metadata for job #123: Network error'
      );
    });

    test('accepts empty object as valid metadata', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      await apiClient.updateJobMetadata(123, {});

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/123/metadata',
        { metadata: {} }
      );
    });
  });
});
