import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, RepositoryIdentity, SyncTrackerStateJobData } from '../types/index.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
  readRunSummary,
  resolveOrchestrationStorageRoot,
} from './orchestration.js';

const { mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCleanupWorkingDir: vi.fn(),
}));

const { mockMoveIssueToInReview } = vi.hoisted(() => ({
  mockMoveIssueToInReview: vi.fn(),
}));

const { mockRemoveReworkLabelFromPullRequest } = vi.hoisted(() => ({
  mockRemoveReworkLabelFromPullRequest: vi.fn(),
}));

const { mockJobQueueAdd } = vi.hoisted(() => ({
  mockJobQueueAdd: vi.fn(),
}));

const { mockCreateJobLogger } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
}));

vi.mock('../utils/working-dir.js', () => ({
  cleanupWorkingDir: mockCleanupWorkingDir,
}));

vi.mock('../github/issue-labels.js', () => ({
  moveIssueToInReview: mockMoveIssueToInReview,
}));

vi.mock('../github/pullRequests.js', () => ({
  REWORK_LABEL: 'rework',
  removeReworkLabelFromPullRequest: mockRemoveReworkLabelFromPullRequest,
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
}));

vi.mock('../config/index.js', () => ({
  config: {
    github: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
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

describe('sync-tracker-state job', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    mockMoveIssueToInReview.mockResolvedValue(['in review']);
    mockRemoveReworkLabelFromPullRequest.mockResolvedValue(undefined);
    mockJobQueueAdd.mockResolvedValue({ id: 'queued-pr-rework-intake' });
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
  });

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createJob({
    repository = {
      owner: 'test-owner',
      repo: 'test-repo',
    },
    reworkAttempt = 0,
    makePrStatus = 'pull-request-created',
  }: {
    repository?: RepositoryIdentity;
    reworkAttempt?: number;
    makePrStatus?: 'pull-request-created' | 'no-changes';
  } = {}): Promise<Job<SyncTrackerStateJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'sync-ledger-'));
    tempRoots.push(workspacePath);
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'make-pr',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
      reworkAttempt,
      latestHandoffRecord: null,
      stableContext: {
        issue: createIssue(),
        repository,
        branchName: 'issue-42-test-issue',
        workspacePath,
      },
      stages: {},
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'make-pr',
      toStage: 'sync-tracker-state',
      stageAttempt: 1,
      reworkAttempt,
      status: 'success',
      output: {
        status: makePrStatus,
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt,
        pullRequest: {
          number: 7,
          htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
        },
      },
    });

    return {
      id: 'job-sync-tracker-state',
      data: {
        taskId: 'task-sync-tracker-state',
        type: 'sync-tracker-state',
        runId: 'run-123',
        stage: 'sync-tracker-state',
        stageAttempt: 1,
        reworkAttempt,
        inputRecordRef,
      },
    } as unknown as Job<SyncTrackerStateJobData>;
  }

  it('reads pull request data from the ledger and hands post-PR monitoring to PR Rework Intake', async () => {
    const { runSyncTrackerStateWork } = await import('./sync-tracker-state.js');
    const job = await createJob();

    const result = await runSyncTrackerStateWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    const summary = await readRunSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), 'run-123');

    expect(mockMoveIssueToInReview).toHaveBeenCalledWith(42);
    expect(result).toEqual({
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    });
    expect(records[1]).toMatchObject({
      fromStage: 'sync-tracker-state',
      toStage: 'pr-rework-intake',
      dependsOn: ['000001_make-pr_to_sync-tracker-state'],
      output: {
        status: 'tracker-synced',
        trackerLabels: ['in review'],
      },
    });
    expect(summary).toMatchObject({
      status: 'running',
      currentStage: 'pr-rework-intake',
      latestHandoffRecord: expect.objectContaining({
        recordId: '000002_sync-tracker-state_to_pr-rework-intake',
        stage: 'sync-tracker-state',
      }),
    });
  });

  it('enqueues PR Rework Intake after initial pull request tracker synchronization', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    const job = await createJob();

    await runSyncTrackerStateFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('pr-rework-intake', expect.objectContaining({
      taskId: 'task-sync-tracker-state',
      type: 'pr-rework-intake',
      runId: 'run-123',
      stage: 'pr-rework-intake',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef: expect.objectContaining({
        recordId: '000002_sync-tracker-state_to_pr-rework-intake',
        stage: 'sync-tracker-state',
      }),
    }));
    expect(mockCleanupWorkingDir.mock.invocationCallOrder[0]).toBeLessThan(
      mockJobQueueAdd.mock.invocationCallOrder[0]
    );
    expect(mockRemoveReworkLabelFromPullRequest).not.toHaveBeenCalled();
  });

  it('logs tracker synchronization failures without losing pull request data', async () => {
    const { runSyncTrackerStateWork } = await import('./sync-tracker-state.js');
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);
    mockMoveIssueToInReview.mockRejectedValue(new Error('label update failed'));
    const job = await createJob();

    const result = await runSyncTrackerStateWork(job);

    expect(result).toEqual({
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update labels'));
  });

  it('cleans up the terminal workspace after tracker synchronization', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    const job = await createJob();

    await runSyncTrackerStateFlow(job);

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(expect.stringContaining('sync-ledger-'));
  });

  it('still attempts terminal workspace cleanup when tracker synchronization throws', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    mockMoveIssueToInReview.mockRejectedValue(new Error('label update failed'));
    const job = await createJob();

    await runSyncTrackerStateFlow(job);

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(expect.stringContaining('sync-ledger-'));
  });

  it('fails mismatched repository identity before tracker side effects and still cleans up', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    const job = await createJob({
      repository: {
      owner: 'other-owner',
      repo: 'other-repo',
      },
    });

    await expect(runSyncTrackerStateFlow(job)).rejects.toThrow('Repository identity mismatch');

    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(expect.stringContaining('sync-ledger-'));
  });

  it('removes the rework label, moves the issue to in review, cleans up, and resumes polling after rework finalization', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    const job = await createJob({ reworkAttempt: 1 });

    await runSyncTrackerStateFlow(job);

    expect(mockRemoveReworkLabelFromPullRequest).toHaveBeenCalledWith(7);
    expect(mockMoveIssueToInReview).toHaveBeenCalledWith(42);
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(expect.stringContaining('sync-ledger-'));
    expect(mockJobQueueAdd).toHaveBeenCalledWith('pr-rework-intake', expect.objectContaining({
      stage: 'pr-rework-intake',
      reworkAttempt: 1,
    }));
  });

  it('runs rework cleanup and polling even when Make PR produced no repository changes', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    const job = await createJob({ reworkAttempt: 1, makePrStatus: 'no-changes' });

    await runSyncTrackerStateFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    const summary = await readRunSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), 'run-123');

    expect(mockRemoveReworkLabelFromPullRequest).toHaveBeenCalledWith(7);
    expect(mockMoveIssueToInReview).toHaveBeenCalledWith(42);
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(expect.stringContaining('sync-ledger-'));
    expect(records[1]).toMatchObject({
      fromStage: 'sync-tracker-state',
      toStage: 'pr-rework-intake',
      reworkAttempt: 1,
      output: {
        status: 'tracker-synced',
      },
    });
    expect(summary).toMatchObject({
      status: 'running',
      currentStage: 'pr-rework-intake',
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('pr-rework-intake', expect.objectContaining({
      reworkAttempt: 1,
    }));
  });

  it('should export syncTrackerStateHandler', async () => {
    const { syncTrackerStateHandler } = await import('./sync-tracker-state.js');
    expect(typeof syncTrackerStateHandler).toBe('function');
  });
});
