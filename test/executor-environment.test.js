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

describe('Executor - Environment & Security', () => {
  let executor;
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new Executor();
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getSanitizedEnv()', () => {
    test('returns only allowed environment variables', () => {
      process.env = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        USER: 'testuser',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        TMPDIR: '/tmp',
        SHELL: '/bin/bash',
        // These should NOT be included
        AWS_ACCESS_KEY_ID: 'secret',
        AWS_SECRET_ACCESS_KEY: 'verysecret',
        DATABASE_URL: 'postgres://...',
        API_TOKEN: 'token123'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).toHaveProperty('PATH');
      expect(sanitized).toHaveProperty('HOME');
      expect(sanitized).toHaveProperty('USER');
      expect(sanitized).toHaveProperty('LANG');
      expect(sanitized).toHaveProperty('LC_ALL');
      expect(sanitized).toHaveProperty('TERM');
      expect(sanitized).toHaveProperty('TMPDIR');
      expect(sanitized).toHaveProperty('SHELL');

      // Should NOT include sensitive variables
      expect(sanitized).not.toHaveProperty('AWS_ACCESS_KEY_ID');
      expect(sanitized).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
      expect(sanitized).not.toHaveProperty('DATABASE_URL');
      expect(sanitized).not.toHaveProperty('API_TOKEN');
    });

    test('handles missing environment variables gracefully', () => {
      process.env = {
        PATH: '/usr/bin',
        // All others missing
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).toHaveProperty('PATH');
      expect(sanitized).not.toHaveProperty('HOME');
      expect(sanitized).not.toHaveProperty('USER');
      expect(Object.keys(sanitized).length).toBe(1);
    });

    test('does not leak sensitive variables', () => {
      process.env = {
        PATH: '/usr/bin',
        SSH_PRIVATE_KEY: 'sensitive',
        GITHUB_TOKEN: 'ghp_token',
        NPM_TOKEN: 'npm_token',
        POSTGRES_PASSWORD: 'password',
        REDIS_URL: 'redis://...',
        SECRET_KEY_BASE: 'secret'
      };

      const sanitized = executor.getSanitizedEnv();

      const sensitiveKeys = [
        'SSH_PRIVATE_KEY',
        'GITHUB_TOKEN',
        'NPM_TOKEN',
        'POSTGRES_PASSWORD',
        'REDIS_URL',
        'SECRET_KEY_BASE'
      ];

      for (const key of sensitiveKeys) {
        expect(sanitized).not.toHaveProperty(key);
      }
    });

    test('logs sanitized environment keys', () => {
      const logger = require('../src/logger');
      process.env = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        USER: 'testuser'
      };

      executor.getSanitizedEnv();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Sanitized environment:')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('PATH')
      );
    });

    test('returns empty object when no allowed variables present', () => {
      process.env = {
        SOME_OTHER_VAR: 'value',
        ANOTHER_VAR: 'value2'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(Object.keys(sanitized).length).toBe(0);
    });

    test('preserves exact values of allowed variables', () => {
      const expectedPath = '/usr/local/bin:/usr/bin:/bin';
      const expectedHome = '/Users/testuser';
      process.env = {
        PATH: expectedPath,
        HOME: expectedHome
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized.PATH).toBe(expectedPath);
      expect(sanitized.HOME).toBe(expectedHome);
    });

    test('includes all allowed variables when present', () => {
      process.env = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        USER: 'testuser',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        TMPDIR: '/tmp',
        SHELL: '/bin/bash'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(Object.keys(sanitized)).toEqual([
        'PATH',
        'HOME',
        'USER',
        'LANG',
        'LC_ALL',
        'TERM',
        'TMPDIR',
        'SHELL'
      ]);
    });

    test('handles undefined environment variable values', () => {
      process.env = {
        PATH: '/usr/bin',
        HOME: undefined,
        USER: null
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).toHaveProperty('PATH');
      expect(sanitized).not.toHaveProperty('HOME');
      expect(sanitized).not.toHaveProperty('USER');
    });

    test('does not modify original process.env', () => {
      const original = { ...process.env };
      process.env = {
        PATH: '/usr/bin',
        SECRET: 'secret'
      };

      executor.getSanitizedEnv();

      expect(process.env.SECRET).toBe('secret');
    });
  });
});
