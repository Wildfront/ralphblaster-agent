jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const EventDetector = require('../src/executor/event-detector');

describe('EventDetector', () => {
  let eventDetector;
  let mockApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient = {
      sendStatusEvent: jest.fn().mockResolvedValue({})
    };
    eventDetector = new EventDetector();
  });

  describe('file modification detection', () => {
    test('detects "Writing to" pattern', () => {
      const chunk = 'Writing to src/app.js';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'write_file',
        expect.stringContaining('app.js'),
        expect.objectContaining({ filename: 'src/app.js' })
      );
    });

    test('detects "Created file" pattern', () => {
      const chunk = 'Created file test/new-test.js';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'file_modified',
        expect.stringContaining('new-test.js'),
        expect.objectContaining({ filename: 'test/new-test.js' })
      );
    });

    test('detects "Modified file" pattern', () => {
      const chunk = 'Modified file config/database.yml';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'file_modified',
        expect.stringContaining('database.yml'),
        expect.objectContaining({ filename: 'config/database.yml' })
      );
    });

    test('detects "Editing" pattern', () => {
      const chunk = 'Editing lib/utils.rb';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'edit_file',
        expect.stringContaining('utils.rb'),
        expect.objectContaining({ filename: 'lib/utils.rb' })
      );
    });

    test('detects "Successfully created" pattern', () => {
      const chunk = 'Successfully created app/models/user.rb';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'file_modified',
        expect.any(String),
        expect.objectContaining({ filename: 'app/models/user.rb' })
      );
    });

    test('detects "Successfully modified" pattern', () => {
      const chunk = 'Successfully modified config/routes.rb';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();
    });

    test('detects "Successfully updated" pattern', () => {
      const chunk = 'Successfully updated README.md';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();
    });

    test('detects "File X created" pattern', () => {
      const chunk = 'File package.json created successfully';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();
    });

    test('detects "File X modified" pattern', () => {
      const chunk = 'File index.html modified';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();
    });

    test('strips quotes from filename', () => {
      const chunk = 'Writing to `src/main.js`';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'write_file',
        expect.any(String),
        expect.objectContaining({ filename: 'src/main.js' })
      );
    });

    test('strips single quotes from filename', () => {
      const chunk = "Created file 'test/spec.js'";

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'file_modified',
        expect.any(String),
        expect.objectContaining({ filename: 'test/spec.js' })
      );
    });

    test('strips double quotes from filename', () => {
      const chunk = 'Modified file "config/app.yml"';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();
    });

    test('ignores filenames with ellipsis', () => {
      const chunk = 'Writing to src/...';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).not.toHaveBeenCalled();
    });

    test('only emits one event per chunk for file modifications', () => {
      const chunk = `Writing to file1.js
                     Writing to file2.js
                     Writing to file3.js`;

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      // Should only emit once
      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('git commit detection', () => {
    test('detects "git commit" pattern', () => {
      const chunk = 'Running git commit -m "Add feature"';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'git_commit',
        'Committing changes...'
      );
    });

    test('detects "committed changes" pattern', () => {
      const chunk = 'Successfully committed changes';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'git_commit',
        'Committing changes...'
      );
    });

    test('detects "Created commit" pattern', () => {
      const chunk = 'Created commit abc1234';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'git_commit',
        'Committing changes...'
      );
    });

    test('is case insensitive for git commit', () => {
      const chunk = 'GIT COMMIT completed';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'git_commit',
        'Committing changes...'
      );
    });
  });

  describe('test execution detection', () => {
    test('detects "Running tests" pattern', () => {
      const chunk = 'Running tests...';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'tests_running',
        'Running tests...'
      );
    });

    test('detects "running test" pattern', () => {
      const chunk = 'Now running test suite';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'tests_running',
        'Running tests...'
      );
    });

    test('detects "bin/rails test" pattern', () => {
      const chunk = 'Executing bin/rails test';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'tests_running',
        'Running tests...'
      );
    });

    test('detects "npm test" pattern', () => {
      const chunk = 'Running npm test';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'tests_running',
        'Running tests...'
      );
    });

    test('detects "pytest" pattern', () => {
      const chunk = 'Executing pytest tests/';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'tests_running',
        'Running tests...'
      );
    });
  });

  describe('cleanup phase detection', () => {
    test('detects "cleanup" pattern', () => {
      const chunk = 'Starting cleanup process';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'cleanup_started',
        'Cleaning up...'
      );
    });

    test('detects "cleaning up" pattern', () => {
      const chunk = 'Now cleaning up temporary files';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'cleanup_started',
        'Cleaning up...'
      );
    });

    test('detects "removing temporary" pattern', () => {
      const chunk = 'Removing temporary directory';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).toHaveBeenCalledWith(
        123,
        'cleanup_started',
        'Cleaning up...'
      );
    });
  });

  describe('edge cases', () => {
    test('does not emit when no apiClient', () => {
      const chunk = 'Writing to file.js';

      eventDetector.detectAndEmit(chunk, 123, null);

      // Should not throw, just return early
      expect(() => eventDetector.detectAndEmit(chunk, 123, null)).not.toThrow();
    });

    test('does not emit when no jobId', () => {
      const chunk = 'Writing to file.js';

      eventDetector.detectAndEmit(chunk, null, mockApiClient);

      expect(mockApiClient.sendStatusEvent).not.toHaveBeenCalled();
    });

    test('handles event emission errors silently', async () => {
      const logger = require('../src/logger');
      mockApiClient.sendStatusEvent = jest.fn().mockRejectedValue(new Error('API error'));

      const chunk = 'Writing to file.js';

      expect(() => eventDetector.detectAndEmit(chunk, 123, mockApiClient)).not.toThrow();

      // Wait for the promise to be handled
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should log debug message about error
      expect(logger.debug).toHaveBeenCalled();
    });

    test('handles empty chunk', () => {
      const chunk = '';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).not.toHaveBeenCalled();
    });

    test('handles chunk with no matching patterns', () => {
      const chunk = 'Some random output that does not match';

      eventDetector.detectAndEmit(chunk, 123, mockApiClient);

      expect(mockApiClient.sendStatusEvent).not.toHaveBeenCalled();
    });

    test('is case insensitive for all patterns', () => {
      eventDetector.detectAndEmit('RUNNING TESTS...', 123, mockApiClient);
      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();

      mockApiClient.sendStatusEvent.mockClear();

      eventDetector.detectAndEmit('CLEANUP started', 123, mockApiClient);
      expect(mockApiClient.sendStatusEvent).toHaveBeenCalled();
    });
  });
});
