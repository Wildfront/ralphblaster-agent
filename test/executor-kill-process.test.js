jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'info'
}));
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const Executor = require('../src/executor');

describe('Executor - killCurrentProcess', () => {
  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    executor = new Executor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('killCurrentProcess - Process Killing', () => {
    test('kills active process with SIGTERM', async () => {
      const logger = require('../src/logger');
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();
      jest.runAllTimers();
      await killPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(logger.warn).toHaveBeenCalledWith(
        'Killing current Claude process due to shutdown'
      );
    });

    test('does nothing when no active process', async () => {
      executor.currentProcess = null;

      const killPromise = executor.killCurrentProcess();
      jest.runAllTimers();
      await killPromise;

      // Should complete without error
      expect(killPromise).resolves.toBeUndefined();
    });

    test('does nothing when process already killed', async () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: true
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();
      jest.runAllTimers();
      await killPromise;

      expect(mockProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe('killCurrentProcess - SIGTERM then SIGKILL Flow', () => {
    test('sends SIGKILL after grace period if process still alive', async () => {
      const logger = require('../src/logger');
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();

      // Advance past grace period
      jest.advanceTimersByTime(2000);

      await killPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(logger.warn).toHaveBeenCalledWith(
        'Force killing Claude process with SIGKILL'
      );
    });

    test('does not send SIGKILL if process was killed during grace period', async () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();

      // Simulate process being killed
      mockProcess.killed = true;

      jest.advanceTimersByTime(2000);

      await killPromise;

      // Should only call kill once (SIGTERM)
      expect(mockProcess.kill).toHaveBeenCalledTimes(1);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('kills captured process even if currentProcess becomes null during grace period', async () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();

      // Simulate process reference being cleared
      executor.currentProcess = null;

      jest.advanceTimersByTime(2000);

      await killPromise;

      // Should call kill twice (SIGTERM and SIGKILL) on the captured process
      // even though currentProcess was cleared
      expect(mockProcess.kill).toHaveBeenCalledTimes(2);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    test('does not kill new process if currentProcess is reassigned during grace period', async () => {
      const oldProcess = {
        kill: jest.fn(),
        killed: false
      };

      const newProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = oldProcess;

      const killPromise = executor.killCurrentProcess();

      // Simulate new process being assigned during grace period
      executor.currentProcess = newProcess;

      jest.advanceTimersByTime(2000);

      await killPromise;

      // Should only kill the old process, not the new one
      expect(oldProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(oldProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(newProcess.kill).not.toHaveBeenCalled();
    });

    test('uses correct grace period of 2000ms', async () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();

      // Advance to just before grace period
      jest.advanceTimersByTime(1999);

      // SIGKILL should not be sent yet
      expect(mockProcess.kill).toHaveBeenCalledTimes(1); // Only SIGTERM

      // Advance past grace period
      jest.advanceTimersByTime(2);

      await killPromise;

      // Now SIGKILL should be sent
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('killCurrentProcess - Error Handling', () => {
    test('handles SIGTERM error gracefully', async () => {
      const logger = require('../src/logger');
      const mockProcess = {
        kill: jest.fn().mockImplementation(() => {
          throw new Error('Process already dead');
        }),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();
      jest.runAllTimers();
      await killPromise;

      expect(logger.error).toHaveBeenCalledWith(
        'Error killing Claude process',
        expect.any(String)
      );
    });

    test('handles SIGKILL error gracefully', async () => {
      const logger = require('../src/logger');
      let killCount = 0;
      const mockProcess = {
        kill: jest.fn().mockImplementation(() => {
          killCount++;
          if (killCount === 2) {
            throw new Error('SIGKILL failed');
          }
        }),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();
      jest.advanceTimersByTime(2000);
      await killPromise;

      expect(logger.error).toHaveBeenCalledWith(
        'Error force killing process',
        'SIGKILL failed'
      );
    });

    test('continues execution despite kill errors', async () => {
      const mockProcess = {
        kill: jest.fn().mockImplementation(() => {
          throw new Error('Kill failed');
        }),
        killed: false
      };

      executor.currentProcess = mockProcess;

      // Should not throw
      const killPromise = executor.killCurrentProcess();
      jest.runAllTimers();
      await expect(killPromise).resolves.toBeUndefined();
    });
  });

  describe('killCurrentProcess - Integration', () => {
    test('resolves promise after grace period', async () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const killPromise = executor.killCurrentProcess();

      jest.advanceTimersByTime(2000);

      await expect(killPromise).resolves.toBeUndefined();
    });

    test('handles multiple concurrent kill attempts', async () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      const kill1 = executor.killCurrentProcess();
      const kill2 = executor.killCurrentProcess();

      jest.runAllTimers();

      await Promise.all([kill1, kill2]);

      // Both should complete successfully
      expect(kill1).resolves.toBeUndefined();
      expect(kill2).resolves.toBeUndefined();
    });

    test('works correctly when called during shutdown', async () => {
      const mockProcess = {
        kill: jest.fn(),
        killed: false
      };

      executor.currentProcess = mockProcess;

      // Simulate shutdown scenario
      const killPromise = executor.killCurrentProcess();

      // Process should be killed
      expect(mockProcess.kill).toHaveBeenCalled();

      jest.runAllTimers();
      await killPromise;
    });
  });
});
