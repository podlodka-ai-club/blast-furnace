import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, PlanJobData } from '../types/index.js';
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

describe('plan job', () => {
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

  async function createJob(): Promise<Job<PlanJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'plan-ledger-'));
    tempRoots.push(workspacePath);
    const issue = createIssue();
    const prepared = {
      status: 'success',
      runId: 'run-123',
      issue,
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      branchName: 'issue-42-test-issue',
      workspacePath,
      stageAttempt: 1,
      reworkAttempt: 0,
    };
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stages: {},
    });
    const first = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'prepare-run',
      toStage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: prepared,
    });
    const second = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'assess',
      toStage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: first.inputRecordRef,
      status: 'success',
      output: {
        ...prepared,
        assessment: {
          status: 'stubbed',
          summary: 'Assessment deferred for this iteration.',
        },
      },
    });

    return {
      id: 'job-plan',
      data: {
        taskId: 'task-plan',
        type: 'plan',
        runId: 'run-123',
        stage: 'plan',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef: second.inputRecordRef,
      },
    } as unknown as Job<PlanJobData>;
  }

  it('appends plan output and returns a transport-only develop payload', async () => {
    const { runPlanWork } = await import('./plan.js');
    const job = await createJob();

    const result = await runPlanWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result).toMatchObject({
      type: 'develop',
      stage: 'develop',
      inputRecordRef: {
        recordId: '000003_plan_to_develop',
        sequence: 3,
        stage: 'plan',
      },
    });
    expect(result).not.toHaveProperty('plan');
    expect(records[2]).toMatchObject({
      fromStage: 'plan',
      toStage: 'develop',
      output: {
        plan: {
          status: 'stubbed',
          summary: 'Planning deferred for this iteration.',
        },
      },
    });
  });

  it('enqueues develop with only an input record reference', async () => {
    const { runPlanFlow } = await import('./plan.js');
    const job = await createJob();

    await runPlanFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('develop', expect.objectContaining({
      type: 'develop',
      stage: 'develop',
      inputRecordRef: expect.objectContaining({
        recordId: '000003_plan_to_develop',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('issue');
  });

  it('should export planHandler', async () => {
    const { planHandler } = await import('./plan.js');
    expect(typeof planHandler).toBe('function');
  });
});
