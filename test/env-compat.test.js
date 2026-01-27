/**
 * Tests for environment variable backward compatibility helper
 */

const { getEnv, getEnvBoolean, getEnvInt, getDeprecatedVarsInUse, clearDeprecationWarnings } = require('../src/utils/env-compat');

describe('Environment Variable Backward Compatibility', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear all RALPH* and RALPHBLASTER* variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('RALPH_') || key.startsWith('RALPHBLASTER_')) {
        delete process.env[key];
      }
    });

    // Clear deprecation warnings tracking
    clearDeprecationWarnings();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getEnv', () => {
    it('should prefer RALPHBLASTER_* over RALPH_*', () => {
      process.env.RALPHBLASTER_API_TOKEN = 'new-token';
      process.env.RALPH_API_TOKEN = 'old-token';

      const result = getEnv('API_TOKEN');

      expect(result).toBe('new-token');
    });

    it('should fall back to RALPH_* when RALPHBLASTER_* is not set', () => {
      process.env.RALPH_API_TOKEN = 'old-token';

      const result = getEnv('API_TOKEN');

      expect(result).toBe('old-token');
    });

    it('should return default value when neither is set', () => {
      const result = getEnv('API_TOKEN', 'default-token');

      expect(result).toBe('default-token');
    });

    it('should return undefined when neither is set and no default', () => {
      const result = getEnv('API_TOKEN');

      expect(result).toBeUndefined();
    });

    it('should emit deprecation warning when using RALPH_*', () => {
      // Mock console.warn before calling getEnv
      const originalWarn = console.warn;
      const warnings = [];
      console.warn = jest.fn((...args) => warnings.push(args.join(' ')));

      process.env.RALPH_API_TOKEN = 'old-token';
      getEnv('API_TOKEN');

      expect(warnings.some(w => w.includes('RALPH_API_TOKEN is deprecated'))).toBe(true);

      console.warn = originalWarn;
    });

    it('should not emit warning when using RALPHBLASTER_*', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      process.env.RALPHBLASTER_API_TOKEN = 'new-token';
      getEnv('API_TOKEN');

      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should only emit deprecation warning once per variable', () => {
      const originalWarn = console.warn;
      const warnings = [];
      console.warn = jest.fn((...args) => warnings.push(args.join(' ')));

      process.env.RALPH_API_TOKEN = 'old-token';
      getEnv('API_TOKEN');
      getEnv('API_TOKEN');
      getEnv('API_TOKEN');

      // Should only warn once despite 3 calls (2 warning lines per deprecation)
      expect(warnings.length).toBe(2);

      console.warn = originalWarn;
    });
  });

  describe('getEnvBoolean', () => {
    it('should parse "true" as true', () => {
      process.env.RALPHBLASTER_CONSOLE_COLORS = 'true';
      expect(getEnvBoolean('CONSOLE_COLORS', false)).toBe(true);
    });

    it('should parse "false" as false', () => {
      process.env.RALPHBLASTER_CONSOLE_COLORS = 'false';
      expect(getEnvBoolean('CONSOLE_COLORS', true)).toBe(false);
    });

    it('should parse "0" as false', () => {
      process.env.RALPHBLASTER_CONSOLE_COLORS = '0';
      expect(getEnvBoolean('CONSOLE_COLORS', true)).toBe(false);
    });

    it('should parse empty string as false', () => {
      process.env.RALPHBLASTER_CONSOLE_COLORS = '';
      expect(getEnvBoolean('CONSOLE_COLORS', true)).toBe(false);
    });

    it('should parse "1" as true', () => {
      process.env.RALPHBLASTER_CONSOLE_COLORS = '1';
      expect(getEnvBoolean('CONSOLE_COLORS', false)).toBe(true);
    });

    it('should return default when not set', () => {
      expect(getEnvBoolean('CONSOLE_COLORS', true)).toBe(true);
      expect(getEnvBoolean('CONSOLE_COLORS', false)).toBe(false);
    });

    it('should work with RALPH_* fallback', () => {
      process.env.RALPH_CONSOLE_COLORS = 'false';
      expect(getEnvBoolean('CONSOLE_COLORS', true)).toBe(false);
    });
  });

  describe('getEnvInt', () => {
    it('should parse valid integer', () => {
      process.env.RALPHBLASTER_MAX_RETRIES = '5';
      expect(getEnvInt('MAX_RETRIES', 3)).toBe(5);
    });

    it('should return default for invalid integer', () => {
      process.env.RALPHBLASTER_MAX_RETRIES = 'invalid';
      expect(getEnvInt('MAX_RETRIES', 3)).toBe(3);
    });

    it('should return default for negative integer', () => {
      process.env.RALPHBLASTER_MAX_RETRIES = '-5';
      expect(getEnvInt('MAX_RETRIES', 3)).toBe(3);
    });

    it('should return default for zero', () => {
      process.env.RALPHBLASTER_MAX_RETRIES = '0';
      expect(getEnvInt('MAX_RETRIES', 3)).toBe(3);
    });

    it('should return default when not set', () => {
      expect(getEnvInt('MAX_RETRIES', 3)).toBe(3);
    });

    it('should work with RALPH_* fallback', () => {
      process.env.RALPH_MAX_RETRIES = '7';
      expect(getEnvInt('MAX_RETRIES', 3)).toBe(7);
    });

    it('should emit warning for invalid values', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      process.env.RALPHBLASTER_MAX_RETRIES = 'invalid';
      getEnvInt('MAX_RETRIES', 3);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid numeric value')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('getDeprecatedVarsInUse', () => {
    it('should return empty array when no deprecated vars are used', () => {
      process.env.RALPHBLASTER_API_TOKEN = 'token';
      process.env.RALPHBLASTER_API_URL = 'url';

      const deprecated = getDeprecatedVarsInUse();

      expect(deprecated).toEqual([]);
    });

    it('should detect RALPH_* vars when RALPHBLASTER_* is not set', () => {
      process.env.RALPH_API_TOKEN = 'token';
      process.env.RALPH_API_URL = 'url';

      const deprecated = getDeprecatedVarsInUse();

      expect(deprecated).toContain('RALPH_API_TOKEN');
      expect(deprecated).toContain('RALPH_API_URL');
    });

    it('should not report RALPH_* vars when RALPHBLASTER_* is also set', () => {
      process.env.RALPH_API_TOKEN = 'old-token';
      process.env.RALPHBLASTER_API_TOKEN = 'new-token';

      const deprecated = getDeprecatedVarsInUse();

      expect(deprecated).not.toContain('RALPH_API_TOKEN');
    });

    it('should detect multiple deprecated vars', () => {
      process.env.RALPH_API_TOKEN = 'token';
      process.env.RALPH_LOG_LEVEL = 'debug';
      process.env.RALPH_MAX_RETRIES = '5';

      const deprecated = getDeprecatedVarsInUse();

      expect(deprecated.length).toBeGreaterThanOrEqual(3);
      expect(deprecated).toContain('RALPH_API_TOKEN');
      expect(deprecated).toContain('RALPH_LOG_LEVEL');
      expect(deprecated).toContain('RALPH_MAX_RETRIES');
    });
  });
});
