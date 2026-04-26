import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, PlanJobData } from '../types/index.js';

const { mockJobQueueAdd, mockCreateJobLogger } = vi.hoisted(() => ({
  mockJobQueueAdd: vi.fn(),
  mockCreateJobLogger: vi.fn(),
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
}));

function createIssue(): GitHubIssue {
  return {
    id: 1,
    number: 42,
    title: 'Test issue',
    body: 'Issue body',
    state: 'open',
    labels: ['ready'],
    assignee: null,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
  };
}

function createJob(issue = createIssue()): Job<PlanJobData> {
  return {
    id: 'job-plan',
    data: {
      taskId: 'task-plan',
      type: 'plan',
      runId: 'run-123',
      stage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue,
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-abc123',
      assessment: {
        status: 'stubbed',
        summary: 'Assessment deferred for this iteration.',
      },
    },
  } as unknown as Job<PlanJobData>;
}

describe('plan job', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    mockJobQueueAdd.mockResolvedValue(undefined);
  });

  it('should preserve assessed run data and produce stub plan data', async () => {
    const { runPlanWork } = await import('./plan.js');
    const job = createJob();

    const result = await runPlanWork(job);

    expect(result).toEqual({
      ...job.data,
      type: 'develop',
      stage: 'develop',
      stageAttempt: 1,
      plan: {
        status: 'stubbed',
        summary: 'Planning deferred for this iteration.',
      },
    });
  });

  it('should enqueue develop with plan output', async () => {
    const { runPlanFlow } = await import('./plan.js');
    const job = createJob();

    await runPlanFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('develop', {
      ...job.data,
      type: 'develop',
      stage: 'develop',
      stageAttempt: 1,
      plan: {
        status: 'stubbed',
        summary: 'Planning deferred for this iteration.',
      },
    });
  });

  it('should export planHandler', async () => {
    const { planHandler } = await import('./plan.js');
    expect(typeof planHandler).toBe('function');
  });
});
