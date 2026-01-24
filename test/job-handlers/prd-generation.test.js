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
      logFile: '/test/.ralph-logs/job-123.log',
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
      runClaude: jest.fn()
    };

    // Mock API client
    mockApiClient = {
      sendStatusEvent: jest.fn().mockResolvedValue(undefined)
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
        job_type: 'prd_generation',
        task_title: 'Test PRD'
      };

      await expect(handler.executeStandardPrd(job, jest.fn(), Date.now()))
        .rejects.toThrow('No prompt provided by server');
    });

    test('throws error when prompt is empty', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: '   '
      };

      await expect(handler.executeStandardPrd(job, jest.fn(), Date.now()))
        .rejects.toThrow('No prompt provided by server');
    });

    test('validates prompt for security', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Valid prompt'
      };

      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockPromptValidator.validatePrompt).toHaveBeenCalledWith('Valid prompt');
    });

    test('uses process.cwd() when no project path provided', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate PRD',
        process.cwd(),
        expect.any(Function)
      );
    });

    test('uses sanitized project path when provided', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD',
        project: {
          system_path: '/test/path'
        }
      };

      mockPathHelper.validateProjectPathWithFallback.mockReturnValue('/test/path');
      fs.existsSync.mockReturnValue(true);
      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockPathHelper.validateProjectPathWithFallback).toHaveBeenCalledWith(
        '/test/path',
        process.cwd()
      );
      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate PRD',
        '/test/path',
        expect.any(Function)
      );
    });

    test('falls back to cwd for invalid project path', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD',
        project: {
          system_path: '/invalid/path'
        }
      };

      // validateProjectPathWithFallback handles the fallback internally
      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate PRD',
        process.cwd(),
        expect.any(Function)
      );
    });

    test('falls back to cwd for non-existent project path', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD',
        project: {
          system_path: '/test/path'
        }
      };

      // validateProjectPathWithFallback handles the fallback internally
      mockPathHelper.validateProjectPathWithFallback.mockReturnValue(process.cwd());
      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate PRD',
        process.cwd(),
        expect.any(Function)
      );
    });

    test('creates log directory and writes log header', async () => {
      const job = {
        id: 123,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      const startTime = new Date('2024-01-01T12:00:00Z').getTime();
      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), startTime);

      expect(LogFileHelper.createJobLogStream).toHaveBeenCalledWith(
        process.cwd(),
        job,
        startTime,
        'PRD Generation'
      );
    });

    test('sends status event when PRD generation starts', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        1,
        'prd_generation_started',
        'Starting PRD generation with Claude...'
      );
    });

    test('writes chunks to log file and calls onProgress', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      const mockOnProgress = jest.fn();
      let capturedProgressCallback;

      LogFileHelper.createLogAndProgressCallbackStream.mockImplementation((stream, onProgress) => {
        const callback = async (chunk) => {
          stream.write(chunk);
          if (onProgress) {
            onProgress(chunk);
          }
        };
        Object.defineProperty(callback, 'totalChunks', {
          get: () => 2
        });
        return callback;
      });

      mockClaudeRunner.runClaude.mockImplementation((prompt, cwd, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve('PRD output');
      });

      const promise = handler.executeStandardPrd(job, mockOnProgress, Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Simulate progress chunks
      await capturedProgressCallback('chunk1');
      await capturedProgressCallback('chunk2');

      await promise;

      expect(mockStream.write).toHaveBeenCalledWith('chunk1');
      expect(mockStream.write).toHaveBeenCalledWith('chunk2');
      expect(mockOnProgress).toHaveBeenCalledWith('chunk1');
      expect(mockOnProgress).toHaveBeenCalledWith('chunk2');
    });

    test('writes completion footer to log file', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(LogFileHelper.writeCompletionFooterToStream).toHaveBeenCalledWith(
        mockStream,
        'PRD Generation'
      );
    });

    test('sends completion status event', async () => {
      const job = {
        id: 1,
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

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
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      const startTime = Date.now();
      mockClaudeRunner.runClaude.mockResolvedValue('  PRD output content  ');

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
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      const error = new Error('Claude failed');
      error.category = 'claude_error';
      mockClaudeRunner.runClaude.mockRejectedValue(error);

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
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      const logger = require('../../src/logger');
      let capturedProgressCallback;

      // Mock stream that throws error on write
      const errorStream = {
        write: jest.fn(() => { throw new Error('Disk full'); }),
        end: jest.fn()
      };

      LogFileHelper.createJobLogStream.mockResolvedValue({
        logFile: '/test/.ralph-logs/job-1.log',
        logStream: errorStream
      });

      LogFileHelper.createLogAndProgressCallbackStream.mockImplementation((stream, onProgress) => {
        const callback = async (chunk) => {
          try {
            stream.write(chunk);
          } catch (err) {
            logger.warn(`Failed to write to log stream: ${err.message}`);
          }
          if (onProgress) {
            onProgress(chunk);
          }
        };
        Object.defineProperty(callback, 'totalChunks', {
          get: () => 0
        });
        return callback;
      });

      mockClaudeRunner.runClaude.mockImplementation((prompt, cwd, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve('PRD output');
      });

      const promise = handler.executeStandardPrd(job, jest.fn(), Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Trigger progress with failing stream
      await capturedProgressCallback('chunk');

      // Should not throw - log errors are handled gracefully
      const result = await promise;
      expect(result.output).toBe('PRD output');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to write to log stream'));
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
        job_type: 'prd_generation',
        task_title: 'Test PRD',
        prompt: 'Generate PRD'
      };

      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

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

      mockClaudeRunner.runClaude.mockResolvedValue('Plan output');

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Server provided plan prompt',
        process.cwd(),
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

      mockClaudeRunner.runClaude.mockResolvedValue('Plan output');

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate plan',
        process.cwd(),
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
      mockClaudeRunner.runClaude.mockResolvedValue('Plan output');

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate plan',
        '/test/plan/path',
        expect.any(Function)
      );
    });

    test('creates log directory and writes plan log header', async () => {
      const job = {
        id: 456,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      const startTime = new Date('2024-01-01T14:30:00Z').getTime();
      mockClaudeRunner.runClaude.mockResolvedValue('Plan output');

      await handler.executePlanGeneration(job, jest.fn(), startTime);

      expect(LogFileHelper.createJobLogStream).toHaveBeenCalledWith(
        process.cwd(),
        job,
        startTime,
        'Plan Generation'
      );
    });

    test('writes chunks to log file and calls onProgress', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      const mockOnProgress = jest.fn();
      let capturedProgressCallback;

      LogFileHelper.createLogAndProgressCallbackStream.mockImplementation((stream, onProgress) => {
        const callback = async (chunk) => {
          stream.write(chunk);
          if (onProgress) {
            onProgress(chunk);
          }
        };
        Object.defineProperty(callback, 'totalChunks', {
          get: () => 2
        });
        return callback;
      });

      mockClaudeRunner.runClaude.mockImplementation((prompt, cwd, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve('Plan output');
      });

      const promise = handler.executePlanGeneration(job, mockOnProgress, Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Simulate progress chunks
      await capturedProgressCallback('plan chunk 1');
      await capturedProgressCallback('plan chunk 2');

      await promise;

      expect(mockStream.write).toHaveBeenCalledWith('plan chunk 1');
      expect(mockStream.write).toHaveBeenCalledWith('plan chunk 2');
      expect(mockOnProgress).toHaveBeenCalledWith('plan chunk 1');
      expect(mockOnProgress).toHaveBeenCalledWith('plan chunk 2');
    });

    test('writes completion footer to log file', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      mockClaudeRunner.runClaude.mockResolvedValue('Plan output');

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(LogFileHelper.writeCompletionFooterToStream).toHaveBeenCalledWith(
        mockStream,
        'Plan Generation'
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
      mockClaudeRunner.runClaude.mockResolvedValue('  Plan output content  ');

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
      mockClaudeRunner.runClaude.mockRejectedValue(error);

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

      const logger = require('../../src/logger');
      let capturedProgressCallback;

      // Mock stream that throws error on write
      const errorStream = {
        write: jest.fn(() => { throw new Error('Write error'); }),
        end: jest.fn()
      };

      LogFileHelper.createJobLogStream.mockResolvedValue({
        logFile: '/test/.ralph-logs/job-1.log',
        logStream: errorStream
      });

      LogFileHelper.createLogAndProgressCallbackStream.mockImplementation((stream, onProgress) => {
        const callback = async (chunk) => {
          try {
            stream.write(chunk);
          } catch (err) {
            logger.warn(`Failed to write to log stream: ${err.message}`);
          }
          if (onProgress) {
            onProgress(chunk);
          }
        };
        Object.defineProperty(callback, 'totalChunks', {
          get: () => 0
        });
        return callback;
      });

      mockClaudeRunner.runClaude.mockImplementation((prompt, cwd, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve('Plan output');
      });

      const promise = handler.executePlanGeneration(job, jest.fn(), Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Trigger progress with failing stream
      await capturedProgressCallback('chunk');

      const result = await promise;
      expect(result.output).toBe('Plan output');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to write to log stream'));
    });

    test('handles missing project path gracefully', async () => {
      const job = {
        id: 1,
        prd_mode: 'plan',
        task_title: 'Test Plan',
        prompt: 'Generate plan'
      };

      mockClaudeRunner.runClaude.mockResolvedValue('Plan output');

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate plan',
        process.cwd(),
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
      mockClaudeRunner.runClaude.mockResolvedValue('Plan output');

      await handler.executePlanGeneration(job, jest.fn(), Date.now());

      expect(mockClaudeRunner.runClaude).toHaveBeenCalledWith(
        'Generate plan',
        process.cwd(),
        expect.any(Function)
      );
    });
  });
});
