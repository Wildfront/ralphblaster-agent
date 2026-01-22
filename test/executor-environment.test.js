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
        SHELL: '/bin/bash',
        NODE_ENV: 'production'
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
        'SHELL',
        'NODE_ENV'
      ]);
    });

    test('includes NODE_ENV for Claude', () => {
      process.env = {
        PATH: '/usr/bin',
        NODE_ENV: 'development'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).toHaveProperty('NODE_ENV', 'development');
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

    test('explicitly blocks RALPH_API_TOKEN even if it somehow matches allowed pattern', () => {
      process.env = {
        PATH: '/usr/bin',
        RALPH_API_TOKEN: 'secret-token-123'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('RALPH_API_TOKEN');
      expect(sanitized).toHaveProperty('PATH');
    });

    test('blocks all *_TOKEN patterns', () => {
      process.env = {
        PATH: '/usr/bin',
        GITHUB_TOKEN: 'ghp_token',
        NPM_TOKEN: 'npm_token',
        API_TOKEN: 'api_token',
        AUTH_TOKEN: 'auth_token',
        ACCESS_TOKEN: 'access_token'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('GITHUB_TOKEN');
      expect(sanitized).not.toHaveProperty('NPM_TOKEN');
      expect(sanitized).not.toHaveProperty('API_TOKEN');
      expect(sanitized).not.toHaveProperty('AUTH_TOKEN');
      expect(sanitized).not.toHaveProperty('ACCESS_TOKEN');
      expect(sanitized).toHaveProperty('PATH');
    });

    test('blocks all *_SECRET patterns', () => {
      process.env = {
        PATH: '/usr/bin',
        CLIENT_SECRET: 'secret1',
        API_SECRET: 'secret2',
        APP_SECRET: 'secret3'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('CLIENT_SECRET');
      expect(sanitized).not.toHaveProperty('API_SECRET');
      expect(sanitized).not.toHaveProperty('APP_SECRET');
    });

    test('blocks all *_KEY patterns', () => {
      process.env = {
        PATH: '/usr/bin',
        API_KEY: 'key1',
        SECRET_KEY: 'key2',
        ENCRYPTION_KEY: 'key3'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('API_KEY');
      expect(sanitized).not.toHaveProperty('SECRET_KEY');
      expect(sanitized).not.toHaveProperty('ENCRYPTION_KEY');
    });

    test('blocks all *_PASSWORD patterns', () => {
      process.env = {
        PATH: '/usr/bin',
        DB_PASSWORD: 'pass1',
        MYSQL_PASSWORD: 'pass2',
        POSTGRES_PASSWORD: 'pass3'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('DB_PASSWORD');
      expect(sanitized).not.toHaveProperty('MYSQL_PASSWORD');
      expect(sanitized).not.toHaveProperty('POSTGRES_PASSWORD');
    });

    test('blocks AWS_* cloud provider credentials', () => {
      process.env = {
        PATH: '/usr/bin',
        AWS_ACCESS_KEY_ID: 'aws_key',
        AWS_SECRET_ACCESS_KEY: 'aws_secret',
        AWS_SESSION_TOKEN: 'aws_token'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('AWS_ACCESS_KEY_ID');
      expect(sanitized).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
      expect(sanitized).not.toHaveProperty('AWS_SESSION_TOKEN');
    });

    test('blocks AZURE_* cloud provider credentials', () => {
      process.env = {
        PATH: '/usr/bin',
        AZURE_CLIENT_ID: 'azure_id',
        AZURE_CLIENT_SECRET: 'azure_secret',
        AZURE_TENANT_ID: 'azure_tenant'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('AZURE_CLIENT_ID');
      expect(sanitized).not.toHaveProperty('AZURE_CLIENT_SECRET');
      expect(sanitized).not.toHaveProperty('AZURE_TENANT_ID');
    });

    test('blocks GCP_* and GOOGLE_* cloud provider credentials', () => {
      process.env = {
        PATH: '/usr/bin',
        GCP_PROJECT_ID: 'gcp_project',
        GCP_SERVICE_ACCOUNT: 'gcp_account',
        GOOGLE_APPLICATION_CREDENTIALS: 'google_creds'
      };

      const sanitized = executor.getSanitizedEnv();

      expect(sanitized).not.toHaveProperty('GCP_PROJECT_ID');
      expect(sanitized).not.toHaveProperty('GCP_SERVICE_ACCOUNT');
      expect(sanitized).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS');
    });

    test('does not log HOME to avoid exposing username', () => {
      const logger = require('../src/logger');
      process.env = {
        PATH: '/usr/bin',
        HOME: '/Users/sensitive-username',
        USER: 'testuser'
      };

      executor.getSanitizedEnv();

      const logCalls = logger.debug.mock.calls;
      const sanitizedEnvLog = logCalls.find(call =>
        call[0] && call[0].includes('Sanitized environment:')
      );

      expect(sanitizedEnvLog).toBeDefined();
      // Should NOT contain HOME in the logged keys
      expect(sanitizedEnvLog[0]).not.toContain('HOME');
      // Should contain other keys
      expect(sanitizedEnvLog[0]).toContain('PATH');
      expect(sanitizedEnvLog[0]).toContain('USER');
    });

    test('comprehensive security test - blocks all sensitive patterns', () => {
      process.env = {
        // Allowed
        PATH: '/usr/bin',
        HOME: '/home/user',
        USER: 'testuser',
        NODE_ENV: 'production',

        // Blocked - various patterns
        RALPH_API_TOKEN: 'blocked',
        GITHUB_TOKEN: 'blocked',
        API_SECRET: 'blocked',
        ENCRYPTION_KEY: 'blocked',
        DB_PASSWORD: 'blocked',
        AWS_ACCESS_KEY_ID: 'blocked',
        AZURE_CLIENT_SECRET: 'blocked',
        GOOGLE_APPLICATION_CREDENTIALS: 'blocked',
        CUSTOM_TOKEN: 'blocked',
        MY_SECRET: 'blocked',
        APP_KEY: 'blocked'
      };

      const sanitized = executor.getSanitizedEnv();

      // Only allowed vars should be present
      const allowedKeys = Object.keys(sanitized);
      expect(allowedKeys).toEqual(
        expect.arrayContaining(['PATH', 'HOME', 'USER', 'NODE_ENV'])
      );
      expect(allowedKeys.length).toBe(4);

      // All sensitive vars should be blocked
      expect(sanitized).not.toHaveProperty('RALPH_API_TOKEN');
      expect(sanitized).not.toHaveProperty('GITHUB_TOKEN');
      expect(sanitized).not.toHaveProperty('API_SECRET');
      expect(sanitized).not.toHaveProperty('ENCRYPTION_KEY');
      expect(sanitized).not.toHaveProperty('DB_PASSWORD');
      expect(sanitized).not.toHaveProperty('AWS_ACCESS_KEY_ID');
      expect(sanitized).not.toHaveProperty('AZURE_CLIENT_SECRET');
      expect(sanitized).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS');
    });
  });
});
