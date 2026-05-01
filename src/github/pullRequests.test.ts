import { describe, it, expect, vi } from 'vitest';
import {
  createPullRequest,
  CreatePullRequestOptions,
  getPullRequestState,
  listPullRequestComments,
  listPullRequestReviewComments,
  removeReworkLabelFromPullRequest,
} from './pullRequests.js';
import { githubClient } from './client.js';

// Mock the client module
vi.mock('./client.js', () => ({
  githubClient: {
    pulls: {
      create: vi.fn(),
      get: vi.fn(),
      listReviewComments: vi.fn(),
    },
    issues: {
      removeLabel: vi.fn(),
      listComments: vi.fn(),
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

  describe('createPullRequest validation', () => {
    it('should throw for empty title', async () => {
      await expect(createPullRequest({
        title: '',
        head: 'feature-branch',
        base: 'main',
      })).rejects.toThrow('PR title, head, and base must be non-empty');
    });

    it('should throw for whitespace-only title', async () => {
      await expect(createPullRequest({
        title: '   ',
        head: 'feature-branch',
        base: 'main',
      })).rejects.toThrow('PR title, head, and base must be non-empty');
    });

    it('should throw for empty head', async () => {
      await expect(createPullRequest({
        title: 'Valid title',
        head: '',
        base: 'main',
      })).rejects.toThrow('PR title, head, and base must be non-empty');
    });

    it('should throw for whitespace-only head', async () => {
      await expect(createPullRequest({
        title: 'Valid title',
        head: '   ',
        base: 'main',
      })).rejects.toThrow('PR title, head, and base must be non-empty');
    });

    it('should throw for empty base', async () => {
      await expect(createPullRequest({
        title: 'Valid title',
        head: 'feature-branch',
        base: '',
      })).rejects.toThrow('PR title, head, and base must be non-empty');
    });

    it('should throw for whitespace-only base', async () => {
      await expect(createPullRequest({
        title: 'Valid title',
        head: 'feature-branch',
        base: '   ',
      })).rejects.toThrow('PR title, head, and base must be non-empty');
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

  describe('pull request rework helpers', () => {
    it('reads pull request lifecycle, head, label, and URL state from the configured repository', async () => {
      vi.mocked(githubClient.pulls.get).mockResolvedValue({
        data: {
          number: 7,
          state: 'open',
          merged: false,
          html_url: 'https://github.com/test-owner/test-repo/pull/7',
          head: {
            ref: 'issue-42-test-issue',
            sha: 'abc123',
            repo: {
              owner: { login: 'test-owner' },
              name: 'test-repo',
              full_name: 'test-owner/test-repo',
            },
          },
          labels: [
            { name: 'Rework' },
            { name: 'bug' },
          ],
        },
      } as Awaited<ReturnType<typeof githubClient.pulls.get>>);

      await expect(getPullRequestState(7)).resolves.toEqual({
        number: 7,
        state: 'open',
        merged: false,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
        head: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'issue-42-test-issue',
          sha: 'abc123',
        },
        labels: ['Rework', 'bug'],
      });
      expect(githubClient.pulls.get).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 7,
      });
    });

    it('removes the Rework label from a pull request issue idempotently', async () => {
      vi.mocked(githubClient.issues.removeLabel).mockResolvedValue({
        data: [],
      } as Awaited<ReturnType<typeof githubClient.issues.removeLabel>>);

      await expect(removeReworkLabelFromPullRequest(7)).resolves.toBeUndefined();
      expect(githubClient.issues.removeLabel).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 7,
        name: 'Rework',
      });

      vi.mocked(githubClient.issues.removeLabel).mockRejectedValueOnce(Object.assign(new Error('Not Found'), {
        status: 404,
      }));

      await expect(removeReworkLabelFromPullRequest(7)).resolves.toBeUndefined();
    });

    it('lists pull request review comments with author, location, and visibility metadata', async () => {
      vi.mocked(githubClient.pulls.listReviewComments).mockResolvedValue({
        data: [
          {
            id: 123,
            body: 'Please update this line.',
            created_at: '2026-04-30T10:00:00.000Z',
            path: 'src/file.ts',
            line: 12,
            original_line: 10,
            outdated: false,
            user: {
              login: 'reviewer',
              type: 'User',
            },
            pull_request_review_id: 999,
          },
        ],
      } as Awaited<ReturnType<typeof githubClient.pulls.listReviewComments>>);

      await expect(listPullRequestReviewComments(7)).resolves.toEqual([
        {
          id: 123,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Please update this line.',
          createdAt: '2026-04-30T10:00:00.000Z',
          path: 'src/file.ts',
          line: 12,
          originalLine: 10,
          outdated: false,
          resolved: false,
          deleted: false,
        },
      ]);
      expect(githubClient.pulls.listReviewComments).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 7,
      });
    });

    it('lists pull request-level comments with author metadata', async () => {
      vi.mocked(githubClient.issues.listComments).mockResolvedValue({
        data: [
          {
            id: 456,
            body: 'PR-level feedback.',
            created_at: '2026-04-30T10:05:00.000Z',
            user: {
              login: 'reviewer',
              type: 'User',
            },
          },
        ],
      } as Awaited<ReturnType<typeof githubClient.issues.listComments>>);

      await expect(listPullRequestComments(7)).resolves.toEqual([
        {
          id: 456,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'PR-level feedback.',
          createdAt: '2026-04-30T10:05:00.000Z',
        },
      ]);
      expect(githubClient.issues.listComments).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 7,
      });
    });
  });
});
