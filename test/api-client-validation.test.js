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

describe('ApiClient - validateJob()', () => {
  let apiClient;

  beforeEach(() => {
    apiClient = new ApiClient();
  });

  describe('Basic validation', () => {
    test('rejects null job', () => {
      const error = apiClient.validateJob(null);
      expect(error).toBe('Job is null or not an object');
    });

    test('rejects undefined job', () => {
      const error = apiClient.validateJob(undefined);
      expect(error).toBe('Job is null or not an object');
    });

    test('rejects non-object job', () => {
      const error = apiClient.validateJob('not an object');
      expect(error).toBe('Job is null or not an object');
    });
  });

  describe('Job ID validation', () => {
    test('rejects job with missing id', () => {
      const job = {
        job_type: 'prd_generation',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Job ID is missing or invalid');
    });

    test('rejects job with invalid id (0)', () => {
      const job = {
        id: 0,
        job_type: 'prd_generation',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Job ID is missing or invalid');
    });

    test('rejects job with invalid id (negative)', () => {
      const job = {
        id: -1,
        job_type: 'prd_generation',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Job ID is missing or invalid');
    });

    test('rejects job with invalid id (non-number)', () => {
      const job = {
        id: 'not-a-number',
        job_type: 'prd_generation',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Job ID is missing or invalid');
    });
  });

  describe('Job type validation', () => {
    test('rejects job with missing job_type', () => {
      const job = {
        id: 1,
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Job type is missing or invalid');
    });

    test('rejects job with empty job_type', () => {
      const job = {
        id: 1,
        job_type: '',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Job type is missing or invalid');
    });

    test('rejects job with whitespace-only job_type', () => {
      const job = {
        id: 1,
        job_type: '   ',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Job type is missing or invalid');
    });

    test('rejects unknown job_type', () => {
      const job = {
        id: 1,
        job_type: 'unknown_type',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Unknown job type: unknown_type');
    });
  });

  describe('Task title validation', () => {
    test('rejects job with missing task_title', () => {
      const job = {
        id: 1,
        job_type: 'prd_generation'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Task title is missing or invalid');
    });

    test('rejects job with empty task_title', () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: ''
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Task title is missing or invalid');
    });

    test('rejects job with whitespace-only task_title', () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: '   '
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Task title is missing or invalid');
    });
  });

  describe('Valid prd_generation jobs', () => {
    test('accepts valid prd_generation job', () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBeNull();
    });

    test('accepts prd_generation job with optional prompt', () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test task',
        prompt: 'Test prompt'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBeNull();
    });

    test('accepts prd_generation job with null prompt', () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test task',
        prompt: null
      };
      const error = apiClient.validateJob(job);
      expect(error).toBeNull();
    });
  });

  describe('Code execution job validation', () => {
    test('accepts valid code_execution job', () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test task',
        project: {
          system_path: '/path/to/project'
        }
      };
      const error = apiClient.validateJob(job);
      expect(error).toBeNull();
    });

    test('rejects code_execution job without project', () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test task'
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Project object is required for code_execution jobs');
    });

    test('rejects code_execution job without project.system_path', () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test task',
        project: {}
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Project system_path is missing or invalid');
    });

    test('rejects code_execution job with empty project.system_path', () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test task',
        project: {
          system_path: ''
        }
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Project system_path is missing or invalid');
    });

    test('rejects code_execution job with whitespace-only project.system_path', () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test task',
        project: {
          system_path: '   '
        }
      };
      const error = apiClient.validateJob(job);
      expect(error).toBe('Project system_path is missing or invalid');
    });

    test('accepts code_execution job with valid project', () => {
      const job = {
        id: 1,
        job_type: 'code_execution',
        task_title: 'Test task',
        project: {
          system_path: '/valid/path',
          name: 'Test Project'
        }
      };
      const error = apiClient.validateJob(job);
      expect(error).toBeNull();
    });
  });
});
