import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { IntakeJobData } from '../types/index.js';

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
    smembers: vi.fn().mockResolvedValue([]),
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
      pollIntervalMs: 60000,
    },
  },
}));

describe('intake job', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockJobQueueAdd.mockResolvedValue({ id: 'new-job-id' });
    mockRedisClient.smembers.mockResolvedValue([]);
  });

  describe('startIntake', () => {
    it('should add a repeatable job to the queue', async () => {
      const { startIntake } = await import('./intake.js');

      await startIntake();

      expect(mockJobQueueAdd).toHaveBeenCalledWith(
        'intake',
        expect.objectContaining({
          taskId: expect.stringContaining('intake-'),
          type: 'intake',
          stage: 'intake',
          stageAttempt: 1,
          reworkAttempt: 0,
        }),
        expect.objectContaining({
          repeat: {
            every: 60000,
          },
          jobId: 'intake-repeatable',
        })
      );
    });

    it('should use pollIntervalMs from config', async () => {
      const { startIntake } = await import('./intake.js');

      await startIntake();

      expect(mockJobQueueAdd).toHaveBeenCalledWith(
        'intake',
        expect.any(Object),
        expect.objectContaining({
          repeat: {
            every: 60000,
          },
        })
      );
    });
  });

  describe('intakeHandler', () => {
    const createMockJob = (lastPollTimestamp?: string): Job<IntakeJobData> => {
      return {
        id: 'intake-job-123',
        data: {
          taskId: 'intake-task-456',
          type: 'intake',
          runId: 'intake-run',
          stage: 'intake',
          stageAttempt: 1,
          reworkAttempt: 0,
          lastPollTimestamp,
        },
      } as unknown as Job<IntakeJobData>;
    };

    it('should fetch open issues without since filter on first run', async () => {
      const { intakeHandler } = await import('./intake.js');

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get.mockResolvedValue(null);

      const mockJob = createMockJob(undefined);
      await intakeHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        labels: 'ready',
        state: 'open',
        since: undefined,
      });
    });

    it('should fetch open issues with since filter when lastPollTimestamp is set', async () => {
      const { intakeHandler } = await import('./intake.js');

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await intakeHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        labels: 'ready',
        state: 'open',
        since: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should fall back to the legacy watcher timestamp key during migration', async () => {
      const { intakeHandler } = await import('./intake.js');

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await intakeHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        labels: 'ready',
        state: 'open',
        since: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should add PrepareRunJobData job for each new issue', async () => {
      const { intakeHandler } = await import('./intake.js');

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
      await intakeHandler(mockJob);

      // Prepare Run jobs are added for each issue
      expect(mockJobQueueAdd).toHaveBeenCalledTimes(mockIssues.length);

      // First two calls should be Prepare Run jobs
      expect(mockJobQueueAdd).toHaveBeenNthCalledWith(
        1,
        'prepare-run',
        expect.objectContaining({
          type: 'prepare-run',
          stage: 'prepare-run',
          stageAttempt: 1,
          reworkAttempt: 0,
          issue: mockIssues[0],
          repository: {
            owner: 'test-owner',
            repo: 'test-repo',
          },
        })
      );

      expect(mockJobQueueAdd).toHaveBeenNthCalledWith(
        2,
        'prepare-run',
        expect.objectContaining({
          type: 'prepare-run',
          stage: 'prepare-run',
          stageAttempt: 1,
          reworkAttempt: 0,
          issue: mockIssues[1],
          repository: {
            owner: 'test-owner',
            repo: 'test-repo',
          },
        })
      );
    });

    it('should handle empty issues list', async () => {
      const { intakeHandler } = await import('./intake.js');

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await intakeHandler(mockJob);

      // No jobs added when issue list is empty
      expect(mockJobQueueAdd).toHaveBeenCalledTimes(0);
    });

    it('should generate unique taskId for each prepare-run job', async () => {
      const { intakeHandler } = await import('./intake.js');

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
      await intakeHandler(mockJob);

      const firstCall = mockJobQueueAdd.mock.calls[0];
      const secondCall = mockJobQueueAdd.mock.calls[1];

      const firstTaskId = firstCall[1].taskId;
      const secondTaskId = secondCall[1].taskId;

      expect(firstTaskId).not.toBe(secondTaskId);
    });

    it('should propagate error when fetchIssues fails', async () => {
      const { intakeHandler } = await import('./intake.js');

      mockFetchIssues.mockRejectedValue(new Error('Network error'));
      mockRedisClient.get.mockResolvedValue('2024-01-01T00:00:00.000Z');

      const mockJob = createMockJob('2024-01-01T00:00:00Z');
      await expect(intakeHandler(mockJob)).rejects.toThrow('Network error');
    });

    it('should fall back to configured default repo when no repos registered', async () => {
      const { intakeHandler } = await import('./intake.js');

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.smembers.mockResolvedValue([]);

      const mockJob = createMockJob(undefined);
      await intakeHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        labels: 'ready',
        state: 'open',
        since: undefined,
      });
    });

    it('should fetch issues for each registered repo', async () => {
      const { intakeHandler } = await import('./intake.js');

      const registeredRepos = [
        JSON.stringify({ owner: 'owner1', repo: 'repo1', addedAt: '2024-01-01T00:00:00Z' }),
        JSON.stringify({ owner: 'owner2', repo: 'repo2', addedAt: '2024-01-01T00:00:00Z' }),
      ];

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.smembers.mockResolvedValue(registeredRepos);

      const mockJob = createMockJob(undefined);
      await intakeHandler(mockJob);

      expect(mockFetchIssues).toHaveBeenCalledTimes(2);
      expect(mockFetchIssues).toHaveBeenNthCalledWith(1, {
        owner: 'owner1',
        repo: 'repo1',
        labels: 'ready',
        state: 'open',
        since: undefined,
      });
      expect(mockFetchIssues).toHaveBeenNthCalledWith(2, {
        owner: 'owner2',
        repo: 'repo2',
        labels: 'ready',
        state: 'open',
        since: undefined,
      });
    });

    it('should process issues from all registered repos', async () => {
      const { intakeHandler } = await import('./intake.js');

      const registeredRepos = [
        JSON.stringify({ owner: 'owner1', repo: 'repo1', addedAt: '2024-01-01T00:00:00Z' }),
        JSON.stringify({ owner: 'owner2', repo: 'repo2', addedAt: '2024-01-01T00:00:00Z' }),
      ];

      const mockIssues1 = [
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
      ];

      const mockIssues2 = [
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

      mockFetchIssues
        .mockResolvedValueOnce(mockIssues1)
        .mockResolvedValueOnce(mockIssues2);
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.smembers.mockResolvedValue(registeredRepos);

      const mockJob = createMockJob(undefined);
      await intakeHandler(mockJob);

      // Should have added 2 prepare-run jobs (one from each repo)
      expect(mockJobQueueAdd).toHaveBeenCalledTimes(2);
      expect(mockJobQueueAdd).toHaveBeenNthCalledWith(
        1,
        'prepare-run',
        expect.objectContaining({
          type: 'prepare-run',
          issue: mockIssues1[0],
          repository: {
            owner: 'owner1',
            repo: 'repo1',
          },
        })
      );
      expect(mockJobQueueAdd).toHaveBeenNthCalledWith(
        2,
        'prepare-run',
        expect.objectContaining({
          type: 'prepare-run',
          issue: mockIssues2[0],
          repository: {
            owner: 'owner2',
            repo: 'repo2',
          },
        })
      );
    });

    it('should skip invalid JSON members in repo list', async () => {
      const { intakeHandler } = await import('./intake.js');

      const registeredRepos = [
        'invalid-json',
        JSON.stringify({ owner: 'valid-owner', repo: 'valid-repo', addedAt: '2024-01-01T00:00:00Z' }),
        '{ broken json',
      ];

      mockFetchIssues.mockResolvedValue([]);
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.smembers.mockResolvedValue(registeredRepos);

      const mockJob = createMockJob(undefined);
      await intakeHandler(mockJob);

      // Should only call fetchIssues once for the valid repo
      expect(mockFetchIssues).toHaveBeenCalledTimes(1);
      expect(mockFetchIssues).toHaveBeenCalledWith({
        owner: 'valid-owner',
        repo: 'valid-repo',
        labels: 'ready',
        state: 'open',
        since: undefined,
      });
    });
  });

  describe('closeIntakeRedis', () => {
    it('should close Redis connection when status is ready', async () => {
      const { closeIntakeRedis } = await import('./intake.js');

      mockRedisClient.status = 'ready';
      mockRedisClient.quit.mockResolvedValue('OK');

      await closeIntakeRedis();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should close Redis connection when status is connecting', async () => {
      const { closeIntakeRedis } = await import('./intake.js');

      mockRedisClient.status = 'connecting';
      mockRedisClient.quit.mockResolvedValue('OK');

      await closeIntakeRedis();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should not close Redis connection when status is other', async () => {
      const { closeIntakeRedis } = await import('./intake.js');

      mockRedisClient.status = 'closed';
      mockRedisClient.quit.mockResolvedValue('OK');

      await closeIntakeRedis();

      expect(mockRedisClient.quit).not.toHaveBeenCalled();
    });
  });

  describe('startIntake error handling', () => {
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
        status: 'wait', // Not 'ready' and not 'connecting', so we will connect
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

      const { startIntake } = await import('./intake.js');

      // Make jobQueue.add fail
      mockJobQueueAdd2.mockRejectedValue(new Error('Queue error'));

      // Status is already 'wait' from line 454, which will trigger connect() in startIntake

      await expect(startIntake()).rejects.toThrow('Queue error');

      // Verify we tried to quit the connection since we established it
      expect(mockRedisClient2.quit).toHaveBeenCalled();
    });
  });
});
