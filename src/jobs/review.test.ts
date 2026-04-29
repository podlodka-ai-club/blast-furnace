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

const { mockJobQueueAdd, mockCreateJobLogger, mockRunCodexSession } = vi.hoisted(() => ({
  mockJobQueueAdd: vi.fn(),
  mockCreateJobLogger: vi.fn(),
  mockRunCodexSession: vi.fn(),
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
}));

vi.mock('./codex-session.js', () => ({
  runCodexReviewSession: mockRunCodexSession,
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
    mockRunCodexSession.mockResolvedValue({
      cliCmd: 'codex',
      cliArgs: [],
      output: 'Review Success',
    });
    delete process.env['REVIEW_ATTEMPT_LIMIT'];
  });

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createJob(
    qualityStatus: 'passed' | 'failed' | 'misconfigured' | 'timed-out' = 'passed',
    stageAttempt = 1
  ): Promise<Job<ReviewJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'review-ledger-'));
    tempRoots.push(workspacePath);
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'develop',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stableContext: {
        issue: createIssue(),
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
        },
        branchName: 'issue-42-test-issue',
        workspacePath,
      },
      stages: {},
    });
    const plan = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'plan',
      toStage: 'develop',
      stageAttempt,
      reworkAttempt: 0,
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt,
        reworkAttempt: 0,
        plan: {
          status: 'success',
          summary: 'Plan validated successfully.',
          content: '## Summary\nReady.',
        },
      },
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'develop',
      toStage: 'review',
      stageAttempt,
      reworkAttempt: 0,
      dependsOn: [plan.inputRecordRef],
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
        stageAttempt,
        reworkAttempt: 0,
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
        stageAttempt,
        reworkAttempt: 0,
        inputRecordRef,
      },
    } as unknown as Job<ReviewJobData>;
  }

  it('parses strict Review responses', async () => {
    const { parseReviewResponse } = await import('./review.js');

    expect(parseReviewResponse('  Review Success\n')).toEqual({ status: 'success' });
    expect(parseReviewResponse('Review failed\nFix the failing test.')).toEqual({
      status: 'failed',
      content: 'Fix the failing test.',
    });
    expect(parseReviewResponse('Review failed\n   ')).toMatchObject({ status: 'malformed' });
    expect(parseReviewResponse('review success')).toMatchObject({ status: 'malformed' });
    expect(parseReviewResponse('Review Success\nextra')).toMatchObject({ status: 'malformed' });
    expect(parseReviewResponse('Looks fine')).toMatchObject({ status: 'malformed' });
  });

  it('appends review output and returns a transport-only make-pr payload', async () => {
    const { runReviewWork } = await import('./review.js');
    const job = await createJob();

    const result = await runReviewWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result).toMatchObject({
      status: 'success',
      makePrJobData: {
        type: 'make-pr',
        stage: 'make-pr',
        inputRecordRef: {
          recordId: '000003_review_to_make-pr',
          stage: 'review',
        },
      },
    });
    expect(result.makePrJobData).not.toHaveProperty('review');
    expect(records[2]).toMatchObject({
      fromStage: 'review',
      toStage: 'make-pr',
      dependsOn: [
        '000002_develop_to_review',
        '000001_plan_to_develop',
      ],
      output: {
        review: {
          status: 'passed',
          summary: 'Review Success',
        },
      },
    });
    expect(mockRunCodexSession).toHaveBeenCalledWith(expect.objectContaining({
      sandboxMode: 'read-only',
    }));
  });

  it('enqueues make-pr with only an input record reference', async () => {
    const { runReviewFlow } = await import('./review.js');
    const job = await createJob();

    await runReviewFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('make-pr', expect.objectContaining({
      type: 'make-pr',
      stage: 'make-pr',
      inputRecordRef: expect.objectContaining({
        recordId: '000003_review_to_make-pr',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('issue');
  });

  it('preserves the review stage attempt when enqueueing make-pr after a successful retry', async () => {
    const { runReviewFlow } = await import('./review.js');
    const job = await createJob('passed', 2);

    await runReviewFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('make-pr', expect.objectContaining({
      type: 'make-pr',
      stage: 'make-pr',
      stageAttempt: 2,
      reworkAttempt: 0,
      inputRecordRef: expect.objectContaining({
        recordId: '000003_review_to_make-pr',
      }),
    }));
  });

  it('routes failed review back to develop with incremented stage attempt', async () => {
    const { runReviewWork } = await import('./review.js');
    const job = await createJob();
    mockRunCodexSession.mockResolvedValueOnce({
      cliCmd: 'codex',
      cliArgs: [],
      output: 'Review failed\nPlease address the edge case.',
    });

    const result = await runReviewWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result).toMatchObject({
      status: 'review-failed',
      developJobData: {
        stage: 'develop',
        stageAttempt: 2,
        reworkAttempt: 0,
      },
    });
    expect(records[2]).toMatchObject({
      fromStage: 'review',
      toStage: 'develop',
      status: 'rework-needed',
      output: {
        status: 'review-failed',
        review: {
          status: 'failed',
          content: 'Please address the edge case.',
        },
      },
    });
  });

  it('terminates failed review when the attempt limit is exhausted', async () => {
    const { runReviewWork } = await import('./review.js');
    process.env['REVIEW_ATTEMPT_LIMIT'] = '2';
    const job = await createJob('passed', 2);
    mockRunCodexSession.mockResolvedValueOnce({
      cliCmd: 'codex',
      cliArgs: [],
      output: 'Review failed\nStill failing.',
    });

    const result = await runReviewWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result).toMatchObject({ status: 'review-exhausted' });
    expect(records[2]).toMatchObject({
      toStage: null,
      status: 'failure',
      output: {
        status: 'review-exhausted',
        review: {
          status: 'exhausted',
          content: 'Still failing.',
        },
      },
    });
  });

  it('repairs malformed review responses by retrying the review command', async () => {
    const { runReviewWork } = await import('./review.js');
    const job = await createJob();
    mockRunCodexSession
      .mockResolvedValueOnce({ cliCmd: 'codex', cliArgs: [], output: 'unexpected prose' })
      .mockResolvedValueOnce({ cliCmd: 'codex', cliArgs: [], output: 'Review Success' });

    const result = await runReviewWork(job);

    expect(result).toMatchObject({ status: 'success' });
    expect(mockRunCodexSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sandboxMode: 'read-only',
    }));
  });

  it('terminates malformed review responses after repair fails', async () => {
    const { runReviewWork } = await import('./review.js');
    const job = await createJob();
    mockRunCodexSession
      .mockResolvedValueOnce({ cliCmd: 'codex', cliArgs: [], output: 'unexpected prose' })
      .mockResolvedValueOnce({ cliCmd: 'codex', cliArgs: [], output: 'still wrong' });

    const result = await runReviewWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result).toMatchObject({ status: 'review-malformed' });
    expect(records[2]).toMatchObject({
      toStage: null,
      status: 'failure',
      output: {
        status: 'review-malformed',
        review: {
          status: 'malformed',
          rawResponse: 'still wrong',
        },
      },
    });
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
