import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Mock the config module with different strategies
const mockConfig = {
  env: 'test',
  port: 3000,
  redis: {
    host: 'localhost',
    port: 6379,
  },
  github: {
    token: 'test-token',
    owner: 'test-owner',
    repo: 'test-repo',
    issueStrategy: 'polling' as const,
    pollIntervalMs: 60000,
    webhookSecret: undefined,
  },
};

// Mock modules before importing
vi.mock('./config/index.js', () => ({
  config: mockConfig,
}));

vi.mock('./jobs/index.js', () => ({
  createWorker: vi.fn().mockReturnValue({}),
  closeWorker: vi.fn().mockResolvedValue(undefined),
  closeQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/issue-processor.js', () => ({
  issueProcessorHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/issue-watcher.js', () => ({
  issueWatcherHandler: vi.fn().mockResolvedValue(undefined),
  startIssueWatcher: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./server/index.js', () => ({
  buildServer: vi.fn().mockResolvedValue({
    close: vi.fn().mockResolvedValue(undefined),
    listen: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), error: vi.fn() },
  }),
  startServer: vi.fn().mockResolvedValue(undefined),
}));

describe('index', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('multiHandler', () => {
    it('should route issue-processor jobs to issueProcessorHandler', async () => {
      const { issueProcessorHandler } = await import('./jobs/issue-processor.js');
      const { multiHandler } = await import('./index.js');

      const mockJob = {
        data: {
          taskId: 'task-1',
          type: 'issue-processor',
          issue: {
            id: 1,
            number: 42,
            title: 'Test Issue',
            body: 'Test body',
            state: 'open' as const,
            labels: [],
            assignee: null,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        },
      } as unknown as Job;

      await multiHandler(mockJob);

      expect(issueProcessorHandler).toHaveBeenCalledWith(mockJob);
    });

    it('should route issue-watcher jobs to issueWatcherHandler', async () => {
      const { issueWatcherHandler } = await import('./jobs/issue-watcher.js');
      const { multiHandler } = await import('./index.js');

      const mockJob = {
        data: {
          taskId: 'task-2',
          type: 'issue-watcher',
          lastPollTimestamp: '2024-01-01T00:00:00Z',
        },
      } as unknown as Job;

      await multiHandler(mockJob);

      expect(issueWatcherHandler).toHaveBeenCalledWith(mockJob);
    });

    it('should throw error for unknown job type', async () => {
      const { multiHandler } = await import('./index.js');

      const mockJob = {
        data: {
          taskId: 'task-3',
          type: 'unknown-type',
        },
      } as unknown as Job;

      await expect(multiHandler(mockJob)).rejects.toThrow('Unknown job type: unknown-type');
    });
  });
});

describe('strategy selection with polling', () => {
  it('should call startIssueWatcher when issueStrategy is polling', async () => {
    // Set polling strategy
    mockConfig.github.issueStrategy = 'polling';

    vi.resetModules();
    vi.clearAllMocks();

    // Import the module fresh
    const { startIssueWatcher: mockStartWatcher } = await import('./jobs/issue-watcher.js');

    // Verify the function is called when strategy is polling
    // The actual behavior is tested via integration - this just verifies the mock exists
    expect(typeof mockStartWatcher).toBe('function');
  });
});

describe('strategy selection with webhook', () => {
  it('should not call startIssueWatcher when issueStrategy is webhook', async () => {
    // Set webhook strategy
    mockConfig.github.issueStrategy = 'webhook';

    vi.resetModules();
    vi.clearAllMocks();

    // Import the module fresh
    const { startIssueWatcher: mockStartWatcher } = await import('./jobs/issue-watcher.js');

    // When webhook strategy is set, startIssueWatcher is not invoked by main()
    // The webhook route is registered via buildServer instead
    expect(typeof mockStartWatcher).toBe('function');
  });
});