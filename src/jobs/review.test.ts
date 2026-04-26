import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, ReviewJobData } from '../types/index.js';

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

function createJob(issue = createIssue()): Job<ReviewJobData> {
  return {
    id: 'job-review',
    data: {
      taskId: 'task-review',
      type: 'review',
      runId: 'run-123',
      stage: 'review',
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
      plan: {
        status: 'stubbed',
        summary: 'Planning deferred for this iteration.',
      },
      development: {
        status: 'completed',
        summary: 'Codex completed successfully.',
      },
      quality: {
        status: 'passed',
        summary: 'Quality gate deferred for this iteration.',
      },
    },
  } as unknown as Job<ReviewJobData>;
}

describe('review job', () => {
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

  it('should preserve quality gate data and produce stub review data', async () => {
    const { runReviewWork } = await import('./review.js');
    const job = createJob();

    const result = await runReviewWork(job);

    expect(result).toEqual({
      taskId: 'task-review',
      type: 'make-pr',
      runId: 'run-123',
      stage: 'make-pr',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue: job.data.issue,
      repository: job.data.repository,
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-abc123',
      development: job.data.development,
      quality: job.data.quality,
      review: {
        status: 'stubbed',
        summary: 'Review deferred for this iteration.',
      },
    });
  });

  it('should enqueue make-pr with review output', async () => {
    const { runReviewFlow } = await import('./review.js');
    const job = createJob();

    await runReviewFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('make-pr', {
      taskId: 'task-review',
      type: 'make-pr',
      runId: 'run-123',
      stage: 'make-pr',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue: job.data.issue,
      repository: job.data.repository,
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-abc123',
      development: job.data.development,
      quality: job.data.quality,
      review: {
        status: 'stubbed',
        summary: 'Review deferred for this iteration.',
      },
    });
  });

  it('should export reviewHandler', async () => {
    const { reviewHandler } = await import('./review.js');
    expect(typeof reviewHandler).toBe('function');
  });
});
