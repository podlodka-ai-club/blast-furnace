import { describe, it, expect, vi } from 'vitest';
import { fetchIssues, IssueFilters } from './issues.js';
import { githubClient } from './client.js';

// Mock the client module
vi.mock('./client.js', () => ({
  githubClient: {
    issues: {
      listForRepo: vi.fn(),
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

describe('issues', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('fetchIssues', () => {
    it('should fetch issues with default filters (open state)', async () => {
      const mockIssues = [
        {
          id: 1,
          number: 42,
          title: 'Test Issue',
          body: 'Issue body content',
          state: 'open',
          labels: [{ name: 'bug' }, { name: 'priority' }],
          assignee: { login: 'testuser' },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ];

      const mockListForRepo = vi.fn().mockResolvedValue({ data: mockIssues });
      vi.mocked(githubClient.issues.listForRepo).mockImplementation(mockListForRepo);

      const result = await fetchIssues();

      expect(githubClient.issues.listForRepo).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        labels: undefined,
        state: 'open',
        assignee: undefined,
        since: undefined,
        milestone: undefined,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        number: 42,
        title: 'Test Issue',
        body: 'Issue body content',
        state: 'open',
        labels: ['bug', 'priority'],
        assignee: 'testuser',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      });
    });

    it('should fetch issues with custom filters', async () => {
      const mockIssues = [] as Array<{
        id: number;
        number: number;
        title: string;
        body: string | null;
        state: string;
        labels: Array<{ name: string } | string>;
        assignee: { login: string } | null;
        created_at: string;
        updated_at: string;
      }>;
      const mockListForRepo = vi.fn().mockResolvedValue({ data: mockIssues });
      vi.mocked(githubClient.issues.listForRepo).mockImplementation(mockListForRepo);

      const filters: IssueFilters = {
        labels: 'bug,help-wanted',
        state: 'all',
        assignee: 'anotheruser',
        since: '2024-01-01T00:00:00Z',
        milestone: 5,
      };

      await fetchIssues(filters);

      expect(githubClient.issues.listForRepo).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        labels: 'bug,help-wanted',
        state: 'all',
        assignee: 'anotheruser',
        since: '2024-01-01T00:00:00.000Z',
        milestone: '5',
      });
    });

    it('should map GitHub API labels correctly when labels are strings', async () => {
      const mockIssues = [
        {
          id: 2,
          number: 43,
          title: 'Another Issue',
          body: null,
          state: 'closed',
          labels: ['simple-label'],
          assignee: null,
          created_at: '2024-02-01T00:00:00Z',
          updated_at: '2024-02-02T00:00:00Z',
        },
      ];

      const mockListForRepo = vi.fn().mockResolvedValue({ data: mockIssues });
      vi.mocked(githubClient.issues.listForRepo).mockImplementation(mockListForRepo);

      const result = await fetchIssues({ state: 'closed' });

      expect(result[0].labels).toEqual(['simple-label']);
      expect(result[0].assignee).toBeNull();
      expect(result[0].state).toBe('closed');
    });

    it('should return empty array when no issues found', async () => {
      const mockListForRepo = vi.fn().mockResolvedValue({ data: [] });
      vi.mocked(githubClient.issues.listForRepo).mockImplementation(mockListForRepo);

      const result = await fetchIssues();

      expect(result).toEqual([]);
    });
  });

  describe('IssueFilters interface', () => {
    it('should accept all filter options', () => {
      const filters: IssueFilters = {
        labels: 'bug',
        state: 'open',
        assignee: 'user',
        since: '2024-01-01T00:00:00Z',
        milestone: 1,
      };

      expect(filters.labels).toBe('bug');
      expect(filters.state).toBe('open');
      expect(filters.assignee).toBe('user');
      expect(filters.since).toBe('2024-01-01T00:00:00Z');
      expect(filters.milestone).toBe(1);
    });

    it('should accept partial filter options', () => {
      const filters: IssueFilters = {
        labels: 'help-wanted',
      };

      expect(filters.labels).toBe('help-wanted');
      expect(filters.state).toBeUndefined();
    });
  });
});
