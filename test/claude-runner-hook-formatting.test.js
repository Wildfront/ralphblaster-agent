const ClaudeRunner = require('../src/executor/claude-runner');

describe('ClaudeRunner - Hook Event Formatting', () => {
  let claudeRunner;

  beforeEach(() => {
    // Create instance with minimal dependencies
    const mockErrorHandler = {};
    const mockEventDetector = {};
    const mockGitHelper = {};
    claudeRunner = new ClaudeRunner(mockErrorHandler, mockEventDetector, mockGitHelper);
  });

  describe('formatEventForUI', () => {
    it('should format hook_started events', () => {
      const event = {
        type: 'system',
        subtype: 'hook_started',
        hook_name: 'SessionStart:startup',
        hook_event: 'SessionStart'
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBe('Hook started: SessionStart:startup');
    });

    it('should format hook_response success events', () => {
      const event = {
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'SessionStart:startup',
        outcome: 'success',
        exit_code: 0
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBe('Hook completed: SessionStart:startup (exit code 0)');
    });

    it('should format hook_response failure events with stderr', () => {
      const event = {
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'SessionStart:startup',
        outcome: 'failure',
        exit_code: 1,
        stderr: 'Command not found: some-command\nAdditional error details'
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBe('Hook failed: SessionStart:startup (exit code 1) - Command not found: some-command');
    });

    it('should format hook_response failure events without stderr', () => {
      const event = {
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'SessionStart:startup',
        outcome: 'failure',
        exit_code: 1
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBe('Hook failed: SessionStart:startup (exit code 1)');
    });

    it('should truncate long stderr messages', () => {
      const longError = 'A'.repeat(150);
      const event = {
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'SessionStart:startup',
        outcome: 'failure',
        exit_code: 1,
        stderr: longError
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result.length).toBeLessThanOrEqual('Hook failed: SessionStart:startup (exit code 1) - '.length + 100);
      expect(result).toContain('Hook failed: SessionStart:startup (exit code 1) - ');
    });

    it('should handle missing hook_name field', () => {
      const event = {
        type: 'system',
        subtype: 'hook_started',
        hook_event: 'SessionStart'
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBe('Hook started: unknown');
    });

    it('should handle missing exit_code field', () => {
      const event = {
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'SessionStart:startup',
        outcome: 'success'
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBe('Hook completed: SessionStart:startup (exit code 0)');
    });

    it('should handle missing outcome field', () => {
      const event = {
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'SessionStart:startup',
        exit_code: 0
      };

      const result = claudeRunner.formatEventForUI(event);
      // When outcome is missing or 'unknown', it won't match 'success', so should go to else branch
      expect(result).toContain('Hook failed: SessionStart:startup (exit code 0)');
    });

    it('should return null for non-hook system events', () => {
      const event = {
        type: 'system',
        subtype: 'init',
        model: 'claude-3-5-sonnet'
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBeNull();
    });

    it('should return null for assistant events', () => {
      const event = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: 'Hello, how can I help you?'
            }
          ]
        }
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBeNull();
    });

    it('should return null for result events', () => {
      const event = {
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        num_turns: 3,
        total_cost_usd: 0.0025
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBeNull();
    });

    it('should handle stderr with only first line extracted', () => {
      const event = {
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'SessionStart:startup',
        outcome: 'failure',
        exit_code: 1,
        stderr: 'First line of error\nSecond line of error\nThird line of error'
      };

      const result = claudeRunner.formatEventForUI(event);
      expect(result).toBe('Hook failed: SessionStart:startup (exit code 1) - First line of error');
      expect(result).not.toContain('Second line');
    });
  });
});
