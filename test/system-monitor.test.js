const os = require('os');

// Mock os module
jest.mock('os');

describe('SystemMonitor', () => {
  let SystemMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    // Note: Don't reset modules here as it breaks the os mock
    SystemMonitor = require('../src/system-monitor');
  });

  describe('getCapacity()', () => {
    test('returns maximum capacity when system has plenty of resources', () => {
      // Mock system with 80% free memory and low CPU load
      os.freemem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB free
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024); // 10GB total
      os.loadavg.mockReturnValue([0.5, 0.6, 0.7]); // Low load
      os.cpus.mockReturnValue(new Array(4).fill({})); // 4 CPUs

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      expect(capacity).toBe(5); // Maximum capacity
    });

    test('returns medium capacity when system has moderate resources', () => {
      // Mock system with 30% free memory (medium) and low CPU load
      os.freemem.mockReturnValue(3 * 1024 * 1024 * 1024); // 3GB free
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024); // 10GB total
      os.loadavg.mockReturnValue([1.0, 1.1, 1.2]); // Low load
      os.cpus.mockReturnValue(new Array(4).fill({})); // 4 CPUs

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      expect(capacity).toBe(2); // Medium capacity (30% mem is between 20% and 40%)
    });

    test('returns minimum capacity when memory is low', () => {
      // Mock system with <20% free memory
      os.freemem.mockReturnValue(1 * 1024 * 1024 * 1024); // 1GB free
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024); // 10GB total
      os.loadavg.mockReturnValue([0.5, 0.6, 0.7]); // Low load (doesn't matter)
      os.cpus.mockReturnValue(new Array(4).fill({})); // 4 CPUs

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      expect(capacity).toBe(1); // Minimum capacity
    });

    test('returns minimum capacity when CPU load is high', () => {
      // Mock system with high CPU load
      os.freemem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB free
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024); // 10GB total
      os.loadavg.mockReturnValue([3.5, 3.6, 3.7]); // High load (>0.8 per CPU)
      os.cpus.mockReturnValue(new Array(4).fill({})); // 4 CPUs

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      expect(capacity).toBe(1); // Minimum capacity
    });

    test('handles single CPU systems correctly', () => {
      // Mock single CPU system with high load
      os.freemem.mockReturnValue(8 * 1024 * 1024 * 1024);
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024);
      os.loadavg.mockReturnValue([0.9, 1.0, 1.1]); // >0.8 per CPU
      os.cpus.mockReturnValue([{}]); // Single CPU

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      expect(capacity).toBe(1); // Minimum capacity
    });

    test('handles edge case with zero CPUs gracefully', () => {
      // Mock edge case (shouldn't happen in practice)
      os.freemem.mockReturnValue(8 * 1024 * 1024 * 1024);
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024);
      os.loadavg.mockReturnValue([0.5, 0.6, 0.7]);
      os.cpus.mockReturnValue([]); // No CPUs (edge case)

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      // Should default to max capacity to avoid division by zero
      expect(capacity).toBe(5);
    });

    test('returns medium capacity when memory is borderline low', () => {
      // Mock system with exactly 30% free memory (between thresholds)
      os.freemem.mockReturnValue(3 * 1024 * 1024 * 1024); // 3GB free
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024); // 10GB total
      os.loadavg.mockReturnValue([0.5, 0.6, 0.7]); // Low load
      os.cpus.mockReturnValue(new Array(4).fill({})); // 4 CPUs

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      expect(capacity).toBe(2); // Medium capacity (30% is between 20% and 40%)
    });

    test('returns medium capacity when CPU load is borderline high', () => {
      // Mock system with plenty of memory but moderate CPU load
      // This tests that medium capacity is returned based on CPU alone
      os.freemem.mockReturnValue(6 * 1024 * 1024 * 1024); // 60% free (plenty)
      os.totalmem.mockReturnValue(10 * 1024 * 1024 * 1024);
      os.loadavg.mockReturnValue([2.8, 2.9, 3.0]); // 0.7 per CPU (between 0.6 and 0.8)
      os.cpus.mockReturnValue(new Array(4).fill({})); // 4 CPUs

      const monitor = new SystemMonitor();
      const capacity = monitor.getCapacity();

      expect(capacity).toBe(2); // Medium capacity (CPU load is between 0.6 and 0.8)
    });
  });
});
