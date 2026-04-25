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
      issue,
      branchName: 'issue-42-test-issue',
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

  it('should enqueue codex-provider with received issue and branch data unchanged', async () => {
    const { processPlan } = await import('./plan.js');
    const job = createJob();

    await processPlan(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('codex-provider', {
      taskId: 'task-plan',
      type: 'codex-provider',
      issue: job.data.issue,
      branchName: 'issue-42-test-issue',
    });
  });

  it('should export planHandler', async () => {
    const { planHandler } = await import('./plan.js');
    expect(typeof planHandler).toBe('function');
  });
});
