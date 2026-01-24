const { EventEmitter } = require('events');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const PrdGenerationHandler = require('../../src/executor/job-handlers/prd-generation');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    appendFile: jest.fn()
  }
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
  let mockPathValidator;
  let mockClaudeRunner;
  let mockApiClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock prompt validator
    mockPromptValidator = {
      validatePrompt: jest.fn()
    };

    // Mock path validator
    mockPathValidator = {
      validateAndSanitizePath: jest.fn()
    };

    // Mock Claude runner
    mockClaudeRunner = {
      runClaude: jest.fn()
    };

    // Mock API client
    mockApiClient = {
      sendStatusEvent: jest.fn().mockResolvedValue(undefined)
    };

    // Setup fs.promises mocks to return resolved promises
    fsPromises.mkdir.mockResolvedValue(undefined);
    fsPromises.writeFile.mockResolvedValue(undefined);
    fsPromises.appendFile.mockResolvedValue(undefined);
    fs.existsSync.mockReturnValue(true);

    // Create handler with mocked dependencies
    handler = new PrdGenerationHandler(
      mockPromptValidator,
      mockPathValidator,
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

      mockPathValidator.validateAndSanitizePath.mockReturnValue('/test/path');
      fs.existsSync.mockReturnValue(true);
      mockClaudeRunner.runClaude.mockResolvedValue('PRD output');

      await handler.executeStandardPrd(job, jest.fn(), Date.now());

      expect(mockPathValidator.validateAndSanitizePath).toHaveBeenCalledWith('/test/path');
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

      mockPathValidator.validateAndSanitizePath.mockReturnValue(null);
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

      mockPathValidator.validateAndSanitizePath.mockReturnValue('/test/path');
      fs.existsSync.mockReturnValue(false);
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

      const expectedLogDir = path.join(process.cwd(), '.ralph-logs');
      expect(fsPromises.mkdir).toHaveBeenCalledWith(expectedLogDir, { recursive: true });

      const expectedLogFile = path.join(expectedLogDir, 'job-123.log');
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expectedLogFile,
        expect.stringContaining('PRD Generation Job #123')
      );
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expectedLogFile,
        expect.stringContaining('Test PRD')
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

      expect(fsPromises.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('job-1.log'),
        'chunk1'
      );
      expect(fsPromises.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('job-1.log'),
        'chunk2'
      );
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

      // Check that appendFile was called with completion footer
      const appendCalls = fsPromises.appendFile.mock.calls;
      const lastCall = appendCalls[appendCalls.length - 1];
      expect(lastCall[1]).toContain('PRD Generation completed at:');
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

      let capturedProgressCallback;

      mockClaudeRunner.runClaude.mockImplementation((prompt, cwd, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve('PRD output');
      });

      const promise = handler.executeStandardPrd(job, jest.fn(), Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Simulate log file write error during progress
      fsPromises.appendFile.mockRejectedValue(new Error('Disk full'));

      // Trigger progress with failing appendFile
      await capturedProgressCallback('chunk');

      // Should not throw - log errors are handled gracefully
      const result = await promise;
      expect(result.output).toBe('PRD output');
    });

    test('does not call apiClient when not provided', async () => {
      const handlerWithoutApi = new PrdGenerationHandler(
        mockPromptValidator,
        mockPathValidator,
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

      mockPathValidator.validateAndSanitizePath.mockReturnValue('/test/plan/path');
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

      const expectedLogDir = path.join(process.cwd(), '.ralph-logs');
      expect(fsPromises.mkdir).toHaveBeenCalledWith(expectedLogDir, { recursive: true });

      const expectedLogFile = path.join(expectedLogDir, 'job-456.log');
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expectedLogFile,
        expect.stringContaining('Plan Generation Job #456')
      );
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expectedLogFile,
        expect.stringContaining('Test Plan')
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

      expect(fsPromises.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('job-1.log'),
        'plan chunk 1'
      );
      expect(fsPromises.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('job-1.log'),
        'plan chunk 2'
      );
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

      const appendCalls = fsPromises.appendFile.mock.calls;
      const lastCall = appendCalls[appendCalls.length - 1];
      expect(lastCall[1]).toContain('Plan Generation completed at:');
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

      let capturedProgressCallback;

      mockClaudeRunner.runClaude.mockImplementation((prompt, cwd, onProgress) => {
        capturedProgressCallback = onProgress;
        return Promise.resolve('Plan output');
      });

      const promise = handler.executePlanGeneration(job, jest.fn(), Date.now());

      // Wait for async setup
      await new Promise(resolve => setImmediate(resolve));

      // Simulate log file write error during progress
      fsPromises.appendFile.mockRejectedValue(new Error('Write error'));

      // Trigger progress with failing appendFile
      await capturedProgressCallback('chunk');

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

      mockPathValidator.validateAndSanitizePath.mockReturnValue(null);
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
