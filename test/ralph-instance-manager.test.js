const fs = require('fs').promises;
const path = require('path');

// Create a mock for execAsync before requiring the manager
const mockExecAsync = jest.fn();

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    copyFile: jest.fn(),
    chmod: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    access: jest.fn(),
    unlink: jest.fn()
  }
}));

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

// Mock util to return our mockExecAsync
jest.mock('util', () => ({
  promisify: jest.fn(() => mockExecAsync)
}));

// Now require the manager after mocks are set up
const RalphInstanceManager = require('../src/ralph-instance-manager');

describe('RalphInstanceManager', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new RalphInstanceManager();
  });

  describe('createInstance()', () => {
    test('creates instance directory with all required files', async () => {
      const worktreePath = '/test/worktree';
      const prompt = '# Test PRD\n\nImplement feature X';
      const jobId = 'job-123';

      // Mock file operations
      fs.mkdir.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.chmod.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify({
        branchName: 'ralph/test-feature',
        userStories: [{ id: 1, title: 'Test story' }]
      }));
      fs.unlink.mockResolvedValue();

      // Mock exec for PRD conversion
      mockExecAsync.mockResolvedValue({ stdout: 'prd.json created', stderr: '' });

      const instancePath = await manager.createInstance(worktreePath, prompt, jobId);

      // Verify instance directory created
      expect(instancePath).toBe(path.join(worktreePath, 'ralph-instance'));
      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(worktreePath, 'ralph-instance'),
        { recursive: true }
      );

      // Verify ralph.sh and prompt.md copied
      expect(fs.copyFile).toHaveBeenCalledTimes(2);

      // Verify ralph.sh made executable
      expect(fs.chmod).toHaveBeenCalledWith(
        path.join(worktreePath, 'ralph-instance', 'ralph.sh'),
        0o755
      );

      // Verify progress.txt initialized
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(worktreePath, 'ralph-instance', 'progress.txt'),
        expect.stringContaining(`# Ralph Progress Log - Job ${jobId}`)
      );
    });
  });

  describe('convertPrdToJson()', () => {
    test('successfully converts PRD using claude /ralph', async () => {
      const instancePath = '/test/instance';
      const prompt = '# Feature PRD\n\nImplement user authentication';

      fs.writeFile.mockResolvedValue();
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify({
        branchName: 'ralph/auth-feature',
        userStories: [
          { id: 1, title: 'Login form', priority: 1 }
        ]
      }));
      fs.unlink.mockResolvedValue();

      mockExecAsync.mockResolvedValue({ stdout: 'Conversion successful', stderr: '' });

      await expect(manager.convertPrdToJson(instancePath, prompt))
        .resolves.not.toThrow();

      // Verify temporary prompt file was written
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(instancePath, 'input-prd.md'),
        prompt
      );

      // Verify prd.json was validated
      expect(fs.access).toHaveBeenCalledWith(
        path.join(instancePath, 'prd.json')
      );
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(instancePath, 'prd.json'),
        'utf8'
      );

      // Verify cleanup of temporary file
      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(instancePath, 'input-prd.md')
      );
    });

    test('throws error if prd.json is missing branchName', async () => {
      const instancePath = '/test/instance';
      const prompt = 'Test prompt';

      fs.writeFile.mockResolvedValue();
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify({
        userStories: [] // Missing branchName
      }));
      fs.unlink.mockResolvedValue();

      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await expect(manager.convertPrdToJson(instancePath, prompt))
        .rejects.toThrow('Invalid prd.json structure');
    });

    test('throws error if prd.json is missing userStories', async () => {
      const instancePath = '/test/instance';
      const prompt = 'Test prompt';

      fs.writeFile.mockResolvedValue();
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify({
        branchName: 'ralph/test' // Missing userStories
      }));
      fs.unlink.mockResolvedValue();

      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await expect(manager.convertPrdToJson(instancePath, prompt))
        .rejects.toThrow('Invalid prd.json structure');
    });

    test('throws error if claude /ralph command fails', async () => {
      const instancePath = '/test/instance';
      const prompt = 'Test prompt';

      fs.writeFile.mockResolvedValue();
      fs.unlink.mockResolvedValue();

      mockExecAsync.mockRejectedValue(new Error('Command failed'));

      await expect(manager.convertPrdToJson(instancePath, prompt))
        .rejects.toThrow('Failed to convert PRD to JSON');
    });
  });

  describe('getEnvVars()', () => {
    test('returns correct environment variables', () => {
      const worktreePath = '/test/worktree';
      const instancePath = '/test/instance';
      const mainRepoPath = '/test/repo';

      const envVars = manager.getEnvVars(worktreePath, instancePath, mainRepoPath);

      expect(envVars).toMatchObject({
        RALPH_WORKTREE_PATH: worktreePath,
        RALPH_INSTANCE_DIR: instancePath,
        RALPH_MAIN_REPO: mainRepoPath
      });

      // Should also include all existing process.env variables
      expect(envVars.PATH).toBeDefined();
    });
  });

  describe('readProgressSummary()', () => {
    test('extracts summary from progress.txt', async () => {
      const instancePath = '/test/instance';
      const progressContent = `# Ralph Progress Log
Started: 2024-01-20T10:00:00Z
---

Story 1: Implemented login form
- Added form component
- Added validation

Story 2: Added authentication
- Integrated JWT tokens
`;

      fs.readFile.mockResolvedValue(progressContent);

      const summary = await manager.readProgressSummary(instancePath);

      expect(summary).toContain('Story 1: Implemented login form');
      expect(summary).toContain('Story 2: Added authentication');
      expect(summary).not.toContain('# Ralph Progress Log');
      expect(summary).not.toContain('Started:');
    });

    test('returns message when progress file is empty', async () => {
      const instancePath = '/test/instance';
      fs.readFile.mockResolvedValue('# Ralph Progress Log\nStarted: 2024-01-20\n---\n\n');

      const summary = await manager.readProgressSummary(instancePath);

      expect(summary).toBe('No progress recorded yet');
    });

    test('handles file read errors gracefully', async () => {
      const instancePath = '/test/instance';
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const summary = await manager.readProgressSummary(instancePath);

      expect(summary).toContain('Failed to read progress');
    });
  });

  describe('hasCompletionSignal()', () => {
    test('detects completion signal in output', () => {
      const output = `
        Some output here
        <promise>COMPLETE</promise>
        More output
      `;

      expect(manager.hasCompletionSignal(output)).toBe(true);
    });

    test('returns false when no completion signal', () => {
      const output = 'Just regular output without completion signal';

      expect(manager.hasCompletionSignal(output)).toBe(false);
    });
  });

  describe('getBranchName()', () => {
    test('extracts branch name from prd.json', async () => {
      const instancePath = '/test/instance';
      const prdContent = JSON.stringify({
        branchName: 'ralph/my-feature',
        userStories: []
      });

      fs.readFile.mockResolvedValue(prdContent);

      const branchName = await manager.getBranchName(instancePath);

      expect(branchName).toBe('ralph/my-feature');
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(instancePath, 'prd.json'),
        'utf8'
      );
    });

    test('returns null if prd.json is missing branchName', async () => {
      const instancePath = '/test/instance';
      fs.readFile.mockResolvedValue(JSON.stringify({ userStories: [] }));

      const branchName = await manager.getBranchName(instancePath);

      expect(branchName).toBeNull();
    });

    test('returns null if prd.json cannot be read', async () => {
      const instancePath = '/test/instance';
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const branchName = await manager.getBranchName(instancePath);

      expect(branchName).toBeNull();
    });
  });
});
