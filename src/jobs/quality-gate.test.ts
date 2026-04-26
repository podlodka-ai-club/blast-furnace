import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, QualityGateJobData } from '../types/index.js';

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

function createJob(issue = createIssue()): Job<QualityGateJobData> {
  return {
    id: 'job-quality-gate',
    data: {
      taskId: 'task-quality-gate',
      type: 'quality-gate',
      runId: 'run-123',
      stage: 'quality-gate',
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
    },
  } as unknown as Job<QualityGateJobData>;
}

describe('quality-gate job', () => {
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

  it('should produce a stub passing quality result and preserve development context', async () => {
    const { runQualityGateWork } = await import('./quality-gate.js');
    const job = createJob();

    const result = await runQualityGateWork(job);

    expect(result).toEqual({
      ...job.data,
      type: 'review',
      stage: 'review',
      stageAttempt: 1,
      quality: {
        status: 'passed',
        summary: 'Quality gate deferred for this iteration.',
      },
    });
  });

  it('should enqueue review with quality output', async () => {
    const { runQualityGateFlow } = await import('./quality-gate.js');
    const job = createJob();

    await runQualityGateFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('review', {
      ...job.data,
      type: 'review',
      stage: 'review',
      stageAttempt: 1,
      quality: {
        status: 'passed',
        summary: 'Quality gate deferred for this iteration.',
      },
    });
  });

  it('should export qualityGateHandler', async () => {
    const { qualityGateHandler } = await import('./quality-gate.js');
    expect(typeof qualityGateHandler).toBe('function');
  });
});
