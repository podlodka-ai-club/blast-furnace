import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { AssessJobData, GitHubIssue } from '../types/index.js';

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

function createJob(issue = createIssue()): Job<AssessJobData> {
  return {
    id: 'job-assess',
    data: {
      taskId: 'task-assess',
      type: 'assess',
      runId: 'run-123',
      stage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue,
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-abc123',
    },
  } as unknown as Job<AssessJobData>;
}

describe('assess job', () => {
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

  it('should produce stub assessment data and preserve prepared run context', async () => {
    const { runAssessWork } = await import('./assess.js');
    const job = createJob();

    const result = await runAssessWork(job);

    expect(result).toEqual({
      ...job.data,
      type: 'plan',
      stage: 'plan',
      stageAttempt: 1,
      assessment: {
        status: 'stubbed',
        summary: 'Assessment deferred for this iteration.',
      },
    });
  });

  it('should enqueue plan with assessment output', async () => {
    const { runAssessFlow } = await import('./assess.js');
    const job = createJob();

    await runAssessFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', {
      ...job.data,
      type: 'plan',
      stage: 'plan',
      stageAttempt: 1,
      assessment: {
        status: 'stubbed',
        summary: 'Assessment deferred for this iteration.',
      },
    });
  });

  it('should export assessHandler', async () => {
    const { assessHandler } = await import('./assess.js');
    expect(typeof assessHandler).toBe('function');
  });
});
