const Executor = require('../src/executor');

jest.mock('../src/config', () => ({
  apiUrl: 'https://test-api.com',
  apiToken: 'test-token',
  maxRetries: 3,
  logLevel: 'error'
}));

describe('Executor Prompt Builders', () => {
  let executor;

  beforeEach(() => {
    executor = new Executor();
  });

  describe('buildPrdPrompt()', () => {
    test('builds basic PRD prompt with task title only', () => {
      const job = {
        task_title: 'Add user authentication'
      };

      const prompt = executor.buildPrdPrompt(job);

      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Product Requirements Document');
      expect(prompt).toContain('Overview');
      expect(prompt).toContain('User Stories');
      expect(prompt).toContain('Functional Requirements');
      expect(prompt).toContain('Technical Requirements');
      expect(prompt).toContain('Success Metrics');
      expect(prompt).toContain('Out of Scope');
      expect(prompt).toContain('markdown');
    });

    test('includes task description when provided', () => {
      const job = {
        task_title: 'Add user authentication',
        task_description: 'Users should be able to sign up and log in using email and password'
      };

      const prompt = executor.buildPrdPrompt(job);

      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Users should be able to sign up and log in using email and password');
      expect(prompt).toContain('Description:');
    });

    test('excludes task description section when not provided', () => {
      const job = {
        task_title: 'Add user authentication'
      };

      const prompt = executor.buildPrdPrompt(job);

      expect(prompt).not.toContain('Description:');
    });

    test('includes project name when provided', () => {
      const job = {
        task_title: 'Add user authentication',
        project: {
          name: 'E-commerce Platform',
          system_path: '/path/to/project'
        }
      };

      const prompt = executor.buildPrdPrompt(job);

      expect(prompt).toContain('E-commerce Platform');
      expect(prompt).toContain('Project:');
    });

    test('excludes project section when not provided', () => {
      const job = {
        task_title: 'Add user authentication'
      };

      const prompt = executor.buildPrdPrompt(job);

      expect(prompt).not.toContain('Project:');
    });

    test('excludes project section when project exists but has no name', () => {
      const job = {
        task_title: 'Add user authentication',
        project: {
          system_path: '/path/to/project'
        }
      };

      const prompt = executor.buildPrdPrompt(job);

      expect(prompt).not.toContain('Project:');
    });

    test('builds complete prompt with all optional fields', () => {
      const job = {
        task_title: 'Add payment processing',
        task_description: 'Integrate Stripe for credit card payments',
        project: {
          name: 'Online Store',
          system_path: '/path/to/store'
        }
      };

      const prompt = executor.buildPrdPrompt(job);

      expect(prompt).toContain('Add payment processing');
      expect(prompt).toContain('Integrate Stripe for credit card payments');
      expect(prompt).toContain('Online Store');
      expect(prompt).toContain('Product Requirements Document');
    });
  });

  describe('buildCodePrompt()', () => {
    test('builds basic code prompt with task title only', () => {
      const job = {
        task_title: 'Add user authentication',
        project: {
          system_path: '/path/to/project'
        }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).toContain('Ralph');
      expect(prompt).toContain('autonomous coding agent');
      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('/path/to/project');
      expect(prompt).toContain('Create a new git branch');
      expect(prompt).toContain('Implement all requirements');
      expect(prompt).toContain('Write tests');
      expect(prompt).toContain('RALPH_SUMMARY:');
      expect(prompt).toContain('RALPH_BRANCH:');
    });

    test('includes task description when provided', () => {
      const job = {
        task_title: 'Add user authentication',
        task_description: 'Implement JWT-based authentication',
        project: {
          system_path: '/path/to/project'
        }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).toContain('Implement JWT-based authentication');
      expect(prompt).toContain('## Description');
    });

    test('excludes description section when not provided', () => {
      const job = {
        task_title: 'Add user authentication',
        project: {
          system_path: '/path/to/project'
        }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).not.toContain('## Description');
    });

    test('includes PRD content when provided', () => {
      const job = {
        task_title: 'Add user authentication',
        prd_content: '# Authentication PRD\n\nUsers must be able to sign up...',
        project: {
          system_path: '/path/to/project'
        }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).toContain('# Authentication PRD');
      expect(prompt).toContain('Users must be able to sign up');
      expect(prompt).toContain('## Product Requirements Document');
    });

    test('excludes PRD section when not provided', () => {
      const job = {
        task_title: 'Add user authentication',
        project: {
          system_path: '/path/to/project'
        }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).not.toContain('## Product Requirements Document');
    });

    test('includes project path in instructions', () => {
      const job = {
        task_title: 'Add feature',
        project: {
          system_path: '/Users/dev/my-app'
        }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).toContain('/Users/dev/my-app');
      expect(prompt).toContain('Work in the project directory');
    });

    test('builds complete prompt with all optional fields', () => {
      const job = {
        task_title: 'Implement shopping cart',
        task_description: 'Users can add items to cart and checkout',
        prd_content: '# Shopping Cart PRD\n\n## Features\n- Add to cart\n- Remove from cart',
        project: {
          name: 'E-commerce Site',
          system_path: '/path/to/ecommerce'
        }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).toContain('Implement shopping cart');
      expect(prompt).toContain('Users can add items to cart and checkout');
      expect(prompt).toContain('# Shopping Cart PRD');
      expect(prompt).toContain('/path/to/ecommerce');
      expect(prompt).toContain('Ralph');
    });

    test('includes all required instruction sections', () => {
      const job = {
        task_title: 'Test task',
        project: { system_path: '/test' }
      };

      const prompt = executor.buildCodePrompt(job);

      expect(prompt).toContain('## Instructions');
      expect(prompt).toContain('Create a new git branch');
      expect(prompt).toContain('Implement all requirements from the PRD');
      expect(prompt).toContain('Write tests for your changes');
      expect(prompt).toContain('Ensure all tests pass');
      expect(prompt).toContain('RALPH_SUMMARY:');
      expect(prompt).toContain('RALPH_BRANCH:');
      expect(prompt).toContain('Begin implementation now');
    });
  });
});
