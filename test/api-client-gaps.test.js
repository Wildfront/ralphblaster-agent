const ApiClient = require('../src/api-client');
const axios = require('axios');

jest.mock('axios');
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token'
}));

describe('ApiClient - Coverage Gaps', () => {
  let apiClient;
  let mockAxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      defaults: {
        baseURL: 'https://test-api.com'
      },
      interceptors: {
        request: {
          use: jest.fn((fn) => fn)
        },
        response: {
          use: jest.fn((success, error) => ({ success, error }))
        }
      }
    };

    axios.create.mockReturnValue(mockAxiosInstance);
    apiClient = new ApiClient();
  });

  describe('Constructor & Interceptors', () => {
    test('request interceptor adds auth header', () => {
      const config = require('../src/config');
      const requestInterceptor = mockAxiosInstance.interceptors.request.use.mock.calls[0][0];
      const requestConfig = { headers: {} };

      const result = requestInterceptor(requestConfig);

      expect(result.headers.Authorization).toBe(`Bearer ${config.apiToken}`);
    });

    test('request interceptor adds agent version', () => {
      const packageJson = require('../package.json');
      const requestInterceptor = mockAxiosInstance.interceptors.request.use.mock.calls[0][0];
      const requestConfig = { headers: {} };

      const result = requestInterceptor(requestConfig);

      expect(result.headers['X-Agent-Version']).toBe(packageJson.version);
    });

    test('response interceptor redacts auth in errors', () => {
      const responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const error = {
        config: {
          headers: {
            Authorization: 'Bearer secret-token'
          }
        }
      };

      expect(() => responseInterceptor(error)).rejects.toMatchObject({
        config: {
          headers: {
            Authorization: 'Bearer [REDACTED]'
          }
        }
      });
    });

    test('response interceptor redacts auth in error.response.config', () => {
      const responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const error = {
        config: { headers: { Authorization: 'Bearer token1' } },
        response: {
          config: {
            headers: {
              Authorization: 'Bearer token2'
            }
          }
        }
      };

      expect(() => responseInterceptor(error)).rejects.toMatchObject({
        config: { headers: { Authorization: 'Bearer [REDACTED]' } },
        response: {
          config: { headers: { Authorization: 'Bearer [REDACTED]' } }
        }
      });
    });
  });

  describe('validateOutput()', () => {
    test('returns empty string for non-string input', () => {
      expect(apiClient.validateOutput(null)).toBe('');
      expect(apiClient.validateOutput(undefined)).toBe('');
      expect(apiClient.validateOutput(123)).toBe('');
      expect(apiClient.validateOutput({})).toBe('');
      expect(apiClient.validateOutput([])).toBe('');
    });

    test('truncates output exceeding max size', () => {
      const logger = require('../src/logger');
      const largeOutput = 'a'.repeat(15 * 1024 * 1024); // 15MB

      const result = apiClient.validateOutput(largeOutput, 10 * 1024 * 1024);

      expect(result.length).toBe(10 * 1024 * 1024 + '\n\n[OUTPUT TRUNCATED - EXCEEDED MAX SIZE]'.length);
      expect(result).toContain('[OUTPUT TRUNCATED - EXCEEDED MAX SIZE]');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Output truncated')
      );
    });

    test('includes truncation message at end', () => {
      const largeOutput = 'x'.repeat(200);

      const result = apiClient.validateOutput(largeOutput, 100);

      expect(result.endsWith('[OUTPUT TRUNCATED - EXCEEDED MAX SIZE]')).toBe(true);
    });

    test('passes through output within size limit', () => {
      const output = 'Normal output';

      const result = apiClient.validateOutput(output);

      expect(result).toBe('Normal output');
    });
  });

  describe('markJobCompleted - Gaps', () => {
    test('validates and rejects invalid branch names', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.markJobCompleted(1, {
        output: 'done',
        executionTimeMs: 1000,
        branchName: 'invalid branch name with spaces!'
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid branch name format')
      );

      const payload = mockAxiosInstance.patch.mock.calls[0][1];
      expect(payload.branch_name).toBeUndefined();
    });

    test('omits invalid branch name from payload', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.markJobCompleted(1, {
        output: 'done',
        executionTimeMs: 1000,
        branchName: '../../../etc/passwd'
      });

      const payload = mockAxiosInstance.patch.mock.calls[0][1];
      expect(payload.branch_name).toBeUndefined();
    });

    test('includes git activity metadata structure', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.markJobCompleted(1, {
        output: 'done',
        executionTimeMs: 1000,
        gitActivity: {
          commitCount: 3,
          lastCommit: 'abc123 - Fix bug',
          changes: '5 files changed',
          pushedToRemote: true,
          hasUncommittedChanges: false
        }
      });

      const payload = mockAxiosInstance.patch.mock.calls[0][1];
      expect(payload.git_activity).toEqual({
        commit_count: 3,
        last_commit: 'abc123 - Fix bug',
        changes: '5 files changed',
        pushed_to_remote: true,
        has_uncommitted_changes: false
      });
    });

    test('handles missing git activity fields gracefully', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.markJobCompleted(1, {
        output: 'done',
        executionTimeMs: 1000,
        gitActivity: {}
      });

      const payload = mockAxiosInstance.patch.mock.calls[0][1];
      expect(payload.git_activity).toEqual({
        commit_count: 0,
        last_commit: null,
        changes: null,
        pushed_to_remote: false,
        has_uncommitted_changes: false
      });
    });
  });

  describe('sendProgress()', () => {
    test('sends progress endpoint call', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.sendProgress(123, 'Progress chunk');

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralph/jobs/123/progress',
        { chunk: 'Progress chunk' }
      );
    });

    test('handles errors with warning, does not throw', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.patch.mockRejectedValue(new Error('Network error'));

      await apiClient.sendProgress(123, 'chunk');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error sending progress'),
        'Network error'
      );
    });

    test('logs debug message on success', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.sendProgress(456, 'chunk');

      expect(logger.debug).toHaveBeenCalledWith(
        'Progress sent for job #456'
      );
    });
  });

  describe('sendStatusEvent()', () => {
    test('sends status event API call', async () => {
      mockAxiosInstance.post.mockResolvedValue({});

      await apiClient.sendStatusEvent(123, 'setup_started', 'Setting up...');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/ralph/jobs/123/events',
        {
          event_type: 'setup_started',
          message: 'Setting up...',
          metadata: {}
        }
      );
    });

    test('includes metadata in event', async () => {
      mockAxiosInstance.post.mockResolvedValue({});

      await apiClient.sendStatusEvent(
        123,
        'file_modified',
        'Modified app.js',
        { filename: 'app.js', line_count: 100 }
      );

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: { filename: 'app.js', line_count: 100 }
        })
      );
    });

    test('handles errors gracefully without throwing', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.post.mockRejectedValue(new Error('API error'));

      await apiClient.sendStatusEvent(123, 'test', 'message');

      expect(logger.warn).toHaveBeenCalled();
      // Should not throw
    });

    test('logs debug message on success', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.post.mockResolvedValue({});

      await apiClient.sendStatusEvent(789, 'progress_update', 'Working...', { percentage: 50 });

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Status event sent for job #789')
      );
    });

    test('does not throw on error (best-effort)', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network down'));

      await expect(
        apiClient.sendStatusEvent(1, 'test', 'msg')
      ).resolves.toBeUndefined();
    });
  });

  describe('updateJobMetadata()', () => {
    test('sends metadata update API call', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.updateJobMetadata(123, { worktree_path: '/path/to/worktree' });

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralph/jobs/123/metadata',
        {
          metadata: { worktree_path: '/path/to/worktree' }
        }
      );
    });

    test('handles errors gracefully without throwing', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.patch.mockRejectedValue(new Error('API error'));

      await apiClient.updateJobMetadata(123, { key: 'value' });

      expect(logger.warn).toHaveBeenCalled();
      // Should not throw
    });

    test('logs debug message on success', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.patch.mockResolvedValue({});

      await apiClient.updateJobMetadata(456, { test_key: 'test_value' });

      expect(logger.debug).toHaveBeenCalledWith(
        'Metadata updated for job #456',
        { test_key: 'test_value' }
      );
    });

    test('does not throw on error (best-effort)', async () => {
      mockAxiosInstance.patch.mockRejectedValue(new Error('Connection lost'));

      await expect(
        apiClient.updateJobMetadata(1, { data: 'test' })
      ).resolves.toBeUndefined();
    });
  });

  describe('Branch name validation regex', () => {
    test('accepts valid branch names', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});

      const validBranches = [
        'feature/test',
        'ralph/ticket-1/job-2',
        'main',
        'develop',
        'feature-123',
        'bugfix_456'
      ];

      for (const branch of validBranches) {
        await apiClient.markJobCompleted(1, {
          output: 'done',
          executionTimeMs: 1000,
          branchName: branch
        });

        const payload = mockAxiosInstance.patch.mock.calls[mockAxiosInstance.patch.mock.calls.length - 1][1];
        expect(payload.branch_name).toBe(branch);
      }
    });

    test('rejects invalid branch names', async () => {
      const logger = require('../src/logger');
      mockAxiosInstance.patch.mockResolvedValue({});

      const invalidBranches = [
        'has spaces',
        'has@special#chars',
        'too' + 'o'.repeat(200) + 'long', // > 200 chars
        'has\nnewline',
        'has\ttab'
      ];

      for (const branch of invalidBranches) {
        await apiClient.markJobCompleted(1, {
          output: 'done',
          executionTimeMs: 1000,
          branchName: branch
        });

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid branch name format')
        );
      }
    });
  });
});
