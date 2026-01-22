const Executor = require('../src/executor');
const { spawn } = require('child_process');

// Mock child_process
jest.mock('child_process');

// Mock config
jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'info'
}));

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('Executor - Process Management', () => {
  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new Executor();
  });

  describe('killCurrentProcess()', () => {
    test('terminates running process', () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      executor.killCurrentProcess();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('does nothing when no process exists', () => {
      executor.currentProcess = null;

      // Should not throw
      expect(() => executor.killCurrentProcess()).not.toThrow();
    });

    test('does nothing when process is already killed', () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: true
      };

      executor.currentProcess = mockProcess;

      executor.killCurrentProcess();

      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    test('force kills process after grace period if still alive', (done) => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      executor.killCurrentProcess();

      // First call should be SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // After 2 seconds, should force kill with SIGKILL
      setTimeout(() => {
        // Process still not killed, should force kill
        if (mockProcess.killed === false) {
          expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
        }
        done();
      }, 2100);
    }, 3000);

    test('handles errors when killing process', () => {
      const mockProcess = {
        kill: jest.fn().mockImplementation(() => {
          throw new Error('Kill failed');
        }),
        killed: false
      };

      executor.currentProcess = mockProcess;

      // Should not throw
      expect(() => executor.killCurrentProcess()).not.toThrow();
    });
  });

  describe('currentProcess tracking', () => {
    test('currentProcess is set when spawning Claude', (done) => {
      const mockProcess = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };

      spawn.mockReturnValue(mockProcess);

      // Simulate process completing to clean up timer
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      });
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});

      executor.runClaude('test prompt', '/test/path', jest.fn()).then(() => {
        done();
      });

      expect(executor.currentProcess).toBe(mockProcess);
    });

    test('currentProcess is cleared when process exits', (done) => {
      const mockProcess = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };

      spawn.mockReturnValue(mockProcess);

      // Simulate process exit
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => {
            callback(0);
            expect(executor.currentProcess).toBeNull();
            done();
          }, 0);
        }
      });
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('output')), 0);
        }
      });

      executor.runClaude('test', '/test', jest.fn());
    });

    test('currentProcess is cleared on process error', (done) => {
      const mockProcess = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };

      spawn.mockReturnValue(mockProcess);

      // Simulate process error
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => {
            callback(new Error('Process error'));
            expect(executor.currentProcess).toBeNull();
            done();
          }, 0);
        }
      });

      executor.runClaude('test', '/test', jest.fn()).catch(() => {
        // Expected to reject
      });
    });

    test('currentProcess is set when running Claude skill', (done) => {
      const mockProcess = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };

      spawn.mockReturnValue(mockProcess);

      // Simulate process completing to clean up timer
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      });
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});

      executor.runClaudeSkill('prd', 'test prompt', '/test/path', jest.fn()).then(() => {
        done();
      });

      expect(executor.currentProcess).toBe(mockProcess);
    });

    test('currentProcess is cleared when skill completes', (done) => {
      const mockProcess = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };

      spawn.mockReturnValue(mockProcess);

      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => {
            callback(0);
            expect(executor.currentProcess).toBeNull();
            done();
          }, 0);
        }
      });
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('output')), 0);
        }
      });

      executor.runClaudeSkill('prd', 'test', '/test', jest.fn());
    });
  });
});
