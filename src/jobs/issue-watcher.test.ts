import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { IssueWatcherJobData } from '../types/index.js';

// Use vi.hoisted to avoid hoisting issues with vi.mock
const { mockFetchIssues, mockJobQueueAdd, mockRedisClient } = vi.hoisted(() => ({
  mockFetchIssues: vi.fn(),
  mockJobQueueAdd: vi.fn(),
  mockRedisClient: {
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    quit: vi.fn().mockResolvedValue('OK'),
    status: 'ready',
  },
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

// Mock the Redis client
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => mockRedisClient),
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
      mockRedisClient.get.mockResolvedValue(null);

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
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledWith({
        state: 'open',
        since: new Date('2024-01-01T00:00:00.000Z'),
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
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      // Issue processor jobs are added for each issue
      expect(mockJobQueueAdd).toHaveBeenCalledTimes(mockIssues.length);

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

    it('should handle empty issues list', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      // No jobs added when issue list is empty
      expect(mockJobQueueAdd).toHaveBeenCalledTimes(0);
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
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await issueWatcherHandler(mockJob);

      const firstCall = mockJobQueueAdd.mock.calls[0];
      const secondCall = mockJobQueueAdd.mock.calls[1];

      const firstTaskId = firstCall[1].taskId;
      const secondTaskId = secondCall[1].taskId;

      expect(firstTaskId).not.toBe(secondTaskId);
    });

    it('should propagate error when fetchIssues fails', async () => {
      const { issueWatcherHandler } = await import('./issue-watcher.js');

      mockFetchIssues.mockRejectedValue(new Error('Network error'));
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await expect(issueWatcherHandler(mockJob)).rejects.toThrow('Network error');
    });
  });

  describe('closeIssueWatcherRedis', () => {
    it('should close Redis connection when status is ready', async () => {
      const { closeIssueWatcherRedis } = await import('./issue-watcher.js');

      mockRedisClient.status = 'ready';
      mockRedisClient.quit.mockResolvedValue('OK');

      await closeIssueWatcherRedis();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should close Redis connection when status is connecting', async () => {
      const { closeIssueWatcherRedis } = await import('./issue-watcher.js');

      mockRedisClient.status = 'connecting';
      mockRedisClient.quit.mockResolvedValue('OK');

      await closeIssueWatcherRedis();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should not close Redis connection when status is other', async () => {
      const { closeIssueWatcherRedis } = await import('./issue-watcher.js');

      mockRedisClient.status = 'closed';
      mockRedisClient.quit.mockResolvedValue('OK');

      await closeIssueWatcherRedis();

      expect(mockRedisClient.quit).not.toHaveBeenCalled();
    });
  });

  describe('startIssueWatcher error handling', () => {
    it('should close Redis connection when jobQueue.add fails after connecting', async () => {
      // We need to re-import to reset module state and test with different conditions
      vi.resetModules();

      const mockFetchIssues2 = vi.fn();
      const mockJobQueueAdd2 = vi.fn();
      const mockRedisClient2 = {
        connect: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        quit: vi.fn().mockResolvedValue('OK'),
        status: 'connecting', // Not 'ready', so we will connect
      };

      vi.doMock('../github/issues.js', () => ({
        fetchIssues: mockFetchIssues2,
      }));

      vi.doMock('./queue.js', () => ({
        jobQueue: {
          add: mockJobQueueAdd2,
        },
      }));

      vi.doMock('ioredis', () => ({
        default: vi.fn().mockImplementation(() => mockRedisClient2),
      }));

      vi.doMock('../config/index.js', () => ({
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

      // Mock createLogger to avoid issues
      vi.doMock('./logger.js', () => ({
        createJobLogger: vi.fn().mockReturnValue({
          info: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        }),
      }));

      const { startIssueWatcher } = await import('./issue-watcher.js');

      // Make jobQueue.add fail
      mockJobQueueAdd2.mockRejectedValue(new Error('Queue error'));

      // Make sure redis client is not ready so we connect
      mockRedisClient2.status = 'connecting';

      await expect(startIssueWatcher()).rejects.toThrow('Queue error');

      // Verify we tried to quit the connection since we established it
      expect(mockRedisClient2.quit).toHaveBeenCalled();
    });
  });
});