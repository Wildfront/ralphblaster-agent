const ProgressThrottle = require('../src/progress-throttle');

describe('ProgressThrottle', () => {
  let throttle;
  let mockDate;

  beforeEach(() => {
    // Mock Date.now() for predictable testing
    mockDate = 1000000000; // Start time
    jest.spyOn(Date, 'now').mockImplementation(() => mockDate);

    throttle = new ProgressThrottle();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getInterval()', () => {
    test('returns minimum interval (100ms) for low update rate', () => {
      // Add a few updates over 5 seconds (< 5 updates/sec)
      mockDate = 1000000000;
      throttle.recordUpdate();

      mockDate = 1000002000; // +2s
      throttle.recordUpdate();

      mockDate = 1000004000; // +4s
      throttle.recordUpdate();

      const interval = throttle.getInterval();
      expect(interval).toBe(100); // Minimum throttle
    });

    test('returns moderate interval (200ms) for medium update rate', () => {
      // Add 10 updates over 1 second (10 updates/sec, between 5 and 20)
      mockDate = 1000000000;

      for (let i = 0; i < 10; i++) {
        throttle.recordUpdate();
        mockDate += 100; // 100ms per update
      }

      const interval = throttle.getInterval();
      expect(interval).toBe(200); // Medium throttle
    });

    test('returns maximum interval (500ms) for high update rate', () => {
      // Add 100 updates over 1 second (>20 updates/sec)
      mockDate = 1000000000;

      for (let i = 0; i < 100; i++) {
        throttle.recordUpdate();
        mockDate += 10; // 10ms per update
      }

      const interval = throttle.getInterval();
      expect(interval).toBe(500); // Maximum throttle
    });

    test('cleans up old updates beyond 5-second window', () => {
      // Add updates, then advance time by 6 seconds
      mockDate = 1000000000;

      // Add 30 updates (should trigger medium throttle)
      for (let i = 0; i < 30; i++) {
        throttle.recordUpdate();
        mockDate += 100; // 100ms per update
      }

      // Advance time by 6 seconds
      mockDate += 6000;

      // Old updates should be cleaned up, so now rate is low
      const interval = throttle.getInterval();
      expect(interval).toBe(100); // Minimum throttle (old updates cleaned up)
    });

    test('returns minimum interval when no updates recorded', () => {
      const interval = throttle.getInterval();
      expect(interval).toBe(100); // Minimum throttle
    });

    test('handles boundary at exactly 5 updates per second', () => {
      // Add exactly 5 updates in 1 second
      mockDate = 1000000000;

      for (let i = 0; i < 5; i++) {
        throttle.recordUpdate();
        mockDate += 200; // 200ms per update
      }

      const interval = throttle.getInterval();
      expect(interval).toBe(100); // Should be minimum (5/sec is at boundary)
    });

    test('handles boundary at exactly 20 updates per second', () => {
      // Add exactly 20 updates in 1 second
      mockDate = 1000000000;

      for (let i = 0; i < 20; i++) {
        throttle.recordUpdate();
        mockDate += 50; // 50ms per update
      }

      const interval = throttle.getInterval();
      expect(interval).toBe(200); // Should be medium (20/sec is at boundary)
    });
  });

  describe('shouldThrottle()', () => {
    test('allows update when enough time has passed', () => {
      mockDate = 1000000000;
      throttle.recordUpdate();

      // Advance time by 150ms (> 100ms min interval)
      mockDate = 1000000150;

      expect(throttle.shouldThrottle()).toBe(false); // Should allow
    });

    test('blocks update when not enough time has passed', () => {
      mockDate = 1000000000;
      throttle.recordUpdate();

      // Advance time by only 50ms (< 100ms min interval)
      mockDate = 1000000050;

      expect(throttle.shouldThrottle()).toBe(true); // Should block
    });

    test('allows first update immediately', () => {
      expect(throttle.shouldThrottle()).toBe(false); // Should allow first update
    });

    test('adjusts throttle based on update rate', () => {
      mockDate = 1000000000;

      // Create high update rate (>20/sec) to trigger 500ms throttle
      for (let i = 0; i < 100; i++) {
        throttle.recordUpdate();
        mockDate += 10;
      }

      // Now we should need to wait 500ms
      mockDate = 1000000000 + 1000; // Reset to after all updates
      throttle.lastUpdate = mockDate; // Set last update time

      // 400ms later should still throttle (need 500ms)
      mockDate += 400;
      expect(throttle.shouldThrottle()).toBe(true);

      // 100ms more (total 500ms) should allow
      mockDate += 100;
      expect(throttle.shouldThrottle()).toBe(false);
    });
  });

  describe('recordUpdate()', () => {
    test('records update timestamp', () => {
      mockDate = 1000000000;
      throttle.recordUpdate();

      expect(throttle.recentUpdates).toHaveLength(1);
      expect(throttle.recentUpdates[0]).toBe(1000000000);
    });

    test('updates lastUpdate timestamp', () => {
      mockDate = 1000000000;
      throttle.recordUpdate();

      expect(throttle.lastUpdate).toBe(1000000000);
    });

    test('accumulates multiple updates', () => {
      mockDate = 1000000000;
      throttle.recordUpdate();

      mockDate = 1000000100;
      throttle.recordUpdate();

      mockDate = 1000000200;
      throttle.recordUpdate();

      expect(throttle.recentUpdates).toHaveLength(3);
    });

    test('automatically cleans old updates', () => {
      mockDate = 1000000000;

      // Add updates
      for (let i = 0; i < 10; i++) {
        throttle.recordUpdate();
        mockDate += 100;
      }

      // Advance time by 6 seconds
      mockDate += 6000;

      // Record new update (should trigger cleanup)
      throttle.recordUpdate();

      // Only recent updates (within 5 seconds) should remain
      expect(throttle.recentUpdates.length).toBeLessThan(10);
    });
  });
});
