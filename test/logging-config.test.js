/**
 * Tests for centralized logging configuration
 */

describe('Logging Config', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear module cache to allow re-requiring with different env
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Default values', () => {
    test('uses default log level when not set', () => {
      delete process.env.RALPH_LOG_LEVEL;

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.logLevel).toBe('info');
    });

    test('uses default console colors when not set', () => {
      delete process.env.RALPH_CONSOLE_COLORS;

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(true);
    });

    test('uses default console format when not set', () => {
      delete process.env.RALPH_CONSOLE_FORMAT;

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleFormat).toBe('pretty');
    });

    test('uses default agent ID when not set', () => {
      delete process.env.RALPH_AGENT_ID;

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.agentId).toBe('agent-default');
    });

    test('uses default batch size when not set', () => {
      delete process.env.RALPH_MAX_BATCH_SIZE;

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.maxBatchSize).toBe(50);
    });

    test('uses default flush interval when not set', () => {
      delete process.env.RALPH_FLUSH_INTERVAL;

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.flushInterval).toBe(2000);
    });

    test('uses default use batch endpoint when not set', () => {
      delete process.env.RALPH_USE_BATCH_ENDPOINT;

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.useBatchEndpoint).toBe(true);
    });
  });

  describe('Custom values', () => {
    test('uses custom log level when set', () => {
      process.env.RALPH_LOG_LEVEL = 'debug';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.logLevel).toBe('debug');
    });

    test('disables console colors when explicitly set to false', () => {
      process.env.RALPH_CONSOLE_COLORS = 'false';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(false);
    });

    test('uses custom console format when set', () => {
      process.env.RALPH_CONSOLE_FORMAT = 'json';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleFormat).toBe('json');
    });

    test('uses custom agent ID when set', () => {
      process.env.RALPH_AGENT_ID = 'agent-42';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.agentId).toBe('agent-42');
    });

    test('uses custom batch size when set', () => {
      process.env.RALPH_MAX_BATCH_SIZE = '20';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.maxBatchSize).toBe(20);
    });

    test('uses custom flush interval when set', () => {
      process.env.RALPH_FLUSH_INTERVAL = '5000';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.flushInterval).toBe(5000);
    });

    test('disables batch endpoint when explicitly set to false', () => {
      process.env.RALPH_USE_BATCH_ENDPOINT = 'false';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.useBatchEndpoint).toBe(false);
    });
  });

  describe('Log level validation', () => {
    test('falls back to info for invalid log level', () => {
      process.env.RALPH_LOG_LEVEL = 'invalid';

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.logLevel).toBe('info');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid log level "invalid"')
      );

      console.warn = originalWarn;
    });

    test('accepts all valid log levels', () => {
      const validLevels = ['error', 'warn', 'info', 'debug'];

      validLevels.forEach(level => {
        jest.resetModules();
        process.env.RALPH_LOG_LEVEL = level;

        const loggingConfig = require('../src/logging/config');

        expect(loggingConfig.logLevel).toBe(level);
      });
    });
  });

  describe('Console format validation', () => {
    test('falls back to pretty for invalid console format', () => {
      process.env.RALPH_CONSOLE_FORMAT = 'invalid';

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleFormat).toBe('pretty');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid console format "invalid"')
      );

      console.warn = originalWarn;
    });

    test('accepts both valid console formats', () => {
      const validFormats = ['pretty', 'json'];

      validFormats.forEach(format => {
        jest.resetModules();
        process.env.RALPH_CONSOLE_FORMAT = format;

        const loggingConfig = require('../src/logging/config');

        expect(loggingConfig.consoleFormat).toBe(format);
      });
    });
  });

  describe('Numeric validation', () => {
    test('rejects negative batch size', () => {
      process.env.RALPH_MAX_BATCH_SIZE = '-10';

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.maxBatchSize).toBe(50); // Default
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid numeric value "-10"')
      );

      console.warn = originalWarn;
    });

    test('rejects zero batch size', () => {
      process.env.RALPH_MAX_BATCH_SIZE = '0';

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.maxBatchSize).toBe(50); // Default
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid numeric value "0"')
      );

      console.warn = originalWarn;
    });

    test('rejects non-numeric batch size', () => {
      process.env.RALPH_MAX_BATCH_SIZE = 'not-a-number';

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.maxBatchSize).toBe(50); // Default
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid numeric value "not-a-number"')
      );

      console.warn = originalWarn;
    });

    test('rejects negative flush interval', () => {
      process.env.RALPH_FLUSH_INTERVAL = '-1000';

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.flushInterval).toBe(2000); // Default
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid numeric value "-1000"')
      );

      console.warn = originalWarn;
    });
  });

  describe('Boolean parsing', () => {
    test('treats "false" string as false', () => {
      process.env.RALPH_CONSOLE_COLORS = 'false';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(false);
    });

    test('treats "0" string as false', () => {
      process.env.RALPH_CONSOLE_COLORS = '0';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(false);
    });

    test('treats empty string as false', () => {
      process.env.RALPH_CONSOLE_COLORS = '';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(false);
    });

    test('treats "true" string as true', () => {
      process.env.RALPH_CONSOLE_COLORS = 'true';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(true);
    });

    test('treats "1" string as true', () => {
      process.env.RALPH_CONSOLE_COLORS = '1';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(true);
    });

    test('treats any other string as true', () => {
      process.env.RALPH_CONSOLE_COLORS = 'yes';

      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.consoleColors).toBe(true);
    });
  });

  describe('Configuration immutability', () => {
    test('config object is frozen', () => {
      const loggingConfig = require('../src/logging/config');

      expect(Object.isFrozen(loggingConfig)).toBe(true);
    });

    test('cannot modify config values', () => {
      const loggingConfig = require('../src/logging/config');
      const originalValue = loggingConfig.logLevel;

      // Attempt to modify (will silently fail in non-strict mode)
      loggingConfig.logLevel = 'debug';

      // Verify value hasn't changed
      expect(loggingConfig.logLevel).toBe(originalValue);
    });
  });

  describe('Metadata', () => {
    test('exports valid log levels', () => {
      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.validLogLevels).toEqual(['error', 'warn', 'info', 'debug']);
    });

    test('exports valid console formats', () => {
      const loggingConfig = require('../src/logging/config');

      expect(loggingConfig.validConsoleFormats).toEqual(['pretty', 'json']);
    });
  });
});
