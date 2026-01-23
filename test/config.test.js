// Config tests need to manipulate environment variables before requiring the module
// So we'll use a helper to reload the config module with different env vars

// Mock ConfigFileManager before requiring config
jest.mock('../src/config-file-manager', () => {
  return jest.fn().mockImplementation(() => ({
    read: jest.fn().mockReturnValue(null),
    write: jest.fn(),
    exists: jest.fn().mockReturnValue(false)
  }));
});

describe('Config', () => {
  let originalEnv;
  let consoleErrorSpy;
  let processExitSpy;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Spy on console.error and process.exit
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

    // Clear module cache to allow re-requiring with different env
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Restore spies
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('API Token validation', () => {
    test('exits when RALPH_API_TOKEN is missing', () => {
      delete process.env.RALPH_API_TOKEN;

      require('../src/config');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error: RALPH_API_TOKEN environment variable is required'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('exits when RALPH_API_TOKEN is empty string', () => {
      process.env.RALPH_API_TOKEN = '';

      require('../src/config');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('accepts valid RALPH_API_TOKEN', () => {
      process.env.RALPH_API_TOKEN = 'valid-token-123';

      const config = require('../src/config');

      expect(processExitSpy).not.toHaveBeenCalled();
      expect(config.apiToken).toBe('valid-token-123');
    });
  });

  describe('Environment variable parsing', () => {
    test('parses RALPH_MAX_RETRIES as integer', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_MAX_RETRIES = '5';

      const config = require('../src/config');

      expect(config.maxRetries).toBe(5);
      expect(typeof config.maxRetries).toBe('number');
    });
  });

  describe('Default values', () => {
    test('uses default API URL when not set', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      delete process.env.RALPH_API_URL;

      const config = require('../src/config');

      expect(config.apiUrl).toBe('https://app.ralphblaster.com');
    });

    test('uses default max retries when not set', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      delete process.env.RALPH_MAX_RETRIES;

      const config = require('../src/config');

      expect(config.maxRetries).toBe(3);
    });

    test('uses default log level when not set', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      delete process.env.RALPH_LOG_LEVEL;

      const config = require('../src/config');

      expect(config.logLevel).toBe('info');
    });
  });

  describe('Custom values', () => {
    test('uses custom API URL when set', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_API_URL = 'https://custom-api.com';

      const config = require('../src/config');

      expect(config.apiUrl).toBe('https://custom-api.com');
    });

    test('uses custom max retries when set', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_MAX_RETRIES = '10';

      const config = require('../src/config');

      expect(config.maxRetries).toBe(10);
    });

    test('uses custom log level when set', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_LOG_LEVEL = 'debug';

      const config = require('../src/config');

      expect(config.logLevel).toBe('debug');
    });
  });

  describe('Integer parsing edge cases', () => {
    test('handles invalid max retries gracefully', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_MAX_RETRIES = 'not-a-number';

      const config = require('../src/config');

      // parseInt('not-a-number', 10) returns NaN
      expect(isNaN(config.maxRetries)).toBe(true);
    });

    test('handles negative max retries', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_MAX_RETRIES = '-5';

      const config = require('../src/config');

      expect(config.maxRetries).toBe(-5);
    });

    test('handles zero max retries', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_MAX_RETRIES = '0';

      const config = require('../src/config');

      expect(config.maxRetries).toBe(0);
    });
  });
});
