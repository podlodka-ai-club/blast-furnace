import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

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
    pollIntervalMs: 60000,
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

vi.mock('./jobs/intake.js', () => ({
  intakeHandler: vi.fn().mockResolvedValue(undefined),
  startIntake: vi.fn().mockResolvedValue(undefined),
  closeIntakeRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/prepare-run.js', () => ({
  prepareRunHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/assess.js', () => ({
  assessHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/plan.js', () => ({
  planHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/develop.js', () => ({
  developHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/review.js', () => ({
  reviewHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/make-pr.js', () => ({
  makePrHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./jobs/sync-tracker-state.js', () => ({
  syncTrackerStateHandler: vi.fn().mockResolvedValue(undefined),
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
    function createTargetJob(type: string): Job {
      return {
        data: {
          taskId: `task-${type}`,
          type,
          runId: 'run-123',
          stage: type,
          stageAttempt: 1,
          reworkAttempt: 0,
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
          repository: {
            owner: 'test-owner',
            repo: 'test-repo',
          },
          branchName: 'issue-42-test-issue',
          workspacePath: '/tmp/prepare-run-abc123',
          assessment: {
            status: 'stubbed',
            summary: 'Assessment deferred.',
          },
          plan: {
            status: 'stubbed',
            summary: 'Planning deferred.',
          },
          development: {
            status: 'completed',
            summary: 'Codex completed successfully.',
          },
          quality: {
            status: 'passed',
            command: 'npm test',
            exitCode: 0,
            attempts: 1,
            durationMs: 10,
            summary: 'Quality gate passed.',
          },
          review: {
            status: 'stubbed',
            summary: 'Review deferred.',
          },
          pullRequest: {
            number: 7,
            htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
          },
        },
      } as unknown as Job;
    }

    it('should route every target workflow job type to its handler', async () => {
      const { intakeHandler } = await import('./jobs/intake.js');
      const { prepareRunHandler } = await import('./jobs/prepare-run.js');
      const { assessHandler } = await import('./jobs/assess.js');
      const { planHandler } = await import('./jobs/plan.js');
      const { developHandler } = await import('./jobs/develop.js');
      const { reviewHandler } = await import('./jobs/review.js');
      const { makePrHandler } = await import('./jobs/make-pr.js');
      const { syncTrackerStateHandler } = await import('./jobs/sync-tracker-state.js');
      const { multiHandler } = await import('./index.js');

      const handlers = [
        ['intake', intakeHandler],
        ['prepare-run', prepareRunHandler],
        ['assess', assessHandler],
        ['plan', planHandler],
        ['develop', developHandler],
        ['review', reviewHandler],
        ['make-pr', makePrHandler],
        ['sync-tracker-state', syncTrackerStateHandler],
      ] as const;

      for (const [type, handler] of handlers) {
        const mockJob = createTargetJob(type);
        await multiHandler(mockJob);
        expect(handler).toHaveBeenCalledWith(mockJob);
      }
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

    it('should reject the deprecated quality-gate job type as unknown', async () => {
      const { multiHandler } = await import('./index.js');

      const mockJob = createTargetJob('quality-gate');

      await expect(multiHandler(mockJob)).rejects.toThrow('Unknown job type: quality-gate');
    });
  });
});

describe('strategy selection', () => {
  it('should export startIntake function', async () => {
    const { startIntake } = await import('./jobs/intake.js');
    expect(typeof startIntake).toBe('function');
  });

  it('starts intake during startup without strategy selection', async () => {
    const { startIntake } = await import('./jobs/intake.js');

    await import('./index.js');

    await vi.waitFor(() => {
      expect(startIntake).toHaveBeenCalledTimes(1);
    });
  });
});
