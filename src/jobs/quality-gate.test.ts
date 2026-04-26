import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, QualityGateJobData } from '../types/index.js';
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

describe('quality-gate job', () => {
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

  async function createJob(): Promise<Job<QualityGateJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'quality-ledger-'));
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
      toStage: 'quality-gate',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: {
        status: 'success',
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
      },
    });

    return {
      id: 'job-quality-gate',
      data: {
        taskId: 'task-quality-gate',
        type: 'quality-gate',
        runId: 'run-123',
        stage: 'quality-gate',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef,
      },
    } as unknown as Job<QualityGateJobData>;
  }

  it('appends quality output and returns a transport-only review payload', async () => {
    const { runQualityGateWork } = await import('./quality-gate.js');
    const job = await createJob();

    const result = await runQualityGateWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result).toMatchObject({
      type: 'review',
      stage: 'review',
      inputRecordRef: {
        recordId: '000002_quality-gate_to_review',
        stage: 'quality-gate',
      },
    });
    expect(result).not.toHaveProperty('quality');
    expect(records[1]).toMatchObject({
      fromStage: 'quality-gate',
      toStage: 'review',
      output: {
        quality: {
          status: 'passed',
          summary: 'Quality gate deferred for this iteration.',
        },
      },
    });
  });

  it('enqueues review with only an input record reference', async () => {
    const { runQualityGateFlow } = await import('./quality-gate.js');
    const job = await createJob();

    await runQualityGateFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('review', expect.objectContaining({
      type: 'review',
      stage: 'review',
      inputRecordRef: expect.objectContaining({
        recordId: '000002_quality-gate_to_review',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('issue');
  });

  it('should export qualityGateHandler', async () => {
    const { qualityGateHandler } = await import('./quality-gate.js');
    expect(typeof qualityGateHandler).toBe('function');
  });
});
