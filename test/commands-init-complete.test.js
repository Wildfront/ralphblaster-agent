jest.mock('../src/config-file-manager');
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const InitCommand = require('../src/commands/init');
const ConfigFileManager = require('../src/config-file-manager');

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

// Mock console methods
global.console = {
  log: jest.fn(),
  error: jest.fn()
};

describe('InitCommand - Save Credentials', () => {
  let initCommand;
  let mockConfigFileManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();

    // Set test environment variables
    process.env.RALPHBLASTER_API_TOKEN = 'test-token-123';
    process.env.RALPHBLASTER_API_URL = 'https://test-api.com';

    mockConfigFileManager = {
      update: jest.fn(),
      read: jest.fn().mockReturnValue({}),
      write: jest.fn()
    };

    ConfigFileManager.mockImplementation(() => mockConfigFileManager);
    initCommand = new InitCommand();
  });

  afterEach(() => {
    delete process.env.RALPHBLASTER_API_TOKEN;
    delete process.env.RALPHBLASTER_API_URL;
  });

  describe('run()', () => {
    test('saves API token to config file', async () => {
      const logger = require('../src/logger');

      await initCommand.run();

      expect(logger.info).toHaveBeenCalledWith('Initializing RalphBlaster credentials...');
      expect(mockConfigFileManager.update).toHaveBeenCalledWith({
        apiToken: 'test-token-123',
        apiUrl: 'https://test-api.com'
      });
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    test('uses default API URL when not provided', async () => {
      delete process.env.RALPHBLASTER_API_URL;

      await initCommand.run();

      expect(mockConfigFileManager.update).toHaveBeenCalledWith({
        apiToken: 'test-token-123',
        apiUrl: 'https://hq.ralphblaster.com'
      });
    });

    test('throws error when no API token provided', async () => {
      delete process.env.RALPHBLASTER_API_TOKEN;
      initCommand.handleError = jest.fn();

      await initCommand.run();

      expect(initCommand.handleError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No API token provided')
        })
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    test('displays success message with API URL', async () => {
      initCommand.displaySuccess = jest.fn();

      await initCommand.run();

      expect(initCommand.displaySuccess).toHaveBeenCalledWith('https://test-api.com');
    });

    test('handles config file write errors', async () => {
      mockConfigFileManager.update.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      initCommand.handleError = jest.fn();

      await initCommand.run();

      expect(initCommand.handleError).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('displaySuccess()', () => {
    test('displays success message with next steps', () => {
      const logger = require('../src/logger');

      initCommand.displaySuccess('https://hq.ralphblaster.com');

      expect(logger.info).toHaveBeenCalledWith('Credentials saved successfully!');
      expect(logger.info).toHaveBeenCalledWith('API URL: https://hq.ralphblaster.com');
      expect(logger.info).toHaveBeenCalledWith('Config saved to ~/.ralphblasterrc');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ralphblaster add-project'));
    });
  });

  describe('handleError()', () => {
    test('logs error and provides helpful guidance', () => {
      const logger = require('../src/logger');
      const error = new Error('No API token provided');

      initCommand.handleError(error);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save credentials: No API token provided'
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Please provide your API token:')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ralphblaster init --token=your_token_here')
      );
    });

    test('handles generic errors', () => {
      const logger = require('../src/logger');
      const error = new Error('Some other error');

      initCommand.handleError(error);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save credentials: Some other error'
      );
    });
  });
});
