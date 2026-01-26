/**
 * Tests for LogManager
 * Tests routing, error handling, context management, and lifecycle
 */

const LogManager = require('../src/logging/log-manager');
const BaseDestination = require('../src/logging/destinations/base-destination');

// Mock destination for testing
class MockDestination extends BaseDestination {
  constructor(name = 'mock', config = {}) {
    super(config);
    this.name = name;
    this.logs = [];
    this.flushCalls = 0;
    this.closeCalls = 0;
    this.jobContext = null;
    this.shouldFail = config.shouldFail || false;
    this.shouldFailFlush = config.shouldFailFlush || false;
    this.minLevel = config.minLevel || null;
  }

  async write(level, message, metadata = {}) {
    if (this.shouldFail) {
      throw new Error(`${this.name} write failed`);
    }
    this.logs.push({ level, message, metadata: { ...metadata } });
  }

  async flush() {
    this.flushCalls++;
    if (this.shouldFailFlush) {
      throw new Error(`${this.name} flush failed`);
    }
  }

  async close() {
    this.closeCalls++;
  }

  shouldLog(level) {
    if (!this.minLevel) return true;

    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] <= levels[this.minLevel];
  }

  setJobContext(jobId, context) {
    this.jobContext = { jobId, context };
  }

  async clearJobContext() {
    this.jobContext = null;
  }

  handleError(error, level, message) {
    // Track errors for testing
    if (!this.errors) this.errors = [];
    this.errors.push({ error, level, message });
  }
}

describe('LogManager', () => {
  describe('Constructor', () => {
    test('requires array of destinations', () => {
      expect(() => {
        new LogManager('not-an-array');
      }).toThrow('LogManager requires an array of destinations');
    });

    test('accepts empty destinations array', () => {
      const manager = new LogManager([]);
      expect(manager.destinations).toEqual([]);
    });

    test('initializes with destinations', () => {
      const dest1 = new MockDestination('dest1');
      const dest2 = new MockDestination('dest2');

      const manager = new LogManager([dest1, dest2]);

      expect(manager.destinations.length).toBe(2);
      expect(manager.destinations).toContain(dest1);
      expect(manager.destinations).toContain(dest2);
    });

    test('accepts agentId in config', () => {
      const manager = new LogManager([], { agentId: 'agent-123' });
      expect(manager.agentId).toBe('agent-123');
    });

    test('initializes with empty job context', () => {
      const manager = new LogManager([]);

      expect(manager.jobContext.jobId).toBeNull();
      expect(manager.jobContext.globalContext).toEqual({});
    });
  });

  describe('write()', () => {
    test('writes to all destinations', async () => {
      const dest1 = new MockDestination('dest1');
      const dest2 = new MockDestination('dest2');
      const manager = new LogManager([dest1, dest2]);

      await manager.write('info', 'test message', { key: 'value' });

      expect(dest1.logs.length).toBe(1);
      expect(dest2.logs.length).toBe(1);

      expect(dest1.logs[0].level).toBe('info');
      expect(dest1.logs[0].message).toBe('test message');
      expect(dest1.logs[0].metadata.key).toBe('value');
    });

    test('adds agentId to metadata when set', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest], { agentId: 'agent-42' });

      await manager.write('info', 'test', {});

      expect(dest.logs[0].metadata.agentId).toBe('agent-42');
    });

    test('adds jobId to metadata when set', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setJobContext(123);
      await manager.write('info', 'test', {});

      expect(dest.logs[0].metadata.jobId).toBe(123);
    });

    test('merges global context with log metadata', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setJobContext(123, { component: 'worktree' });
      await manager.write('info', 'test', { action: 'create' });

      expect(dest.logs[0].metadata.component).toBe('worktree');
      expect(dest.logs[0].metadata.action).toBe('create');
      expect(dest.logs[0].metadata.jobId).toBe(123);
    });

    test('log metadata overrides global context', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setContext('key', 'global-value');
      await manager.write('info', 'test', { key: 'log-value' });

      expect(dest.logs[0].metadata.key).toBe('log-value');
    });

    test('respects destination shouldLog filter', async () => {
      const dest = new MockDestination('dest', { minLevel: 'warn' });
      const manager = new LogManager([dest]);

      await manager.write('debug', 'should not log', {});
      await manager.write('warn', 'should log', {});

      expect(dest.logs.length).toBe(1);
      expect(dest.logs[0].level).toBe('warn');
    });

    test('handles destination errors gracefully', async () => {
      const goodDest = new MockDestination('good');
      const badDest = new MockDestination('bad', { shouldFail: true });
      const manager = new LogManager([goodDest, badDest]);

      // Should not throw
      await expect(
        manager.write('info', 'test', {})
      ).resolves.toBeUndefined();

      // Good destination should still receive log
      expect(goodDest.logs.length).toBe(1);

      // Bad destination should have error tracked
      expect(badDest.errors).toBeDefined();
      expect(badDest.errors.length).toBe(1);
    });

    test('writes to destinations in parallel', async () => {
      let writeOrder = [];

      class SlowDestination extends MockDestination {
        async write(level, message, metadata) {
          await new Promise(resolve => setTimeout(resolve, 50));
          writeOrder.push(this.name);
          return super.write(level, message, metadata);
        }
      }

      const dest1 = new SlowDestination('dest1');
      const dest2 = new SlowDestination('dest2');
      const dest3 = new SlowDestination('dest3');
      const manager = new LogManager([dest1, dest2, dest3]);

      await manager.write('info', 'test', {});

      // All should complete (parallel execution)
      expect(writeOrder.length).toBe(3);
    });
  });

  describe('Log level methods', () => {
    test('error() writes at error level', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.error('error message', { code: 500 });

      expect(dest.logs[0].level).toBe('error');
      expect(dest.logs[0].message).toBe('error message');
      expect(dest.logs[0].metadata.code).toBe(500);
    });

    test('warn() writes at warn level', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.warn('warning message');

      expect(dest.logs[0].level).toBe('warn');
      expect(dest.logs[0].message).toBe('warning message');
    });

    test('info() writes at info level', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.info('info message');

      expect(dest.logs[0].level).toBe('info');
    });

    test('debug() writes at debug level', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.debug('debug message');

      expect(dest.logs[0].level).toBe('debug');
    });
  });

  describe('Context management', () => {
    test('setAgentId() updates agentId', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setAgentId('agent-999');
      await manager.info('test');

      expect(dest.logs[0].metadata.agentId).toBe('agent-999');
    });

    test('setJobContext() updates context', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setJobContext(456, { component: 'git' });
      await manager.info('test');

      expect(dest.logs[0].metadata.jobId).toBe(456);
      expect(dest.logs[0].metadata.component).toBe('git');
    });

    test('setJobContext() notifies destinations', () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setJobContext(789, { env: 'prod' });

      expect(dest.jobContext).toEqual({
        jobId: 789,
        context: { env: 'prod' }
      });
    });

    test('clearJobContext() flushes and clears', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setJobContext(123, { component: 'test' });
      await manager.clearJobContext();

      expect(dest.flushCalls).toBe(1);
      expect(dest.jobContext).toBeNull();
      expect(manager.jobContext.jobId).toBeNull();
      expect(manager.jobContext.globalContext).toEqual({});
    });

    test('setContext() with key-value pair', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setContext('operation', 'backup');
      await manager.info('test');

      expect(dest.logs[0].metadata.operation).toBe('backup');
    });

    test('setContext() with object', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setContext({ component: 'db', version: 2 });
      await manager.info('test');

      expect(dest.logs[0].metadata.component).toBe('db');
      expect(dest.logs[0].metadata.version).toBe(2);
    });

    test('setContext() merges with existing context', () => {
      const manager = new LogManager([]);

      manager.setContext('key1', 'value1');
      manager.setContext({ key2: 'value2' });

      expect(manager.jobContext.globalContext).toEqual({
        key1: 'value1',
        key2: 'value2'
      });
    });
  });

  describe('child()', () => {
    test('creates child logger with additional context', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      manager.setContext('parent', 'value');
      const child = manager.child({ child: 'value' });

      await child.info('test');

      expect(dest.logs[0].metadata.parent).toBe('value');
      expect(dest.logs[0].metadata.child).toBe('value');
    });

    test('child context does not affect parent', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      const child = manager.child({ childOnly: 'value' });
      await manager.info('parent log');

      expect(dest.logs[0].metadata.childOnly).toBeUndefined();
    });

    test('child inherits all parent methods', () => {
      const manager = new LogManager([]);
      const child = manager.child({ test: 'value' });

      expect(typeof child.error).toBe('function');
      expect(typeof child.warn).toBe('function');
      expect(typeof child.info).toBe('function');
      expect(typeof child.debug).toBe('function');
      expect(typeof child.event).toBe('function');
      expect(typeof child.startTimer).toBe('function');
      expect(typeof child.measure).toBe('function');
      expect(typeof child.child).toBe('function');
    });

    test('nested children accumulate context', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      const child1 = manager.child({ level1: 'a' });
      const child2 = child1.child({ level2: 'b' });

      await child2.info('test');

      expect(dest.logs[0].metadata.level1).toBe('a');
      expect(dest.logs[0].metadata.level2).toBe('b');
    });
  });

  describe('event()', () => {
    test('logs semantic event with structured data', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.event('worktree.created', { path: '/tmp/test' });

      expect(dest.logs[0].level).toBe('info');
      expect(dest.logs[0].metadata.eventType).toBe('worktree.created');
      expect(dest.logs[0].metadata.category).toBe('worktree');
      expect(dest.logs[0].metadata.action).toBe('created');
      expect(dest.logs[0].metadata.path).toBe('/tmp/test');
    });

    test('uses error level for failed events', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.event('backup.failed', { reason: 'timeout' });

      expect(dest.logs[0].level).toBe('error');
    });

    test('uses error level for error events', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.event('validation.error', {});

      expect(dest.logs[0].level).toBe('error');
    });

    test('capitalizes action for message', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.event('db.started', {});

      expect(dest.logs[0].message).toBe('Started');
    });
  });

  describe('startTimer()', () => {
    test('returns timer with done method', () => {
      const manager = new LogManager([]);
      const timer = manager.startTimer('operation.test');

      expect(typeof timer.done).toBe('function');
    });

    test('done() logs completion with duration', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      const timer = manager.startTimer('test.operation');
      await new Promise(resolve => setTimeout(resolve, 50));
      await timer.done({ status: 'success' });

      expect(dest.logs[0].metadata.eventType).toBe('test.operation.complete');
      expect(dest.logs[0].metadata.duration).toBeGreaterThan(0);
      expect(dest.logs[0].metadata.durationMs).toBeGreaterThan(0);
      expect(dest.logs[0].metadata.status).toBe('success');
    });

    test('done() returns duration', async () => {
      const manager = new LogManager([]);
      const timer = manager.startTimer('test');

      await new Promise(resolve => setTimeout(resolve, 50));
      const duration = await timer.done();

      expect(duration).toBeGreaterThan(0);
    });

    test('includes initial context in completion', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      const timer = manager.startTimer('test', { initial: 'context' });
      await timer.done({ final: 'data' });

      expect(dest.logs[0].metadata.initial).toBe('context');
      expect(dest.logs[0].metadata.final).toBe('data');
    });
  });

  describe('measure()', () => {
    test('measures async operation duration', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      const result = await manager.measure('test.operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'result';
      });

      expect(result).toBe('result');
      expect(dest.logs.length).toBe(2); // started + complete
      expect(dest.logs[0].metadata.eventType).toBe('test.operation.started');
      expect(dest.logs[1].metadata.eventType).toBe('test.operation.complete');
      expect(dest.logs[1].metadata.success).toBe(true);
      expect(dest.logs[1].metadata.duration).toBeGreaterThan(0);
    });

    test('logs error on operation failure', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      const testError = new Error('Operation failed');

      await expect(
        manager.measure('test.operation', async () => {
          throw testError;
        })
      ).rejects.toThrow('Operation failed');

      expect(dest.logs[1].metadata.success).toBe(false);
      expect(dest.logs[1].metadata.error).toBe('Operation failed');
    });

    test('includes context in measurement', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.measure('test', async () => 'done', { env: 'test' });

      expect(dest.logs[0].metadata.env).toBe('test');
      expect(dest.logs[1].metadata.env).toBe('test');
    });
  });

  describe('flush()', () => {
    test('flushes all destinations', async () => {
      const dest1 = new MockDestination('dest1');
      const dest2 = new MockDestination('dest2');
      const manager = new LogManager([dest1, dest2]);

      await manager.flush();

      expect(dest1.flushCalls).toBe(1);
      expect(dest2.flushCalls).toBe(1);
    });

    test('handles destination flush errors gracefully', async () => {
      const goodDest = new MockDestination('good');
      const badDest = new MockDestination('bad', { shouldFailFlush: true });
      const manager = new LogManager([goodDest, badDest]);

      // Should not throw
      await expect(manager.flush()).resolves.toBeUndefined();

      expect(goodDest.flushCalls).toBe(1);
      expect(badDest.errors).toBeDefined();
    });

    test('skips destinations without flush method', async () => {
      const dest = new MockDestination();
      delete dest.flush;

      const manager = new LogManager([dest]);

      // Should not throw
      await expect(manager.flush()).resolves.toBeUndefined();
    });
  });

  describe('close()', () => {
    test('sets isShuttingDown flag', async () => {
      const manager = new LogManager([]);

      await manager.close();

      expect(manager.isShuttingDown).toBe(true);
    });

    test('closes all destinations', async () => {
      const dest1 = new MockDestination('dest1');
      const dest2 = new MockDestination('dest2');
      const manager = new LogManager([dest1, dest2]);

      await manager.close();

      expect(dest1.closeCalls).toBe(1);
      expect(dest2.closeCalls).toBe(1);
    });

    test('handles destination close errors gracefully', async () => {
      const goodDest = new MockDestination('good');
      const badDest = new MockDestination('bad');
      badDest.close = jest.fn().mockRejectedValue(new Error('Close failed'));

      const manager = new LogManager([goodDest, badDest]);

      // Should not throw
      await expect(manager.close()).resolves.toBeUndefined();

      expect(goodDest.closeCalls).toBe(1);
    });

    test('skips destinations without close method', async () => {
      const dest = new MockDestination();
      delete dest.close;

      const manager = new LogManager([dest]);

      // Should not throw
      await expect(manager.close()).resolves.toBeUndefined();
    });
  });

  describe('addDestination()', () => {
    test('adds destination to manager', async () => {
      const dest1 = new MockDestination('dest1');
      const manager = new LogManager([dest1]);

      const dest2 = new MockDestination('dest2');
      manager.addDestination(dest2);

      await manager.info('test');

      expect(dest1.logs.length).toBe(1);
      expect(dest2.logs.length).toBe(1);
    });

    test('throws on null destination', () => {
      const manager = new LogManager([]);

      expect(() => {
        manager.addDestination(null);
      }).toThrow('Cannot add null or undefined destination');
    });

    test('notifies new destination of active context', () => {
      const manager = new LogManager([]);
      manager.setJobContext(123, { env: 'prod' });

      const dest = new MockDestination();
      manager.addDestination(dest);

      expect(dest.jobContext).toEqual({
        jobId: 123,
        context: { env: 'prod' }
      });
    });
  });

  describe('removeDestination()', () => {
    test('removes destination from manager', async () => {
      const dest1 = new MockDestination('dest1');
      const dest2 = new MockDestination('dest2');
      const manager = new LogManager([dest1, dest2]);

      await manager.removeDestination(dest1);
      await manager.info('test');

      expect(dest1.logs.length).toBe(0); // Not receiving logs
      expect(dest2.logs.length).toBe(1);
    });

    test('closes destination before removing', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);

      await manager.removeDestination(dest);

      expect(dest.closeCalls).toBe(1);
    });

    test('handles remove of non-existent destination', async () => {
      const dest1 = new MockDestination('dest1');
      const dest2 = new MockDestination('dest2');
      const manager = new LogManager([dest1]);

      // Should not throw
      await expect(
        manager.removeDestination(dest2)
      ).resolves.toBeUndefined();
    });

    test('handles close errors during removal', async () => {
      const dest = new MockDestination();
      dest.close = jest.fn().mockRejectedValue(new Error('Close failed'));

      const manager = new LogManager([dest]);

      // Should not throw
      await expect(
        manager.removeDestination(dest)
      ).resolves.toBeUndefined();
    });
  });

  describe('getDestinationCount()', () => {
    test('returns number of registered destinations', () => {
      const dest1 = new MockDestination();
      const dest2 = new MockDestination();
      const manager = new LogManager([dest1, dest2]);

      expect(manager.getDestinationCount()).toBe(2);
    });

    test('returns 0 for empty manager', () => {
      const manager = new LogManager([]);
      expect(manager.getDestinationCount()).toBe(0);
    });

    test('updates after adding destination', () => {
      const manager = new LogManager([]);
      expect(manager.getDestinationCount()).toBe(0);

      manager.addDestination(new MockDestination());
      expect(manager.getDestinationCount()).toBe(1);
    });

    test('updates after removing destination', async () => {
      const dest = new MockDestination();
      const manager = new LogManager([dest]);
      expect(manager.getDestinationCount()).toBe(1);

      await manager.removeDestination(dest);
      expect(manager.getDestinationCount()).toBe(0);
    });
  });
});
