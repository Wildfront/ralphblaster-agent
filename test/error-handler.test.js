jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const { categorizeError } = require('../src/executor/error-handler');

describe('Error Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('categorizeError()', () => {
    test('categorizes ENOENT as claude_not_installed', () => {
      const error = new Error('Command not found');
      error.code = 'ENOENT';

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('claude_not_installed');
      expect(result.userMessage).toBe('Claude Code CLI is not installed or not found in PATH');
    });

    test('categorizes authentication failures', () => {
      const error = new Error('Auth failed');
      const stderr = 'Error: not authenticated. Please log in.';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('not_authenticated');
      expect(result.userMessage).toBe('Claude CLI is not authenticated. Please run "/login" in Claude Code to authenticate');
    });

    test('categorizes authentication failed message', () => {
      const error = new Error('Auth error');
      const stderr = 'authentication failed - invalid credentials';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('not_authenticated');
    });

    test('categorizes please log in message', () => {
      const error = new Error('Auth error');
      const stderr = 'Please log in to continue';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('not_authenticated');
    });

    test('categorizes authentication error in stdout', () => {
      const error = new Error('Auth error');
      const stderr = '';
      const stdout = 'Not logged in · Please run /login';

      const result = categorizeError(error, stderr, 1, stdout);

      expect(result.category).toBe('not_authenticated');
    });

    test('categorizes "not logged in" message in stdout', () => {
      const error = new Error('Auth error');
      const stderr = '';
      const stdout = 'Not logged in\nPlease authenticate';

      const result = categorizeError(error, stderr, 1, stdout);

      expect(result.category).toBe('not_authenticated');
    });

    test('categorizes token limit exceeded', () => {
      const error = new Error('Token error');
      const stderr = 'Error: token limit exceeded';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('out_of_tokens');
      expect(result.userMessage).toBe('Claude API token limit has been exceeded');
    });

    test('categorizes quota exceeded', () => {
      const error = new Error('Quota error');
      const stderr = 'quota exceeded for this account';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('out_of_tokens');
    });

    test('categorizes insufficient credits', () => {
      const error = new Error('Credits error');
      const stderr = 'insufficient credits remaining';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('out_of_tokens');
    });

    test('categorizes rate limiting with rate limit message', () => {
      const error = new Error('Rate error');
      const stderr = 'rate limit exceeded - please slow down';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('rate_limited');
      expect(result.userMessage).toBe('Claude API rate limit reached. Please wait before retrying');
    });

    test('categorizes rate limiting with too many requests', () => {
      const error = new Error('Rate error');
      const stderr = 'too many requests';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('rate_limited');
    });

    test('categorizes rate limiting with 429 status', () => {
      const error = new Error('HTTP error');
      const stderr = 'HTTP 429 - rate limit';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('rate_limited');
    });

    test('categorizes permission denied from stderr', () => {
      const error = new Error('Permission error');
      const stderr = 'permission denied accessing file';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('permission_denied');
      expect(result.userMessage).toBe('Permission denied accessing project files or directories');
    });

    test('categorizes EACCES from stderr', () => {
      const error = new Error('Access error');
      const stderr = 'EACCES: permission denied';

      const result = categorizeError(error, stderr, 1);

      expect(result.category).toBe('permission_denied');
    });

    test('categorizes EACCES error code', () => {
      const error = new Error('Access error');
      error.code = 'EACCES';

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('permission_denied');
    });

    test('categorizes execution timeout', () => {
      const error = new Error('Execution timed out after 3600000ms');

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('execution_timeout');
      expect(result.userMessage).toBe('Job execution exceeded the maximum timeout');
    });

    test('categorizes ECONNREFUSED network error', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('network_error');
      expect(result.userMessage).toBe('Network error connecting to Claude API');
    });

    test('categorizes ENOTFOUND network error', () => {
      const error = new Error('Host not found');
      error.code = 'ENOTFOUND';

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('network_error');
    });

    test('categorizes ETIMEDOUT network error', () => {
      const error = new Error('Request timeout');
      error.code = 'ETIMEDOUT';

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('network_error');
    });

    test('categorizes non-zero exit code as execution_error', () => {
      const error = new Error('Process failed');
      const stderr = 'Some error output';

      const result = categorizeError(error, stderr, 127);

      expect(result.category).toBe('execution_error');
      expect(result.userMessage).toBe('Claude CLI execution failed with exit code 127');
    });

    test('categorizes exit code 1 as execution_error', () => {
      const error = new Error('Process failed');
      const stderr = '';

      const result = categorizeError(error, stderr, 1);

      // Should check auth first, but with no auth message, fall to execution_error
      expect(result.category).toBe('execution_error');
      expect(result.userMessage).toBe('Claude CLI execution failed with exit code 1');
    });

    test('categorizes unknown errors', () => {
      const error = new Error('Some unknown error');

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('unknown');
      expect(result.userMessage).toBe('Some unknown error');
    });

    test('includes technical details in all errors', () => {
      const error = new Error('Test error');
      const stderr = 'stderr output';
      const exitCode = 42;

      const result = categorizeError(error, stderr, exitCode);

      expect(result.technicalDetails).toContain('Test error');
      expect(result.technicalDetails).toContain('stderr output');
      expect(result.technicalDetails).toContain('42');
    });

    test('handles error without message', () => {
      const error = new Error();
      error.message = '';

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('unknown');
      expect(result.userMessage).toBeTruthy();
    });

    test('handles error that is a string', () => {
      const error = 'String error';

      const result = categorizeError(error, '', null);

      expect(result.category).toBe('unknown');
      expect(result.userMessage).toBe('String error');
    });

    test('logs debug message with category', () => {
      const logger = require('../src/logger');
      const error = new Error('Test');
      error.code = 'ENOENT';

      categorizeError(error, '', null);

      expect(logger.debug).toHaveBeenCalledWith('Error categorized as: claude_not_installed');
    });

    test('prioritizes specific error patterns over generic exit codes', () => {
      const error = new Error('Auth failed');
      const stderr = 'not authenticated';

      const result = categorizeError(error, stderr, 1);

      // Should be auth error, not generic execution_error
      expect(result.category).toBe('not_authenticated');
      expect(result.category).not.toBe('execution_error');
    });
  });
});
