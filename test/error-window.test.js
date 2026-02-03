const ErrorWindow = require('../src/error-window');

describe('ErrorWindow', () => {
  let errorWindow;
  let mockDate;

  beforeEach(() => {
    // Mock Date.now() for predictable testing
    mockDate = 1000000000; // Start time
    jest.spyOn(Date, 'now').mockImplementation(() => mockDate);

    errorWindow = new ErrorWindow();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('addError()', () => {
    test('records error timestamp', () => {
      mockDate = 1000000000;
      errorWindow.addError();

      expect(errorWindow.errors).toHaveLength(1);
      expect(errorWindow.errors[0]).toBe(1000000000);
    });

    test('accumulates multiple errors', () => {
      mockDate = 1000000000;
      errorWindow.addError();

      mockDate = 1000010000;
      errorWindow.addError();

      mockDate = 1000020000;
      errorWindow.addError();

      expect(errorWindow.errors).toHaveLength(3);
    });

    test('cleans up old errors beyond window', () => {
      mockDate = 1000000000;

      // Add 10 errors
      for (let i = 0; i < 10; i++) {
        errorWindow.addError();
        mockDate += 1000;
      }

      // Advance time by 2 minutes (window is 1 minute)
      mockDate += 120000;

      // Add new error (triggers cleanup)
      errorWindow.addError();

      // Only recent errors (within 60 seconds) should remain
      expect(errorWindow.errors.length).toBeLessThan(10);
    });
  });

  describe('shouldShutdown()', () => {
    test('returns false when no errors recorded', () => {
      expect(errorWindow.shouldShutdown()).toBe(false);
    });

    test('returns false when error rate is low', () => {
      mockDate = 1000000000;

      // Add 5 errors over 60 seconds (< 50% error rate)
      for (let i = 0; i < 5; i++) {
        errorWindow.addError();
        mockDate += 12000; // 12 seconds apart
      }

      expect(errorWindow.shouldShutdown()).toBe(false);
    });

    test('returns true when error rate exceeds 50%', () => {
      mockDate = 1000000000;

      // Add 20 errors over 20 seconds (>50% error rate)
      // Assuming ~5 second interval per request = 12 expected requests in 60s
      for (let i = 0; i < 20; i++) {
        errorWindow.addError();
        mockDate += 1000; // 1 second apart
      }

      expect(errorWindow.shouldShutdown()).toBe(true);
    });

    test('handles edge case at exactly 50% error rate', () => {
      mockDate = 1000000000;

      // Add exactly 6 errors in 60 seconds (50% of ~12 requests)
      for (let i = 0; i < 6; i++) {
        errorWindow.addError();
        mockDate += 10000; // 10 seconds apart
      }

      // At exactly 50%, should not shut down (need > 50%)
      expect(errorWindow.shouldShutdown()).toBe(false);
    });

    test('allows recovery after error rate drops', () => {
      mockDate = 1000000000;

      // Add many errors to trigger shutdown condition
      for (let i = 0; i < 20; i++) {
        errorWindow.addError();
        mockDate += 1000;
      }

      // Should want to shutdown
      expect(errorWindow.shouldShutdown()).toBe(true);

      // Advance time by 2 minutes (old errors age out)
      mockDate += 120000;

      // Add single error
      errorWindow.addError();

      // Should not shutdown (old errors cleaned up)
      expect(errorWindow.shouldShutdown()).toBe(false);
    });

    test('calculates rate based on 5-second request interval', () => {
      mockDate = 1000000000;

      // In 60 seconds with 5s interval, we expect 12 requests
      // So 7 errors = 7/12 = 58.3% > 50% = should shutdown
      for (let i = 0; i < 7; i++) {
        errorWindow.addError();
        mockDate += 8000; // Spread errors across window
      }

      expect(errorWindow.shouldShutdown()).toBe(true);
    });

    test('does not shutdown on transient errors', () => {
      mockDate = 1000000000;

      // Add 3 errors quickly
      for (let i = 0; i < 3; i++) {
        errorWindow.addError();
        mockDate += 1000;
      }

      // Wait 30 seconds
      mockDate += 30000;

      // Add 1 more error (total 4 errors in 33 seconds)
      errorWindow.addError();

      // 4 errors over 60s window = 4/12 = 33% < 50% = should not shutdown
      expect(errorWindow.shouldShutdown()).toBe(false);
    });
  });

  describe('getErrorCount()', () => {
    test('returns 0 when no errors', () => {
      expect(errorWindow.getErrorCount()).toBe(0);
    });

    test('returns correct count after adding errors', () => {
      mockDate = 1000000000;

      for (let i = 0; i < 5; i++) {
        errorWindow.addError();
        mockDate += 5000;
      }

      expect(errorWindow.getErrorCount()).toBe(5);
    });

    test('excludes old errors beyond window', () => {
      mockDate = 1000000000;

      // Add 10 errors
      for (let i = 0; i < 10; i++) {
        errorWindow.addError();
        mockDate += 1000;
      }

      // Advance time by 2 minutes
      mockDate += 120000;

      // Old errors should be excluded
      expect(errorWindow.getErrorCount()).toBe(0);
    });
  });
});
