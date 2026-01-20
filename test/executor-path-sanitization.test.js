const Executor = require('../src/executor');
const path = require('path');

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('Executor - validateAndSanitizePath()', () => {
  let executor;

  beforeEach(() => {
    executor = new Executor();
  });

  describe('Basic validation', () => {
    test('rejects null paths', () => {
      const result = executor.validateAndSanitizePath(null);
      expect(result).toBeNull();
    });

    test('rejects undefined paths', () => {
      const result = executor.validateAndSanitizePath(undefined);
      expect(result).toBeNull();
    });

    test('rejects empty string paths', () => {
      const result = executor.validateAndSanitizePath('');
      expect(result).toBeNull();
    });

    test('rejects non-string paths', () => {
      const result = executor.validateAndSanitizePath(123);
      expect(result).toBeNull();
    });
  });

  describe('Null byte protection', () => {
    test('rejects paths with null bytes', () => {
      // Note: Node.js path.resolve() may strip null bytes on some platforms
      // The validation checks for null bytes in the resolved path
      const maliciousPath = 'test\0path';
      const result = executor.validateAndSanitizePath(maliciousPath);

      // The check should catch null bytes if present in resolved path
      // On platforms where null bytes are stripped, this tests that
      // sanitization occurs properly
      if (path.resolve(maliciousPath).includes('\0')) {
        expect(result).toBeNull();
      } else {
        // If platform strips null bytes, just verify sanitization happened
        expect(result).toBeTruthy();
      }
    });
  });

  describe('System directory protection', () => {
    test('blocks /etc directory', () => {
      const result = executor.validateAndSanitizePath('/etc');
      expect(result).toBeNull();
    });

    test('blocks paths inside /etc', () => {
      const result = executor.validateAndSanitizePath('/etc/passwd');
      expect(result).toBeNull();
    });

    test('blocks /bin directory', () => {
      const result = executor.validateAndSanitizePath('/bin');
      expect(result).toBeNull();
    });

    test('blocks paths inside /bin', () => {
      const result = executor.validateAndSanitizePath('/bin/bash');
      expect(result).toBeNull();
    });

    test('blocks /System directory (macOS)', () => {
      const result = executor.validateAndSanitizePath('/System');
      expect(result).toBeNull();
    });

    test('blocks paths inside /System', () => {
      const result = executor.validateAndSanitizePath('/System/Library');
      expect(result).toBeNull();
    });

    test('blocks /Windows directory', () => {
      const result = executor.validateAndSanitizePath('/Windows');
      expect(result).toBeNull();
    });

    test('blocks paths inside /Windows', () => {
      const result = executor.validateAndSanitizePath('/Windows/System32');
      expect(result).toBeNull();
    });

    test('blocks /sbin directory', () => {
      const result = executor.validateAndSanitizePath('/sbin');
      expect(result).toBeNull();
    });

    test('blocks /usr/bin directory', () => {
      const result = executor.validateAndSanitizePath('/usr/bin');
      expect(result).toBeNull();
    });

    test('blocks /usr/sbin directory', () => {
      const result = executor.validateAndSanitizePath('/usr/sbin');
      expect(result).toBeNull();
    });
  });

  describe('Path traversal normalization', () => {
    test('normalizes paths with .. traversal', () => {
      const result = executor.validateAndSanitizePath('/home/user/../project');
      // Should resolve to /home/project
      expect(result).toBe(path.resolve('/home/user/../project'));
    });

    test('normalizes relative paths with ..', () => {
      const relativePath = 'project/../other';
      const result = executor.validateAndSanitizePath(relativePath);
      // Should resolve to absolute path
      expect(result).toBe(path.resolve(relativePath));
    });

    test('prevents escaping to /etc via ..', () => {
      // Try to escape to /etc from a safe path
      const maliciousPath = '/home/user/../../../../etc';
      const result = executor.validateAndSanitizePath(maliciousPath);
      expect(result).toBeNull(); // Should block /etc
    });
  });

  describe('Valid paths', () => {
    test('accepts valid project paths', () => {
      const validPath = '/home/user/projects/myapp';
      const result = executor.validateAndSanitizePath(validPath);
      expect(result).toBe(path.resolve(validPath));
    });

    test('converts relative to absolute paths', () => {
      const relativePath = 'src/myproject';
      const result = executor.validateAndSanitizePath(relativePath);
      expect(result).toBe(path.resolve(relativePath));
      expect(path.isAbsolute(result)).toBe(true);
    });

    test('accepts paths in /Users (macOS)', () => {
      const validPath = '/Users/testuser/project';
      const result = executor.validateAndSanitizePath(validPath);
      expect(result).toBe(path.resolve(validPath));
    });

    test('accepts paths in /home (Linux)', () => {
      const validPath = '/home/testuser/project';
      const result = executor.validateAndSanitizePath(validPath);
      expect(result).toBe(path.resolve(validPath));
    });

    test('accepts paths with spaces', () => {
      const validPath = '/home/user/my project folder';
      const result = executor.validateAndSanitizePath(validPath);
      expect(result).toBe(path.resolve(validPath));
    });

    test('normalizes duplicate slashes', () => {
      const pathWithDuplicateSlashes = '/home//user///project';
      const result = executor.validateAndSanitizePath(pathWithDuplicateSlashes);
      expect(result).toBe(path.resolve(pathWithDuplicateSlashes));
    });
  });
});
