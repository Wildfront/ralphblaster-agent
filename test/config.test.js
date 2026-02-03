// Config tests need to manipulate environment variables before requiring the module
// So we'll use a helper to reload the config module with different env vars

// Mock dotenv to prevent loading .env file during tests
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

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
  let consoleWarnSpy;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear module cache to allow re-requiring with different env
    jest.resetModules();

    // Suppress console.warn for deprecation warnings during tests
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Restore console.warn
    if (consoleWarnSpy) {
      consoleWarnSpy.mockRestore();
    }
  });

  describe('API Token validation', () => {
    test('throws error when API token is missing', () => {
      delete process.env.RALPH_API_TOKEN;
      delete process.env.RALPHBLASTER_API_TOKEN;

      expect(() => {
        require('../src/config');
      }).toThrow('RALPHBLASTER_API_TOKEN (or RALPH_API_TOKEN) environment variable is required');
    });

    test('throws error when API token is empty string', () => {
      process.env.RALPH_API_TOKEN = '';

      expect(() => {
        require('../src/config');
      }).toThrow('RALPHBLASTER_API_TOKEN (or RALPH_API_TOKEN) environment variable is required');
    });

    test('accepts valid RALPH_API_TOKEN (backward compatibility)', () => {
      process.env.RALPH_API_TOKEN = 'valid-token-123';

      const config = require('../src/config');

      expect(config.apiToken).toBe('valid-token-123');
    });

    test('accepts valid RALPHBLASTER_API_TOKEN', () => {
      process.env.RALPHBLASTER_API_TOKEN = 'valid-token-456';

      const config = require('../src/config');

      expect(config.apiToken).toBe('valid-token-456');
    });

    test('prefers RALPHBLASTER_API_TOKEN over RALPH_API_TOKEN', () => {
      process.env.RALPH_API_TOKEN = 'old-token';
      process.env.RALPHBLASTER_API_TOKEN = 'new-token';

      const config = require('../src/config');

      expect(config.apiToken).toBe('new-token');
    });
  });

  describe('Environment variable parsing', () => {
    test('parses RALPH_MAX_RETRIES as integer', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      delete process.env.RALPHBLASTER_MAX_RETRIES; // Clear new variable to test old one
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

      expect(config.apiUrl).toBe('https://hq.ralphblaster.com');
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
      delete process.env.RALPHBLASTER_MAX_RETRIES; // Clear new variable to test old one
      process.env.RALPH_MAX_RETRIES = '10';

      const config = require('../src/config');

      expect(config.maxRetries).toBe(10);
    });

    test('uses custom log level when set', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      delete process.env.RALPHBLASTER_LOG_LEVEL; // Clear new variable to test old one
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

      // Invalid values now default to 3
      expect(config.maxRetries).toBe(3);
    });

    test('handles negative max retries', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_MAX_RETRIES = '-5';

      const config = require('../src/config');

      // Negative values now default to 3
      expect(config.maxRetries).toBe(3);
    });

    test('handles zero max retries', () => {
      process.env.RALPH_API_TOKEN = 'test-token';
      process.env.RALPH_MAX_RETRIES = '0';

      const config = require('../src/config');

      // Zero now defaults to 3 (must be positive)
      expect(config.maxRetries).toBe(3);
    });
  });
});
