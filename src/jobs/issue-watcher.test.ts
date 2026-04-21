import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { IssueWatcherJobData } from '../types/index.js';

// Use vi.hoisted to avoid hoisting issues with vi.mock
const { mockFetchIssues, mockJobQueueAdd } = vi.hoisted(() => ({
  mockFetchIssues: vi.fn(),
  mockJobQueueAdd: vi.fn(),
}));

// Mock the GitHub issues module
vi.mock('../github/issues.js', () => ({
  fetchIssues: mockFetchIssues,
}));

// Mock the queue module
vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

// Mock the config
vi.mock('../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
    },
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      issueStrategy: 'polling',
      pollIntervalMs: 60000,
    },
  },
}));

describe('issue watcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockJobQueueAdd.mockResolvedValue({ id: 'new-job-id' });
  });

  describe('startIssueWatcher', () => {
    it('should add a repeatable job to the queue', async () => {
      const { startIssueWatcher } = await import('./issue-watcher.js');

      await startIssueWatcher();

      expect(mockJobQueueAdd).toHaveBeenCalledWith(
        'issue-watcher',
        expect.objectContaining({
          taskId: expect.stringContaining('issue-watcher-'),
          type: 'issue-watcher',
          lastPollTimestamp: undefined,
        }),
        expect.objectContaining({
          repeat: {
            every: 60000,
          },
          jobId: 'issue-watcher-repeatable',
        })
      );
    });

    it('should use pollIntervalMs from config', async () => {
      const { startIssueWatcher } = await import('./issue-watcher.js');

      await startIssueWatcher();

      expect(mockJobQueueAdd).toHaveBeenCalledWith(
        'issue-watcher',
        expect.any(Object),
        expect.objectContaining({
          repeat: {
            every: 60000,
          },
        })
      );
    });
  });

  describe('issueWatcherHandler', () => {
    const createMockJob = (lastPollTimestamp?: string): Job<IssueWatcherJobData> => {
      return {
        id: 'watcher-job-123',
        data: {
          taskId: 'watcher-task-456',
          type: 'issue-watcher',
          lastPollTimestamp,
        },
      } as unknown as Job<IssueWatcherJobData>;
    };

    it('should fetch open issues without since filter on first run', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      mockFetchIssues.mockResolvedValue([]);

      const mockJob = createMockJob(undefined);
      await issueWatcherHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledWith({
        state: 'open',
        since: undefined,
      });
    });

    it('should fetch open issues with since filter when lastPollTimestamp is set', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      mockFetchIssues.mockResolvedValue([]);

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledWith({
        state: 'open',
        since: '2024-01-01T00:00:00Z',
      });
    });

    it('should add IssueProcessorJobData job for each new issue', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      const mockIssues = [
        {
          id: 1,
          number: 42,
          title: 'Issue 1',
          body: 'Body 1',
          state: 'open' as const,
          labels: [],
          assignee: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          number: 43,
          title: 'Issue 2',
          body: 'Body 2',
          state: 'open' as const,
          labels: ['bug'],
          assignee: null,
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ];

      mockFetchIssues.mockResolvedValue(mockIssues);

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      expect(mockJobQueueAdd).toHaveBeenCalledTimes(mockIssues.length + 1); // +1 for scheduling next poll

      // First two calls should be issue processor jobs
      expect(mockJobQueueAdd).toHaveBeenNthCalledWith(
        1,
        'issue-processor',
        expect.objectContaining({
          type: 'issue-processor',
          issue: mockIssues[0],
        })
      );

      expect(mockJobQueueAdd).toHaveBeenNthCalledWith(
        2,
        'issue-processor',
        expect.objectContaining({
          type: 'issue-processor',
          issue: mockIssues[1],
        })
      );
    });

    it('should schedule next poll with current timestamp', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      mockFetchIssues.mockResolvedValue([]);

      const beforeTime = new Date().toISOString();
      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);
      const afterTime = new Date().toISOString();

      // Find the last call (scheduling next poll)
      const lastCall = mockJobQueueAdd.mock.calls[mockJobQueueAdd.mock.calls.length - 1];

      expect(lastCall[0]).toBe('issue-watcher');
      expect(lastCall[1].lastPollTimestamp).toBeDefined();

      const scheduledTimestamp = new Date(lastCall[1].lastPollTimestamp).getTime();
      expect(scheduledTimestamp).toBeGreaterThanOrEqual(new Date(beforeTime).getTime());
      expect(scheduledTimestamp).toBeLessThanOrEqual(new Date(afterTime).getTime());
    });

    it('should schedule next poll with repeat option', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      mockFetchIssues.mockResolvedValue([]);

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      // Find the last call (scheduling next poll)
      const lastCall = mockJobQueueAdd.mock.calls[mockJobQueueAdd.mock.calls.length - 1];

      expect(lastCall[2]).toEqual({
        repeat: {
          every: 60000,
        },
        jobId: 'issue-watcher-repeatable',
      });
    });

    it('should handle empty issues list', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      mockFetchIssues.mockResolvedValue([]);

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      // Should still schedule next poll (one call to add)
      expect(mockJobQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockJobQueueAdd).toHaveBeenCalledWith(
        'issue-watcher',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should generate unique taskId for each issue processor job', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      const mockIssues = [
        {
          id: 1,
          number: 42,
          title: 'Issue 1',
          body: 'Body 1',
          state: 'open' as const,
          labels: [],
          assignee: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          number: 43,
          title: 'Issue 2',
          body: 'Body 2',
          state: 'open' as const,
          labels: [],
          assignee: null,
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ];

      mockFetchIssues.mockResolvedValue(mockIssues);

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      const firstCall = mockJobQueueAdd.mock.calls[0];
      const secondCall = mockJobQueueAdd.mock.calls[1];

      const firstTaskId = firstCall[1].taskId;
      const secondTaskId = secondCall[1].taskId;

      expect(firstTaskId).not.toBe(secondTaskId);
    });
  });
});