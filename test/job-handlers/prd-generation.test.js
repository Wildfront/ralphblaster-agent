const { EventEmitter } = require('events');
const path = require('path');
const PrdGenerationHandler = require('../../src/executor/job-handlers/prd-generation');

// Mock stream that will be recreated for each test
let mockStream = {
  write: jest.fn(),
  end: jest.fn()
};

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn()
}));

// Mock LogFileHelper
jest.mock('../../src/utils/log-file-helper', () => ({
  createJobLogStream: jest.fn(),
  writeCompletionFooterToStream: jest.fn(),
  createLogAndProgressCallbackStream: jest.fn()
}));

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('PrdGenerationHandler', () => {
  let handler;
  let mockPromptValidator;
  let mockPathHelper;
  let mockClaudeRunner;
  let mockApiClient;
  let LogFileHelper;
  let fs;

  beforeEach(() => {
    // Create a fresh mock stream for each test
    mockStream = {
      write: jest.fn(),
      end: jest.fn()
    };

    // Get LogFileHelper mock
    LogFileHelper = require('../../src/utils/log-file-helper');
    fs = require('fs');

    // Clear all mock call history
    jest.clearAllMocks();

    // Setup LogFileHelper mocks to return stream
    LogFileHelper.createJobLogStream.mockResolvedValue({
      logFile: '/test/.rb-logs/job-123.log',
      logStream: mockStream
    });

    LogFileHelper.createLogAndProgressCallbackStream.mockImplementation((stream, onProgress) => {
      const callback = async (chunk) => {
        stream.write(chunk);
        if (onProgress) {
          onProgress(chunk);
        }
      };
      Object.defineProperty(callback, 'totalChunks', {
        get: () => 0
      });
      return callback;
    });

    // Setup fs.existsSync mock
    fs.existsSync.mockReturnValue(true);

    // Mock prompt validator
    mockPromptValidator = {
      validatePrompt: jest.fn()
    };

    // Mock path helper
    mockPathHelper = {
      validateProjectPathStrict: jest.fn(),
      validateProjectPathWithFallback: jest.fn().mockReturnValue(process.cwd())
    };

    // Mock Claude runner
    mockClaudeRunner = {
      runClaudeDirectly: jest.fn()
    };

    // Mock API client
    mockApiClient = {
      sendStatusEvent: jest.fn().mockResolvedValue(undefined),
      flushProgressBuffer: jest.fn().mockResolvedValue(undefined)
    };

    // Create handler with mocked dependencies
    handler = new PrdGenerationHandler(
      mockPromptValidator,
      mockPathHelper,
      mockClaudeRunner,
      mockApiClient
    );
  });

  describe('executeStandardPrd()', () => {
    test('throws error when no prompt provided', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD'
      };

      await expect(handler.executeStandardPrd(job, jest.fn(), Date.now()))
        .rejects.toThrow('No prompt provided by server');
    });

    test('throws error when prompt is empty', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: '   '
      };

      await expect(handler.executeStandardPrd(job, jest.fn(), Date.now()))
        .rejects.toThrow('No prompt provided by server');
    });

    test('validates prompt for security', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Valid prompt'
      };

      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockPromptValidator.validatePrompt).toHaveBeenCalledWith('Valid prompt');
    });

    test('uses process.cwd() when no project path provided', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        process.cwd(),
        'Generate PRD',
        job,
        expect.any(Function)
      );
    });

    test('uses sanitized project path when provided', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD',
        project: {
          system_path: '/test/path'
        }
      };

      mockPathHelper.validateProjectPathWithFallback.mockReturnValue('/test/path');
      fs.existsSync.mockReturnValue(true);
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockPathHelper.validateProjectPathWithFallback).toHaveBeenCalledWith(
        '/test/path',
        process.cwd()
      );
      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        '/test/path',
        'Generate PRD',
        job,
        expect.any(Function)
      );
    });

    test('falls back to cwd for invalid project path', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD',
        project: {
          system_path: '/invalid/path'
        }
      };

      // validateProjectPathWithFallback handles the fallback internally
      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        process.cwd(),
        'Generate PRD',
        job,
        expect.any(Function)
      );
    });

    test('falls back to cwd for non-existent project path', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD',
        project: {
          system_path: '/test/path'
        }
      };

      // validateProjectPathWithFallback handles the fallback internally
      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        process.cwd(),
        'Generate PRD',
        job,
        expect.any(Function)
      );
    });


    test('sends status event when PRD generation starts', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        1,
        'prd_generation_started',
        'Starting PRD generation with Claude...'
      );
    });


    test('sends completion status event', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        1,
        'prd_generation_complete',
        'PRD generation completed successfully'
      );
    });

    test('returns correct result format', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      const startTime = Date.now();
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: '  PRD output content  ',
        branchName: 'main',
        duration: 5000
      });

      // Wait a bit to ensure executionTimeMs > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await handler.executeStandardPrd(job, jest.fn(), startTime);

      expect(result).toMatchObject({
        output: '  PRD output content  ',
        prdContent: 'PRD output content',
        executionTimeMs: expect.any(Number)
      });
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    test('handles Claude runner errors and sends failure event', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      const error = new Error('Claude failed');
      error.category = 'claude_error';
      mockClaudeRunner.runClaudeDirectly.mockRejectedValue(error);

      await expect(handler.executeStandardPrd(job, jest.fn(), Date.now()))
        .rejects.toThrow('Claude failed');

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        1,
        'prd_generation_failed',
        'PRD generation failed: Claude failed'
      );
    });

    test('handles log file write errors gracefully', async () => {
      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      let capturedProgressCallback;

      // Mock stream that throws error on write
      const errorStream = {
        write: jest.fn(() => { throw new Error('Disk full'); }),
        end: jest.fn()
      };

      LogFileHelper.createJobLogStream.mockResolvedValue({
        logFile: '/test/.rb-logs/job-1.log',
        logStream: errorStream
      });

      mockClaudeRunner.runClaudeDirectly.mockImplementation((cwd, prompt, job, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve({
          output: 'PRD output',
          branchName: 'main',
          duration: 5000
        });
      });

      const promise = handler.executeStandardPrd(job, jest.fn(), Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Trigger progress with failing stream - should not throw
      await capturedProgressCallback('Analyzing requirements');

      // Should not throw - log errors are handled gracefully
      const result = await promise;
      expect(result.output).toBe('PRD output');
    });

    test('does not call apiClient when not provided', async () => {
      const handlerWithoutApi = new PrdGenerationHandler(
        mockPromptValidator,
        mockPathHelper,
        mockClaudeRunner,
        null
      );

      const job = {
        id: 1,
        job_type: 'plan_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'PRD output',
        branchName: 'main',
        duration: 5000
      });

      await handlerWithoutApi.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockApiClient.sendStatusEvent).not.toHaveBeenCalled();
    });
  });

  describe('executePlanGeneration()', () => {
    test('uses server-provided prompt', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Server provided plan prompt'
      };

      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'Plan output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        process.cwd(),
        'Server provided plan prompt',
        job,
        expect.any(Function)
      );
    });

    test('uses process.cwd() when no project path', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'Plan output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        process.cwd(),
        'Generate plan',
        job,
        expect.any(Function)
      );
    });

    test('uses sanitized project path when provided', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan',
        project: {
          system_path: '/test/plan/path'
        }
      };

      mockPathHelper.validateProjectPathWithFallback.mockReturnValue('/test/plan/path');
      fs.existsSync.mockReturnValue(true);
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'Plan output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        '/test/plan/path',
        'Generate plan',
        job,
        expect.any(Function)
      );
    });


    test('returns correct result format', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      const startTime = Date.now();
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: '  Plan output content  ',
        branchName: 'main',
        duration: 5000
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await handler.executePlanGeneration(job, jest.fn(), startTime);

      expect(result).toMatchObject({
        output: '  Plan output content  ',
        prdContent: 'Plan output content',
        executionTimeMs: expect.any(Number)
      });
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    test('handles Claude runner errors', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      const error = new Error('Plan generation failed');
      mockClaudeRunner.runClaudeDirectly.mockRejectedValue(error);

      await expect(handler.executePlanGeneration(job, jest.fn(), Date.now()))
        .rejects.toThrow('Plan generation failed');
    });

    test('handles log file write errors gracefully', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      let capturedProgressCallback;

      // Mock stream that throws error on write
      const errorStream = {
        write: jest.fn(() => { throw new Error('Write error'); }),
        end: jest.fn()
      };

      LogFileHelper.createJobLogStream.mockResolvedValue({
        logFile: '/test/.rb-logs/job-1.log',
        logStream: errorStream
      });

      mockClaudeRunner.runClaudeDirectly.mockImplementation((cwd, prompt, job, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve({
          output: 'Plan output',
          branchName: 'main',
          duration: 5000
        });
      });

      const promise = handler.executePlanGeneration(job, jest.fn(), Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Trigger progress with failing stream - should not throw
      await capturedProgressCallback('Creating plan');

      const result = await promise;
      expect(result.output).toBe('Plan output');
    });

    test('handles missing project path gracefully', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'Plan output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        process.cwd(),
        'Generate plan',
        job,
        expect.any(Function)
      );
    });

    test('handles invalid project path fallback', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan',
        project: {
          system_path: '/invalid/path'
        }
      };

      // validateProjectPathWithFallback handles the fallback internally
      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaudeDirectly.mockResolvedValue({
        output: 'Plan output',
        branchName: 'main',
        duration: 5000
      });

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaudeDirectly).toHaveBeenCalledWith(
        process.cwd(),
        'Generate plan',
        job,
        expect.any(Function)
      );
    });
  });
});
