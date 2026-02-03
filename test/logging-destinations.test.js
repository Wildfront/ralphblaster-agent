/**
 * Tests for log destination abstraction layer
 */

const {
  BaseDestination,
  ConsoleDestination,
  FileDestination,
  ApiDestination,
  BatchedDestination
} = require('../src/logging/destinations');

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

describe('BaseDestination', () => {
  test('constructor initializes with config', () => {
    const config = { test: 'value' };
    const destination = new BaseDestination(config);

    expect(destination.config).toEqual(config);
    expect(destination.isShuttingDown).toBe(false);
  });

  test('write() throws error (abstract method)', async () => {
    const destination = new BaseDestination();

    await expect(
      destination.write('info', 'test')
    ).rejects.toThrow('write() must be implemented by subclass');
  });

  test('flush() is a no-op by default', async () => {
    const destination = new BaseDestination();

    await expect(destination.flush()).resolves.toBeUndefined();
  });

  test('close() sets isShuttingDown and calls flush', async () => {
    const destination = new BaseDestination();
    const flushSpy = jest.spyOn(destination, 'flush');

    await destination.close();

    expect(destination.isShuttingDown).toBe(true);
    expect(flushSpy).toHaveBeenCalled();
  });

  test('shouldLog() returns true by default', () => {
    const destination = new BaseDestination();

    expect(destination.shouldLog('info')).toBe(true);
    expect(destination.shouldLog('error')).toBe(true);
  });

  test('handleError() is silent by default', () => {
    const destination = new BaseDestination();
    const error = new Error('test error');

    // Should not throw
    expect(() => {
      destination.handleError(error, 'info', 'test message');
    }).not.toThrow();
  });
});

describe('ConsoleDestination', () => {
  let originalConsoleLog;
  let originalConsoleError;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleLogSpy = jest.fn();
    consoleErrorSpy = jest.fn();
    console.log = consoleLogSpy;
    console.error = consoleErrorSpy;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  test('constructor sets default config', () => {
    const destination = new ConsoleDestination();

    expect(destination.colors).toBe(true);
    expect(destination.format).toBe('pretty');
    expect(destination.minLevel).toBe('info');
  });

  test('constructor accepts custom config', () => {
    const destination = new ConsoleDestination({
      colors: false,
      format: 'json',
      minLevel: 'debug'
    });

    expect(destination.colors).toBe(false);
    expect(destination.format).toBe('json');
    expect(destination.minLevel).toBe('debug');
  });

  test('shouldLog() filters based on minLevel', () => {
    const destination = new ConsoleDestination({ minLevel: 'warn' });

    expect(destination.shouldLog('error')).toBe(true);
    expect(destination.shouldLog('warn')).toBe(true);
    expect(destination.shouldLog('info')).toBe(false);
    expect(destination.shouldLog('debug')).toBe(false);
  });

  test('write() outputs to console.log for non-error levels', async () => {
    const destination = new ConsoleDestination({ format: 'json' });

    await destination.write('info', 'test message', { key: 'value' });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('test message');
    expect(parsed.metadata.key).toBe('value');
  });

  test('write() outputs to console.error for error level', async () => {
    const destination = new ConsoleDestination({ format: 'json' });

    await destination.write('error', 'error message');

    expect(consoleErrorSpy).toHaveBeenCalled();
    const output = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('error message');
  });

  test('write() respects shouldLog filter', async () => {
    const destination = new ConsoleDestination({ minLevel: 'warn' });

    await destination.write('debug', 'should not appear');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('write() redacts sensitive data', async () => {
    const destination = new ConsoleDestination({ format: 'json' });

    await destination.write('info', 'Authorization: Bearer sk-secret123', {
      token: 'secret-token'
    });

    const output = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.message).toContain('[REDACTED]');
    expect(parsed.metadata.token).toBe('[REDACTED]');
  });

  test('formatJson() creates valid JSON output', async () => {
    const destination = new ConsoleDestination({ format: 'json' });

    await destination.write('info', 'test', { data: 123 });

    const output = consoleLogSpy.mock.calls[0][0];

    expect(() => JSON.parse(output)).not.toThrow();
  });

  test('formatPretty() creates human-readable output', async () => {
    const destination = new ConsoleDestination({
      format: 'pretty',
      colors: false
    });

    await destination.write('info', 'test message', { component: 'test' });

    const output = consoleLogSpy.mock.calls[0][0];

    expect(output).toContain('INFO');
    expect(output).toContain('test message');
  });
});

describe('FileDestination', () => {
  const testDir = path.join(__dirname, '.test-logs');
  const workingDir = testDir;
  const job = { id: 999, task_title: 'Test Job' };
  const startTime = Date.now();
  const jobType = 'Test';

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
    await fsPromises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  test('constructor requires workingDir', () => {
    expect(() => {
      new FileDestination({
        job,
        startTime,
        jobType
      });
    }).toThrow('FileDestination requires workingDir');
  });

  test('constructor requires job', () => {
    expect(() => {
      new FileDestination({
        workingDir,
        startTime,
        jobType
      });
    }).toThrow('FileDestination requires job');
  });

  test('constructor requires startTime', () => {
    expect(() => {
      new FileDestination({
        workingDir,
        job,
        jobType
      });
    }).toThrow('FileDestination requires startTime');
  });

  test('constructor requires jobType', () => {
    expect(() => {
      new FileDestination({
        workingDir,
        job,
        startTime
      });
    }).toThrow('FileDestination requires jobType');
  });

  test('write() creates log file on first write (streaming mode)', async () => {
    const destination = new FileDestination({
      workingDir,
      job,
      startTime,
      jobType,
      useStream: true
    });

    await destination.write('info', 'test message');

    const logFile = destination.getLogFilePath();
    expect(logFile).toBeTruthy();

    // Close to ensure stream is flushed
    await destination.close();

    // Now check if file exists
    const exists = fs.existsSync(logFile);
    expect(exists).toBe(true);
  });

  test('write() creates log file on first write (non-streaming mode)', async () => {
    const destination = new FileDestination({
      workingDir,
      job,
      startTime,
      jobType,
      useStream: false
    });

    await destination.write('info', 'test message');

    const logFile = destination.getLogFilePath();
    expect(logFile).toBeTruthy();

    const exists = fs.existsSync(logFile);
    expect(exists).toBe(true);

    await destination.close();
  });

  test('write() includes log level and message', async () => {
    const destination = new FileDestination({
      workingDir,
      job,
      startTime,
      jobType,
      useStream: false
    });

    await destination.write('info', 'test message');
    await destination.close();

    const logFile = destination.getLogFilePath();
    const content = await fsPromises.readFile(logFile, 'utf8');

    expect(content).toContain('INFO');
    expect(content).toContain('test message');
  });

  test('write() includes metadata when provided', async () => {
    const destination = new FileDestination({
      workingDir,
      job,
      startTime,
      jobType,
      useStream: false
    });

    await destination.write('info', 'test', { key: 'value', num: 123 });
    await destination.close();

    const logFile = destination.getLogFilePath();
    const content = await fsPromises.readFile(logFile, 'utf8');

    expect(content).toContain('"key":"value"');
    expect(content).toContain('"num":123');
  });

  test('close() writes completion footer', async () => {
    const destination = new FileDestination({
      workingDir,
      job,
      startTime,
      jobType,
      useStream: false
    });

    await destination.write('info', 'test');
    await destination.close();

    const logFile = destination.getLogFilePath();
    const content = await fsPromises.readFile(logFile, 'utf8');

    expect(content).toContain('completed at:');
  });

  test('getLogFilePath() returns null before initialization', () => {
    const destination = new FileDestination({
      workingDir,
      job,
      startTime,
      jobType
    });

    expect(destination.getLogFilePath()).toBeNull();
  });
});

describe('ApiDestination', () => {
  let mockApiClient;

  beforeEach(() => {
    mockApiClient = {
      addSetupLog: jest.fn().mockResolvedValue(undefined),
      addSetupLogBatch: jest.fn().mockResolvedValue(undefined)
    };
  });

  test('constructor requires apiClient', () => {
    expect(() => {
      new ApiDestination({ jobId: 123 });
    }).toThrow('apiClient');
  });

  test('constructor requires jobId', () => {
    expect(() => {
      new ApiDestination({ apiClient: mockApiClient });
    }).toThrow('jobId');
  });

  test('constructor creates batcher with config', async () => {
    const destination = new ApiDestination({
      apiClient: mockApiClient,
      jobId: 123,
      maxBatchSize: 20,
      flushInterval: 5000,
      useBatchEndpoint: false
    });

    // BatchedDestination (parent) stores config internally
    expect(destination.destination).toBeDefined();
    expect(destination.maxBatchSize).toBe(20);
    expect(destination.flushInterval).toBe(5000);
    expect(destination.useBatchSend).toBe(false);

    await destination.close();
  });

  test('write() delegates to batcher', async () => {
    const destination = new ApiDestination({
      apiClient: mockApiClient,
      jobId: 123
    });

    // Spy on the parent BatchedDestination's write method
    const writeSpy = jest.spyOn(BatchedDestination.prototype, 'write');

    await destination.write('info', 'test message', { key: 'value' });

    expect(writeSpy).toHaveBeenCalledWith('info', 'test message', { key: 'value' });
    writeSpy.mockRestore();

    await destination.close();
  });

  test('flush() delegates to batcher', async () => {
    const destination = new ApiDestination({
      apiClient: mockApiClient,
      jobId: 123
    });

    // Spy on the parent BatchedDestination's flush method
    const flushSpy = jest.spyOn(BatchedDestination.prototype, 'flush');

    await destination.flush();

    expect(flushSpy).toHaveBeenCalled();
    flushSpy.mockRestore();

    await destination.close();
  });

  test('close() calls batcher shutdown', async () => {
    const destination = new ApiDestination({
      apiClient: mockApiClient,
      jobId: 123
    });

    // Spy on the parent BatchedDestination's close method
    const closeSpy = jest.spyOn(BatchedDestination.prototype, 'close');

    await destination.close();

    expect(destination.isShuttingDown).toBe(true);
    expect(closeSpy).toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  test('getBufferSize() returns batcher buffer size', async () => {
    const destination = new ApiDestination({
      apiClient: mockApiClient,
      jobId: 123
    });

    // Add some logs without flushing (using write, not add)
    // Since write is async now with BatchedDestination, we need to await
    await destination.write('info', 'message 1');
    await destination.write('info', 'message 2');

    expect(destination.getBufferSize()).toBe(2);

    await destination.close();
  });
});

describe('Destinations Index', () => {
  test('exports all destination classes', () => {
    const destinations = require('../src/logging/destinations');

    expect(destinations.BaseDestination).toBeDefined();
    expect(destinations.ConsoleDestination).toBeDefined();
    expect(destinations.FileDestination).toBeDefined();
    expect(destinations.ApiDestination).toBeDefined();
  });
});
