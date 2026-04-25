import { describe, it, expect, vi } from 'vitest';
import * as github from './index.js';

// Mock the client module
vi.mock('./client.js', () => ({
  githubClient: {
    issues: {
      listForRepo: vi.fn(),
      listLabelsOnIssue: vi.fn(),
      setLabels: vi.fn(),
    },
    git: {
      createRef: vi.fn(),
      getRef: vi.fn(),
    },
    pulls: {
      create: vi.fn(),
    },
  },
  createGitHubClient: vi.fn(),
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

describe('GitHub module exports', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('client exports', () => {
    it('should export githubClient', () => {
      expect(github.githubClient).toBeDefined();
    });

    it('should export createGitHubClient', () => {
      expect(typeof github.createGitHubClient).toBe('function');
    });

    // GitHubClient is a type-only export (export type), verified by TypeScript compiler
  });

  describe('issues exports', () => {
    it('should export fetchIssues', () => {
      expect(typeof github.fetchIssues).toBe('function');
    });

    it('should export moveIssueToInReview', () => {
      expect(typeof github.moveIssueToInReview).toBe('function');
    });

    it('should export IssueFilters interface', () => {
      // Interface exists as a type
      const filters: github.IssueFilters = {
        labels: 'bug',
        state: 'open',
      };
      expect(filters.labels).toBe('bug');
    });

    it('should export review label constants', () => {
      expect(github.READY_LABEL).toBe('ready');
      expect(github.IN_REVIEW_LABEL).toBe('in review');
    });
  });

  describe('branches exports', () => {
    it('should export pushBranch', () => {
      expect(typeof github.pushBranch).toBe('function');
    });

    it('should export getRef', () => {
      expect(typeof github.getRef).toBe('function');
    });
  });

  describe('pull requests exports', () => {
    it('should export createPullRequest', () => {
      expect(typeof github.createPullRequest).toBe('function');
    });

    it('should export CreatePullRequestOptions interface', () => {
      const options: github.CreatePullRequestOptions = {
        title: 'Test PR',
        head: 'feature-branch',
        base: 'main',
      };
      expect(options.title).toBe('Test PR');
    });

    it('should export PullRequestResponse interface', () => {
      const response: github.PullRequestResponse = {
        number: 42,
        htmlUrl: 'https://github.com/owner/repo/pull/42',
      };
      expect(response.number).toBe(42);
    });
  });

  describe('types exports', () => {
    it('should export GitRef type', () => {
      const ref: github.GitRef = {
        ref: 'refs/heads/main',
        nodeId: 'MDM6UmVmcmVmcy9oZWFkcy9tYWlu',
        object: {
          sha: 'abc123',
          type: 'commit',
          url: 'https://api.github.com/repos/owner/repo/git/commits/abc123',
        },
      };
      expect(ref.ref).toBe('refs/heads/main');
    });

    it('should export BranchRefResponse type', () => {
      const response: github.BranchRefResponse = {
        ref: 'refs/heads/feature',
        nodeId: 'MDM6UmVm',
        object: {
          sha: 'def456',
          type: 'commit',
          url: 'https://api.github.com/repos/owner/repo/git/commits/def456',
        },
      };
      expect(response.ref).toBe('refs/heads/feature');
    });

    it('should export PullRequest type', () => {
      const pr: github.PullRequest = {
        id: 1,
        number: 42,
        title: 'Test PR',
        body: 'PR description',
        state: 'open',
        htmlUrl: 'https://github.com/owner/repo/pull/42',
        user: {
          login: 'testuser',
          id: 123,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        closedAt: null,
        mergedAt: null,
        draft: false,
      };
      expect(pr.title).toBe('Test PR');
    });
  });
});
