/**
 * Tests for log formatter module
 * Tests all formatting functions including redaction, truncation, and display formatting
 */

const {
  formatMessage,
  formatLevel,
  formatMetadata,
  redactSensitiveData,
  truncateString,
  formatConsoleData,
  COLORS,
  LEVEL_COLORS
} = require('../src/logging/formatter');

describe('truncateString', () => {
  test('returns string unchanged if shorter than maxLength', () => {
    expect(truncateString('short', 100)).toBe('short');
  });

  test('returns string unchanged if equal to maxLength', () => {
    const str = 'a'.repeat(100);
    expect(truncateString(str, 100)).toBe(str);
  });

  test('truncates long strings with ellipsis', () => {
    const longString = 'a'.repeat(200);
    const result = truncateString(longString, 100);

    expect(result.length).toBe(100);
    expect(result.endsWith('...')).toBe(true);
    expect(result.startsWith('aaa')).toBe(true);
  });

  test('uses default maxLength of 100', () => {
    const longString = 'a'.repeat(200);
    const result = truncateString(longString);

    expect(result.length).toBe(100);
    expect(result.endsWith('...')).toBe(true);
  });

  test('handles custom maxLength', () => {
    const result = truncateString('this is a test string', 10);

    expect(result).toBe('this is...');
    expect(result.length).toBe(10);
  });

  test('returns non-string values unchanged', () => {
    expect(truncateString(null, 10)).toBe(null);
    expect(truncateString(undefined, 10)).toBe(undefined);
    expect(truncateString(123, 10)).toBe(123);
    expect(truncateString({}, 10)).toEqual({});
  });

  test('handles empty string', () => {
    expect(truncateString('', 10)).toBe('');
  });
});

describe('redactSensitiveData', () => {
  test('redacts Authorization Bearer tokens in strings', () => {
    const input = 'Authorization: Bearer sk-1234567890';
    const result = redactSensitiveData(input);

    expect(result).toBe('Authorization: Bearer [REDACTED]');
  });

  test('redacts JSON Authorization headers', () => {
    const input = '{"Authorization": "Bearer sk-secret123"}';
    const result = redactSensitiveData(input);

    expect(result).toContain('"Authorization": "Bearer [REDACTED]"');
  });

  test('redacts apiToken in JSON', () => {
    const input = { apiToken: 'secret-key-123' };
    const result = redactSensitiveData(input);

    expect(result.apiToken).toBe('[REDACTED]');
  });

  test('redacts token field in objects', () => {
    const input = { token: 'my-secret-token' };
    const result = redactSensitiveData(input);

    expect(result.token).toBe('[REDACTED]');
  });

  test('redacts api_token field in objects', () => {
    const input = { api_token: 'secret' };
    const result = redactSensitiveData(input);

    expect(result.api_token).toBe('[REDACTED]');
  });

  test('redacts RALPH_API_TOKEN environment variable', () => {
    const input = 'RALPH_API_TOKEN=sk-12345&other=value';
    const result = redactSensitiveData(input);

    expect(result).toBe('RALPH_API_TOKEN=[REDACTED]&other=value');
  });

  test('redacts multiple tokens in same string', () => {
    const input = '{"token": "secret1", "apiToken": "secret2"}';
    const result = redactSensitiveData(input);

    expect(result).toContain('[REDACTED]');
  });

  test('preserves non-sensitive data', () => {
    const input = { userId: '123', email: 'user@example.com', name: 'John' };
    const result = redactSensitiveData(input);

    expect(result.userId).toBe('123');
    expect(result.email).toBe('user@example.com');
    expect(result.name).toBe('John');
  });

  test('handles null and undefined', () => {
    expect(redactSensitiveData(null)).toBe(null);
    expect(redactSensitiveData(undefined)).toBe(undefined);
  });

  test('handles empty string', () => {
    expect(redactSensitiveData('')).toBe('');
  });

  test('handles empty object', () => {
    const result = redactSensitiveData({});
    expect(result).toEqual({});
  });

  test('returns error placeholder on stringification failure', () => {
    // Create circular reference
    const circular = { a: 1 };
    circular.self = circular;

    // Mock JSON.stringify to throw
    const originalStringify = JSON.stringify;
    JSON.stringify = jest.fn(() => { throw new Error('Circular'); });

    const result = redactSensitiveData(circular);
    expect(result).toBe('[REDACTION_ERROR]');

    JSON.stringify = originalStringify;
  });
});

describe('formatMetadata', () => {
  test('formats simple object with indentation', () => {
    const obj = { name: 'test', value: 123 };
    const result = formatMetadata(obj);

    expect(result).toContain('"name": "test"');
    expect(result).toContain('"value": 123');
    expect(result).toContain('\n');
  });

  test('formats nested objects', () => {
    const obj = { outer: { inner: 'value' } };
    const result = formatMetadata(obj);

    expect(result).toContain('"outer"');
    expect(result).toContain('"inner"');
    expect(result).toContain('"value"');
  });

  test('supports custom indentation', () => {
    const obj = { key: 'value' };
    const result = formatMetadata(obj, { indent: 4 });

    // Should have 4-space indentation
    expect(result).toContain('    ');
  });

  test('supports compact format (no indentation)', () => {
    const obj = { key: 'value' };
    const result = formatMetadata(obj, { indent: 0 });

    expect(result).toBe('{"key":"value"}');
    expect(result).not.toContain('\n');
  });

  test('handles circular references', () => {
    const obj = { name: 'test' };
    obj.self = obj;

    const result = formatMetadata(obj);

    expect(result).toContain('"name": "test"');
    expect(result).toContain('[Circular]');
  });

  test('handles arrays', () => {
    const obj = { items: [1, 2, 3] };
    const result = formatMetadata(obj);

    expect(result).toContain('"items"');
    expect(result).toContain('[');
    expect(result).toContain('1');
  });

  test('handles null and undefined values', () => {
    const obj = { nullVal: null, undefinedVal: undefined };
    const result = formatMetadata(obj);

    expect(result).toContain('null');
  });

  test('returns error message on stringify failure', () => {
    // Create an object with a getter that throws
    const obj = {};
    Object.defineProperty(obj, 'bad', {
      enumerable: true,
      get() { throw new Error('Cannot access'); }
    });

    const result = formatMetadata(obj);

    // The error handling in formatMetadata catches stringify errors
    expect(result).toContain('[Unable to stringify:');
  });
});

describe('formatLevel', () => {
  test('formats level as uppercase by default', () => {
    expect(formatLevel('info')).toBe('INFO');
    expect(formatLevel('error')).toBe('ERROR');
    expect(formatLevel('warn')).toBe('WARN');
    expect(formatLevel('debug')).toBe('DEBUG');
  });

  test('respects uppercase: false option', () => {
    expect(formatLevel('info', { uppercase: false })).toBe('info');
    expect(formatLevel('error', { uppercase: false })).toBe('error');
  });

  test('applies colors when enabled', () => {
    const result = formatLevel('error', { colors: true });

    expect(result).toContain(COLORS.red);
    expect(result).toContain(COLORS.reset);
    expect(result).toContain('ERROR');
  });

  test('does not apply colors when disabled', () => {
    const result = formatLevel('error', { colors: false });

    expect(result).toBe('ERROR');
    expect(result).not.toContain(COLORS.red);
    expect(result).not.toContain(COLORS.reset);
  });

  test('applies correct color for each level', () => {
    expect(formatLevel('error', { colors: true })).toContain(COLORS.red);
    expect(formatLevel('warn', { colors: true })).toContain(COLORS.yellow);
    expect(formatLevel('info', { colors: true })).toContain(COLORS.cyan);
    expect(formatLevel('debug', { colors: true })).toContain(COLORS.gray);
  });

  test('handles unknown level without color', () => {
    const result = formatLevel('unknown', { colors: true });

    // Unknown level still gets reset code appended, just no color prefix
    expect(result).toContain('UNKNOWN');
    expect(result).toContain(COLORS.reset);
  });

  test('combines uppercase and colors options', () => {
    const result = formatLevel('warn', { colors: true, uppercase: false });

    expect(result).toContain(COLORS.yellow);
    expect(result).toContain('warn');
    expect(result).not.toContain('WARN');
  });
});

describe('formatMessage', () => {
  test('returns message unchanged when no data provided', () => {
    expect(formatMessage('test message')).toBe('test message');
    expect(formatMessage('test message', null)).toBe('test message');
  });

  test('appends component in brackets', () => {
    const result = formatMessage('Started', { component: 'worktree' });

    expect(result).toContain('[worktree]');
  });

  test('appends duration in human-readable format', () => {
    const result = formatMessage('Completed', { duration: 3200 });

    expect(result).toContain('(3.2s)');
  });

  test('appends durationMs in human-readable format', () => {
    const result = formatMessage('Completed', { durationMs: 1500 });

    expect(result).toContain('(1.5s)');
  });

  test('combines component and duration', () => {
    const result = formatMessage('Completed', {
      component: 'worktree',
      duration: 2000
    });

    expect(result).toContain('[worktree]');
    // formatDuration formats 2000ms as "2.0s" not "2s"
    expect(result).toContain('(2.0s)');
  });

  test('appends additional fields', () => {
    const result = formatMessage('Created', {
      path: '/tmp/test',
      status: 'success'
    });

    expect(result).toContain('path: /tmp/test');
    expect(result).toContain('status: success');
  });

  test('truncates long field values', () => {
    const longValue = 'a'.repeat(100);
    const result = formatMessage('Test', {
      field: longValue
    }, { maxFieldLength: 20 });

    expect(result).toContain('field:');
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(longValue.length + 50);
  });

  test('respects includeMetadata: false option', () => {
    const result = formatMessage('Test', {
      component: 'worktree',
      duration: 1000
    }, { includeMetadata: false });

    // Should not include component or duration when includeMetadata is false
    expect(result).toBe('Test');
  });

  test('handles non-object data gracefully', () => {
    expect(formatMessage('Test', 'string')).toBe('Test');
    expect(formatMessage('Test', 123)).toBe('Test');
    expect(formatMessage('Test', true)).toBe('Test');
  });

  test('skips null and undefined values', () => {
    const result = formatMessage('Test', {
      valid: 'value',
      nullField: null,
      undefinedField: undefined
    });

    expect(result).toContain('valid: value');
    expect(result).not.toContain('null');
    expect(result).not.toContain('undefined');
  });
});

describe('formatConsoleData', () => {
  test('returns empty string for null data', () => {
    expect(formatConsoleData(null)).toBe('');
  });

  test('returns empty string for empty object', () => {
    expect(formatConsoleData({})).toBe('');
  });

  test('returns empty string for non-object data', () => {
    expect(formatConsoleData('string')).toBe('');
    expect(formatConsoleData(123)).toBe('');
  });

  test('formats simple key-value pairs with indentation', () => {
    const data = { userId: '123', email: 'test@example.com' };
    const result = formatConsoleData(data);

    expect(result).toContain('\n  userId: 123');
    expect(result).toContain('\n  email: test@example.com');
  });

  test('uses custom indentation', () => {
    const data = { key: 'value' };
    const result = formatConsoleData(data, { indent: '    ' });

    expect(result).toContain('\n    key: value');
  });

  test('skips component field (shown elsewhere)', () => {
    const data = { component: 'worktree', path: '/tmp' };
    const result = formatConsoleData(data);

    expect(result).not.toContain('component');
    expect(result).toContain('path: /tmp');
  });

  test('shows field count for objects with many keys', () => {
    const data = {};
    for (let i = 0; i < 25; i++) {
      data[`key${i}`] = `value${i}`;
    }

    const result = formatConsoleData(data, { maxKeys: 20 });

    expect(result).toContain('[25 fields]');
    expect(result).not.toContain('key0');
  });

  test('truncates long string values', () => {
    const longValue = 'a'.repeat(200);
    const data = { field: longValue };
    const result = formatConsoleData(data, { maxValueLength: 50 });

    expect(result).toContain('field:');
    expect(result).toContain('...');
  });

  test('formats nested objects as compact JSON', () => {
    const data = { nested: { inner: 'value', count: 123 } };
    const result = formatConsoleData(data);

    expect(result).toContain('nested:');
    expect(result).toContain('{"inner":"value","count":123}');
  });

  test('skips null and undefined values', () => {
    const data = {
      valid: 'value',
      nullField: null,
      undefinedField: undefined
    };
    const result = formatConsoleData(data);

    expect(result).toContain('valid: value');
    expect(result).not.toContain('null');
    expect(result).not.toContain('undefined');
  });

  test('handles arrays in data', () => {
    const data = { items: [1, 2, 3] };
    const result = formatConsoleData(data);

    expect(result).toContain('items: [1,2,3]');
  });
});

describe('COLORS constants', () => {
  test('exports ANSI color codes', () => {
    expect(COLORS.reset).toBe('\x1b[0m');
    expect(COLORS.red).toBe('\x1b[31m');
    expect(COLORS.yellow).toBe('\x1b[33m');
    expect(COLORS.cyan).toBe('\x1b[36m');
    expect(COLORS.gray).toBe('\x1b[90m');
  });

  test('exports LEVEL_COLORS mapping', () => {
    expect(LEVEL_COLORS.error).toBe(COLORS.red);
    expect(LEVEL_COLORS.warn).toBe(COLORS.yellow);
    expect(LEVEL_COLORS.info).toBe(COLORS.cyan);
    expect(LEVEL_COLORS.debug).toBe(COLORS.gray);
  });
});
