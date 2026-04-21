import { describe, it, expect, vi } from 'vitest';
import { createPullRequest, CreatePullRequestOptions } from './pullRequests.js';
import { githubClient } from './client.js';

// Mock the client module
vi.mock('./client.js', () => ({
  githubClient: {
    pulls: {
      create: vi.fn(),
    },
  },
}));

// Mock the config module
vi.mock('../config/index.js', () => ({
  config: {
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

describe('pullRequests', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createPullRequest', () => {
    it('should create a pull request with required fields only', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: {
          number: 42,
          html_url: 'https://github.com/test-owner/test-repo/pull/42',
        },
      });
      vi.mocked(githubClient.pulls.create).mockImplementation(mockCreate);

      const options: CreatePullRequestOptions = {
        title: 'feat: Add new feature',
        head: 'feature-branch',
        base: 'main',
      };

      const result = await createPullRequest(options);

      expect(githubClient.pulls.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'feat: Add new feature',
        head: 'feature-branch',
        base: 'main',
        body: '',
        draft: false,
      });
      expect(result).toEqual({
        number: 42,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/42',
      });
    });

    it('should create a pull request with all options', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: {
          number: 15,
          html_url: 'https://github.com/test-owner/test-repo/pull/15',
        },
      });
      vi.mocked(githubClient.pulls.create).mockImplementation(mockCreate);

      const options: CreatePullRequestOptions = {
        title: 'feat: Comprehensive feature',
        head: 'feature/comprehensive',
        base: 'develop',
        body: 'This PR adds a comprehensive feature with tests.',
        draft: true,
      };

      const result = await createPullRequest(options);

      expect(githubClient.pulls.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'feat: Comprehensive feature',
        head: 'feature/comprehensive',
        base: 'develop',
        body: 'This PR adds a comprehensive feature with tests.',
        draft: true,
      });
      expect(result).toEqual({
        number: 15,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/15',
      });
    });

    it('should create a pull request with draft set to false explicitly', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: {
          number: 100,
          html_url: 'https://github.com/test-owner/test-repo/pull/100',
        },
      });
      vi.mocked(githubClient.pulls.create).mockImplementation(mockCreate);

      const options: CreatePullRequestOptions = {
        title: 'WIP: Work in progress',
        head: 'wip-branch',
        base: 'main',
        draft: false,
      };

      await createPullRequest(options);

      expect(githubClient.pulls.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'WIP: Work in progress',
        head: 'wip-branch',
        base: 'main',
        body: '',
        draft: false,
      });
    });

    it('should handle pull request with empty body', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: {
          number: 7,
          html_url: 'https://github.com/test-owner/test-repo/pull/7',
        },
      });
      vi.mocked(githubClient.pulls.create).mockImplementation(mockCreate);

      const options: CreatePullRequestOptions = {
        title: 'Simple PR',
        head: 'simple-branch',
        base: 'main',
        body: '',
      };

      await createPullRequest(options);

      expect(githubClient.pulls.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Simple PR',
        head: 'simple-branch',
        base: 'main',
        body: '',
        draft: false,
      });
    });
  });

  describe('CreatePullRequestOptions interface', () => {
    it('should accept all options', () => {
      const options: CreatePullRequestOptions = {
        title: 'Test PR',
        head: 'test-branch',
        base: 'main',
        body: 'PR description',
        draft: true,
      };

      expect(options.title).toBe('Test PR');
      expect(options.head).toBe('test-branch');
      expect(options.base).toBe('main');
      expect(options.body).toBe('PR description');
      expect(options.draft).toBe(true);
    });

    it('should accept required fields only', () => {
      const options: CreatePullRequestOptions = {
        title: 'Minimal PR',
        head: 'minimal-branch',
        base: 'main',
      };

      expect(options.title).toBe('Minimal PR');
      expect(options.head).toBe('minimal-branch');
      expect(options.base).toBe('main');
      expect(options.body).toBeUndefined();
      expect(options.draft).toBeUndefined();
    });
  });
});
