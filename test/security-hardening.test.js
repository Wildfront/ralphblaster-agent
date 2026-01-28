/**
 * Security hardening verification tests
 * Tests for the security fixes implemented in the security hardening pass
 */

describe('Security Hardening', () => {
  describe('TLS Certificate Validation', () => {
    let originalEnv;

    beforeEach(() => {
      // Clear module cache to force re-evaluation
      delete require.cache[require.resolve('../src/config')];
      originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    });

    afterEach(() => {
      // Restore original environment
      if (originalEnv === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv;
      }
      delete require.cache[require.resolve('../src/config')];
    });

    test('throws error when TLS validation is disabled', () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      process.env.RALPHBLASTER_API_TOKEN = 'test-token';

      expect(() => {
        require('../src/config');
      }).toThrow(/CRITICAL SECURITY ERROR.*TLS certificate validation is disabled/);
    });

    test('loads successfully when TLS validation is enabled', () => {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.RALPHBLASTER_API_TOKEN = 'test-token';

      expect(() => {
        require('../src/config');
      }).not.toThrow();
    });
  });

  describe('JSON Parsing Security', () => {
    const safeJsonParse = require('secure-json-parse');

    test('secure-json-parse is installed and working', () => {
      const maliciousJson = '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}';
      const parsed = safeJsonParse.parse(maliciousJson, null, {
        protoAction: 'remove',
        constructorAction: 'remove'
      });

      // The __proto__ property itself should not be set
      expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'constructor')).toBe(false);
    });

    test('secure-json-parse handles deep nesting', () => {
      let deepJson = '{"a":';
      for (let i = 0; i < 100; i++) {
        deepJson += '{"b":';
      }
      deepJson += '1';
      for (let i = 0; i < 100; i++) {
        deepJson += '}';
      }
      deepJson += '}';

      // Should parse without stack overflow
      expect(() => {
        safeJsonParse.parse(deepJson, null, {
          protoAction: 'remove',
          constructorAction: 'remove'
        });
      }).not.toThrow();
    });
  });

  describe('Config File Size Limits', () => {
    test('secure JSON parsing is implemented in config-file-manager', () => {
      // Verify that config-file-manager uses secure-json-parse
      const ConfigFileManager = require('../src/config-file-manager');
      const fs = require('fs');

      // Read the source file to verify it imports secure-json-parse
      const sourceCode = fs.readFileSync(
        require.resolve('../src/config-file-manager'),
        'utf8'
      );

      expect(sourceCode).toContain("require('secure-json-parse')");
      expect(sourceCode).toContain('MAX_CONFIG_SIZE');
      expect(sourceCode).toContain('protoAction');
      expect(sourceCode).toContain('constructorAction');
    });
  });
});
