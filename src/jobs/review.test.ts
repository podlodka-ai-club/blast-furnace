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
      issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
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

  it('should enqueue make-pr with received data unchanged', async () => {
    const { processReview } = await import('./review.js');
    const job = createJob();

    await processReview(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('make-pr', {
      taskId: 'task-review',
      type: 'make-pr',
      issue: job.data.issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
    });
  });

  it('should expose work that returns make-pr data without enqueueing', async () => {
    const { runReviewWork } = await import('./review.js');
    const job = createJob();

    const result = await runReviewWork(job);

    expect(result).toEqual({
      taskId: 'task-review',
      type: 'make-pr',
      issue: job.data.issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('should expose flow that schedules the make-pr transition', async () => {
    const { runReviewFlow } = await import('./review.js');
    const job = createJob();

    await runReviewFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('make-pr', {
      taskId: 'task-review',
      type: 'make-pr',
      issue: job.data.issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
    });
  });

  it('should export reviewHandler', async () => {
    const { reviewHandler } = await import('./review.js');
    expect(typeof reviewHandler).toBe('function');
  });
});
