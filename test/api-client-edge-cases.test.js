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

describe('ApiClient Edge Cases', () => {
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

  describe('getNextJob() edge cases', () => {
    test('handles unexpected API response structure', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: {
          // Missing 'success' field, unexpected structure
          result: 'ok',
          job: { id: 123, task_title: 'Test' }
        }
      });

      const result = await apiClient.getNextJob();

      // Should return null for unexpected response
      expect(result).toBeNull();
    });

    test('handles API response with success=false', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: {
          success: false,
          error: 'Something went wrong'
        }
      });

      const result = await apiClient.getNextJob();

      expect(result).toBeNull();
    });

    test('handles API response with success=true but no job', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: {
          success: true
          // Missing job field
        }
      });

      const result = await apiClient.getNextJob();

      expect(result).toBeNull();
    });

    test('handles API response with invalid job data', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: {
          success: true,
          job: {
            // Missing required fields
            task_title: 'Test'
          }
        }
      });

      const result = await apiClient.getNextJob();

      // Should validate and return null
      expect(result).toBeNull();
    });
  });

  describe('validateJob() edge cases', () => {
    test('rejects job with non-string prompt', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test',
        prompt: 12345 // Should be string or null
      };

      const error = apiClient.validateJob(job);

      expect(error).toBe('Prompt must be a string or null');
    });

    test('accepts job with null prompt', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test',
        prompt: null
      };

      const error = apiClient.validateJob(job);

      expect(error).toBeNull();
    });

    test('accepts job with undefined prompt', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test'
        // prompt is undefined (not present)
      };

      const error = apiClient.validateJob(job);

      expect(error).toBeNull();
    });

    test('rejects prd_generation job with non-object project', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test',
        project: 'not-an-object' // Should be object or undefined
      };

      const error = apiClient.validateJob(job);

      expect(error).toBe('Project must be an object if provided');
    });

    test('accepts prd_generation job without project', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test'
        // project is undefined
      };

      const error = apiClient.validateJob(job);

      expect(error).toBeNull();
    });

    test('accepts prd_generation job with project but null system_path', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test',
        project: {
          name: 'Test Project',
          system_path: null
        }
      };

      const error = apiClient.validateJob(job);

      expect(error).toBeNull();
    });

    test('rejects prd_generation job with non-string system_path', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test',
        project: {
          system_path: 12345 // Should be string or null
        }
      };

      const error = apiClient.validateJob(job);

      expect(error).toBe('Project system_path must be a string if provided');
    });

    test('accepts prd_generation job with valid project and system_path', () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test',
        project: {
          name: 'My Project',
          system_path: '/path/to/project'
        }
      };

      const error = apiClient.validateJob(job);

      expect(error).toBeNull();
    });
  });

  describe('markJobCompleted() edge cases', () => {
    test('includes only prd_content for prd jobs', async () => {
      // Mock progress batch flush (called before marking complete)
      mockAxiosInstance.post.mockResolvedValue({});

      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const result = {
        output: 'PRD output',
        prdContent: 'The PRD content here',
        executionTimeMs: 5000
      };

      await apiClient.markJobCompleted(123, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/123',
        {
          status: 'completed',
          output: 'PRD output',
          execution_time_ms: 5000,
          prd_content: 'The PRD content here'
        }
      );
    });

    test('includes summary and branch for code jobs', async () => {
      // Mock progress batch flush (called before marking complete)
      mockAxiosInstance.post.mockResolvedValue({});

      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const result = {
        output: 'Code output',
        summary: 'Implemented feature X',
        branchName: 'feature/x',
        executionTimeMs: 10000
      };

      await apiClient.markJobCompleted(456, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/456',
        {
          status: 'completed',
          output: 'Code output',
          execution_time_ms: 10000,
          summary: 'Implemented feature X',
          branch_name: 'feature/x'
        }
      );
    });

    test('handles missing optional fields gracefully', async () => {
      // Mock progress batch flush (called before marking complete)
      mockAxiosInstance.post.mockResolvedValue({});

      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const result = {
        output: 'Output only',
        executionTimeMs: 1000
        // No prdContent, summary, or branchName
      };

      await apiClient.markJobCompleted(789, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/789',
        {
          status: 'completed',
          output: 'Output only',
          execution_time_ms: 1000
        }
      );
    });

    test('includes all fields when present', async () => {
      // Mock progress batch flush (called before marking complete)
      mockAxiosInstance.post.mockResolvedValue({});

      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const result = {
        output: 'Full output',
        prdContent: 'PRD',
        summary: 'Summary',
        branchName: 'branch',
        executionTimeMs: 2000
      };

      await apiClient.markJobCompleted(999, result);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/999',
        {
          status: 'completed',
          output: 'Full output',
          execution_time_ms: 2000,
          prd_content: 'PRD',
          summary: 'Summary',
          branch_name: 'branch'
        }
      );
    });
  });

  describe('markJobFailed() error handling', () => {
    test('does not throw when API call fails', async () => {
      // Mock progress batch flush (called before marking failed)
      mockAxiosInstance.post.mockResolvedValue({});

      mockAxiosInstance.patch.mockRejectedValue(
        new Error('Network error')
      );

      // Should not throw
      await expect(
        apiClient.markJobFailed(123, 'Job failed', null)
      ).resolves.toBeUndefined();
    }, 10000); // Increase timeout to handle retry delays

    test('handles null partial output', async () => {
      // Mock progress batch flush (called before marking failed)
      mockAxiosInstance.post.mockResolvedValue({});

      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.markJobFailed(123, 'Error occurred', null);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/123',
        {
          status: 'failed',
          error: 'Error occurred',
          output: null
        }
      );
    });

    test('includes partial output when provided', async () => {
      // Mock progress batch flush (called before marking failed)
      mockAxiosInstance.post.mockResolvedValue({});

      mockAxiosInstance.patch.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      await apiClient.markJobFailed(
        456,
        'Execution failed',
        'Partial output before failure'
      );

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v1/ralphblaster/jobs/456',
        {
          status: 'failed',
          error: 'Execution failed',
          output: 'Partial output before failure'
        }
      );
    });
  });
});
