const os = require('os');

/**
 * SystemMonitor - Monitors system resources to determine agent capacity
 *
 * Adjusts agent capacity based on available memory and CPU load:
 * - High resources (>40% mem, <0.6 CPU): capacity = 5
 * - Medium resources (>20% mem, <0.8 CPU): capacity = 2
 * - Low resources (<20% mem OR >0.8 CPU): capacity = 1
 *
 * This prevents agents from overwhelming systems that are already under load.
 */
class SystemMonitor {
  constructor() {
    // Thresholds for capacity determination
    this.THRESHOLDS = {
      // Memory thresholds (as fraction of total memory)
      MEM_LOW: 0.2,    // Below 20% free = low resources
      MEM_MEDIUM: 0.4, // Below 40% free = medium resources

      // CPU load thresholds (as fraction per CPU)
      CPU_MEDIUM: 0.6, // Above 0.6 per CPU = medium load
      CPU_HIGH: 0.8,   // Above 0.8 per CPU = high load

      // Capacity levels
      CAPACITY_MIN: 1,
      CAPACITY_MEDIUM: 2,
      CAPACITY_MAX: 5
    };
  }

  /**
   * Get current system capacity based on resources
   * @returns {number} Capacity level (1, 2, or 5)
   */
  getCapacity() {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const cpus = os.cpus();
    const cpuCount = (cpus && cpus.length) || 1; // Default to 1 to avoid division by zero
    const loadAvgArray = os.loadavg();
    const loadAvg = (loadAvgArray && loadAvgArray[0]) || 0; // 1-minute load average

    // Calculate resource metrics
    const memFraction = freeMem / totalMem;
    const cpuLoadPerCore = loadAvg / cpuCount;

    // Determine capacity based on thresholds
    // Low resources: return minimum capacity
    if (memFraction < this.THRESHOLDS.MEM_LOW || cpuLoadPerCore > this.THRESHOLDS.CPU_HIGH) {
      return this.THRESHOLDS.CAPACITY_MIN;
    }

    // Medium resources: return medium capacity
    if (memFraction < this.THRESHOLDS.MEM_MEDIUM || cpuLoadPerCore > this.THRESHOLDS.CPU_MEDIUM) {
      return this.THRESHOLDS.CAPACITY_MEDIUM;
    }

    // High resources: return maximum capacity
    return this.THRESHOLDS.CAPACITY_MAX;
  }
}

module.exports = SystemMonitor;
