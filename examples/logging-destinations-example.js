/**
 * Example: Using Log Destinations
 *
 * This example demonstrates how to use the log destination abstraction layer.
 * Each destination can be used independently or combined through LogManager (future).
 */

const {
  ConsoleDestination,
  FileDestination,
  ApiDestination
} = require('../src/logging/destinations');

// Example 1: Console Destination
async function exampleConsoleDestination() {
  console.log('\n=== Console Destination Example ===\n');

  const logger = new ConsoleDestination({
    colors: true,
    format: 'pretty',
    minLevel: 'debug'
  });

  await logger.write('info', 'Starting job', { jobId: 123, user: 'alice' });
  await logger.write('debug', 'Processing file', { file: 'example.js', lines: 100 });
  await logger.write('warn', 'Deprecated API used', { api: 'oldFunction()' });
  await logger.write('error', 'Failed to connect', { host: 'api.example.com' });

  await logger.close();
}

// Example 2: File Destination
async function exampleFileDestination() {
  console.log('\n=== File Destination Example ===\n');

  const logger = new FileDestination({
    workingDir: '/tmp',
    job: { id: 456, task_title: 'Generate PRD' },
    startTime: Date.now(),
    jobType: 'PRD Generation',
    useStream: true
  });

  await logger.write('info', 'Job started');
  await logger.write('info', 'Analyzing requirements', { requirements: 5 });
  await logger.write('info', 'Generating document', { sections: 8 });
  await logger.write('info', 'Job completed');

  await logger.close();

  console.log(`Log file created at: ${logger.getLogFilePath()}`);
}

// Example 3: API Destination (mock)
async function exampleApiDestination() {
  console.log('\n=== API Destination Example ===\n');

  // Mock API client
  const mockApiClient = {
    addSetupLog: async (jobId, level, message, metadata) => {
      console.log(`[Mock API] Job ${jobId}: [${level}] ${message}`, metadata || '');
    },
    addSetupLogBatch: async (jobId, logs) => {
      console.log(`[Mock API] Batch for Job ${jobId}: ${logs.length} logs`);
      logs.forEach((log, i) => {
        console.log(`  ${i + 1}. [${log.level}] ${log.message}`);
      });
    }
  };

  const logger = new ApiDestination({
    apiClient: mockApiClient,
    jobId: 789,
    maxBatchSize: 3,
    flushInterval: 5000
  });

  await logger.write('info', 'Job initialized');
  await logger.write('info', 'Processing step 1');
  await logger.write('info', 'Processing step 2');
  // Buffer is now full (maxBatchSize=3), will auto-flush

  await logger.write('info', 'Processing step 3');
  await logger.write('info', 'Processing step 4');

  // Manual flush of remaining logs
  await logger.flush();
  console.log('Flushed remaining logs');

  await logger.close();
}

// Example 4: Multiple Destinations
async function exampleMultipleDestinations() {
  console.log('\n=== Multiple Destinations Example ===\n');

  // In the future, LogManager will coordinate these
  const destinations = [
    new ConsoleDestination({ format: 'pretty', minLevel: 'info' }),
    new FileDestination({
      workingDir: '/tmp',
      job: { id: 999, task_title: 'Multi-destination Test' },
      startTime: Date.now(),
      jobType: 'Test',
      useStream: false
    })
  ];

  // Manually write to all destinations
  const message = 'Event occurred';
  const metadata = { event: 'user_login', userId: 42 };

  console.log('Writing to all destinations...');
  for (const dest of destinations) {
    await dest.write('info', message, metadata);
  }

  // Close all
  for (const dest of destinations) {
    await dest.close();
  }

  console.log('All destinations closed');
}

// Example 5: Custom filtering with shouldLog
async function exampleFiltering() {
  console.log('\n=== Filtering Example ===\n');

  const prodLogger = new ConsoleDestination({
    format: 'json',
    minLevel: 'warn' // Only warn and error in production
  });

  const devLogger = new ConsoleDestination({
    format: 'pretty',
    minLevel: 'debug' // All levels in development
  });

  console.log('Production logger (warn and error only):');
  await prodLogger.write('debug', 'Debug info'); // Filtered out
  await prodLogger.write('info', 'Info message'); // Filtered out
  await prodLogger.write('warn', 'Warning message'); // Shown
  await prodLogger.write('error', 'Error message'); // Shown

  console.log('\nDevelopment logger (all levels):');
  await devLogger.write('debug', 'Debug info'); // Shown
  await devLogger.write('info', 'Info message'); // Shown
  await devLogger.write('warn', 'Warning message'); // Shown
  await devLogger.write('error', 'Error message'); // Shown

  await prodLogger.close();
  await devLogger.close();
}

// Run all examples
async function main() {
  try {
    await exampleConsoleDestination();
    await exampleFileDestination();
    await exampleApiDestination();
    await exampleMultipleDestinations();
    await exampleFiltering();

    console.log('\n=== All examples completed ===\n');
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  exampleConsoleDestination,
  exampleFileDestination,
  exampleApiDestination,
  exampleMultipleDestinations,
  exampleFiltering
};
