import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { AssessJobData, GitHubIssue } from '../types/index.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
  readRunSummary,
  resolveOrchestrationStorageRoot,
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

describe('assess job', () => {
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

  async function createJob(): Promise<Job<AssessJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'assess-ledger-'));
    tempRoots.push(workspacePath);
    const issue = createIssue();
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stableContext: {
        issue,
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
        },
        branchName: 'issue-42-test-issue',
        workspacePath,
      },
      stages: {},
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'prepare-run',
      toStage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 0,
      },
    });

    return {
      id: 'job-assess',
      data: {
        taskId: 'task-assess',
        type: 'assess',
        runId: 'run-123',
        stage: 'assess',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef,
      },
    } as unknown as Job<AssessJobData>;
  }

  it('appends assessment output and returns a transport-only plan payload', async () => {
    const { runAssessWork } = await import('./assess.js');
    const job = await createJob();

    const result = await runAssessWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    const summary = await readRunSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), 'run-123');

    expect(result).toMatchObject({
      taskId: 'task-assess',
      type: 'plan',
      runId: 'run-123',
      stage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef: {
        recordId: '000002_assess_to_plan',
        sequence: 2,
        stage: 'assess',
      },
    });
    expect(result).not.toHaveProperty('issue');
    expect(records[1]).toMatchObject({
      fromStage: 'assess',
      toStage: 'plan',
      dependsOn: ['000001_prepare-run_to_assess'],
      output: {
        assessment: {
          status: 'stubbed',
          summary: 'Assessment deferred for this iteration.',
        },
      },
    });
    expect(records[1]).not.toHaveProperty('nextInput');
    expect(summary).toMatchObject({
      currentStage: 'plan',
      latestHandoffRecord: {
        recordId: '000002_assess_to_plan',
      },
    });
  });

  it('enqueues plan with only an input record reference', async () => {
    const { runAssessFlow } = await import('./assess.js');
    const job = await createJob();

    await runAssessFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', expect.objectContaining({
      type: 'plan',
      stage: 'plan',
      inputRecordRef: expect.objectContaining({
        recordId: '000002_assess_to_plan',
      }),
    }));
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(mockJobQueueAdd.mock.calls[0][1].inputRecordRef).toEqual({
      runDir: job.data.inputRecordRef.runDir,
      handoffPath: job.data.inputRecordRef.handoffPath,
      recordId: records[1].recordId,
      sequence: records[1].sequence,
      stage: records[1].fromStage,
    });
    expect(records[1]).not.toHaveProperty('nextInput');
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('issue');
  });

  it('should export assessHandler', async () => {
    const { assessHandler } = await import('./assess.js');
    expect(typeof assessHandler).toBe('function');
  });
});
