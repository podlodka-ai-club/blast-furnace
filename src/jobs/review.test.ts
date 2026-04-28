import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, ReviewJobData } from '../types/index.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
} from './orchestration.js';

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

describe('review job', () => {
  const tempRoots: string[] = [];

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

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createJob(qualityStatus: 'passed' | 'failed' | 'misconfigured' | 'timed-out' = 'passed'): Promise<Job<ReviewJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'review-ledger-'));
    tempRoots.push(workspacePath);
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'develop',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stages: {},
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'develop',
      toStage: 'review',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: {
        status: qualityStatus === 'passed'
          ? 'success'
          : qualityStatus === 'failed'
            ? 'quality-failed'
            : qualityStatus === 'timed-out'
              ? 'quality-timed-out'
              : 'quality-misconfigured',
        runId: 'run-123',
        issue: createIssue(),
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
        },
        branchName: 'issue-42-test-issue',
        workspacePath,
        stageAttempt: 1,
        reworkAttempt: 0,
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
          status: qualityStatus,
          command: 'npm test',
          exitCode: qualityStatus === 'passed' ? 0 : 1,
          attempts: 1,
          durationMs: 25,
          summary: `Quality gate ${qualityStatus}.`,
        },
      },
    });

    return {
      id: 'job-review',
      data: {
        taskId: 'task-review',
        type: 'review',
        runId: 'run-123',
        stage: 'review',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef,
      },
    } as unknown as Job<ReviewJobData>;
  }

  it('appends review output and returns a transport-only make-pr payload', async () => {
    const { runReviewWork } = await import('./review.js');
    const job = await createJob();

    const result = await runReviewWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result).toMatchObject({
      type: 'make-pr',
      stage: 'make-pr',
      inputRecordRef: {
        recordId: '000002_review_to_make-pr',
        stage: 'review',
      },
    });
    expect(result).not.toHaveProperty('review');
    expect(records[1]).toMatchObject({
      fromStage: 'review',
      toStage: 'make-pr',
      output: {
        review: {
          status: 'stubbed',
          summary: 'Review deferred for this iteration.',
        },
      },
    });
  });

  it('enqueues make-pr with only an input record reference', async () => {
    const { runReviewFlow } = await import('./review.js');
    const job = await createJob();

    await runReviewFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('make-pr', expect.objectContaining({
      type: 'make-pr',
      stage: 'make-pr',
      inputRecordRef: expect.objectContaining({
        recordId: '000002_review_to_make-pr',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('issue');
  });

  it('rejects Develop input with missing or non-passed quality before appending review output', async () => {
    const { runReviewWork } = await import('./review.js');
    const failedJob = await createJob('failed');

    await expect(runReviewWork(failedJob)).rejects.toThrow('review input quality.status must be passed');
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('should export reviewHandler', async () => {
    const { reviewHandler } = await import('./review.js');
    expect(typeof reviewHandler).toBe('function');
  });
});
