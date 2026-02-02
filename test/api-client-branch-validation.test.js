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

describe('ApiClient - Branch Name Validation', () => {
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

  describe('markJobCompleted - Branch Name Validation', () => {
    test('accepts valid simple branch name', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature-123'
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/123',
        expect.objectContaining({
          branch_name: 'feature-123'
        })
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Invalid branch name')
      );
    });

    test('accepts valid hierarchical branch name', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature/user-auth'
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/123',
        expect.objectContaining({
          branch_name: 'feature/user-auth'
        })
      );
    });

    test('accepts valid multi-level hierarchical branch name', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature/v2/user-auth'
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/123',
        expect.objectContaining({
          branch_name: 'feature/v2/user-auth'
        })
      );
    });

    test('rejects branch name starting with dash', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: '-invalid'
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid branch name format, omitting from payload',
        { branchName: '-invalid' }
      );
    });

    test('rejects branch name starting with slash', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: '/invalid'
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid branch name format, omitting from payload',
        { branchName: '/invalid' }
      );
    });

    test('rejects branch name ending with slash', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature/'
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid branch name format, omitting from payload',
        { branchName: 'feature/' }
      );
    });

    test('rejects branch name with segment starting with dash after slash', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature/-invalid'
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid branch name format, omitting from payload',
        { branchName: 'feature/-invalid' }
      );
    });

    test('rejects branch name exceeding 200 characters', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'a'.repeat(201)
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid branch name format, omitting from payload',
        expect.objectContaining({ branchName: expect.any(String) })
      );
    });

    test('accepts branch name with exactly 200 characters', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const validName = 'a'.repeat(200);
      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: validName
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/123',
        expect.objectContaining({
          branch_name: validName
        })
      );
    });

    test('rejects branch name with double slashes', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature//bug'
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
    });

    test('accepts branch name with underscores', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature_user_auth'
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/123',
        expect.objectContaining({
          branch_name: 'feature_user_auth'
        })
      );
    });

    test('accepts branch name starting with number', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: '123-feature'
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/123',
        expect.objectContaining({
          branch_name: '123-feature'
        })
      );
    });

    test('rejects branch name with special characters', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature@bug'
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
    });

    test('rejects branch name with spaces', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature bug'
      };

      await apiClient.markJobCompleted(123, result);

      const call = mockAxiosInstance.patch.mock.calls[0][1];
      expect(call.branch_name).toBeUndefined();
    });

    test('accepts complex valid branch name', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      const result = {
        output: 'test output',
        executionTimeMs: 1000,
        branchName: 'feature/JIRA-123_user-auth-v2'
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/rb/jobs/123',
        expect.objectContaining({
          branch_name: 'feature/JIRA-123_user-auth-v2'
        })
      );
    });
  });
});
