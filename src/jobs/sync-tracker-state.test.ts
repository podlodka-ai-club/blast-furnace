import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, SyncTrackerStateJobData } from '../types/index.js';

const { mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCleanupWorkingDir: vi.fn(),
}));

const { mockMoveIssueToInReview } = vi.hoisted(() => ({
  mockMoveIssueToInReview: vi.fn(),
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

function createJob(overrides: Partial<SyncTrackerStateJobData> = {}): Job<SyncTrackerStateJobData> {
  return {
    id: 'job-sync-tracker-state',
    data: {
      taskId: 'task-sync-tracker-state',
      type: 'sync-tracker-state',
      runId: 'run-123',
      stage: 'sync-tracker-state',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue: createIssue(),
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-abc123',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
      ...overrides,
    },
  } as unknown as Job<SyncTrackerStateJobData>;
}

describe('sync-tracker-state job', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    mockMoveIssueToInReview.mockResolvedValue(['in review']);
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
  });

  it('should receive pull request data and move the issue from ready to in review', async () => {
    const { runSyncTrackerStateWork } = await import('./sync-tracker-state.js');
    const job = createJob();

    const result = await runSyncTrackerStateWork(job);

    expect(mockMoveIssueToInReview).toHaveBeenCalledWith(42);
    expect(result).toEqual(job.data.pullRequest);
  });

  it('should log tracker synchronization failures without losing pull request data', async () => {
    const { runSyncTrackerStateWork } = await import('./sync-tracker-state.js');
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);
    mockMoveIssueToInReview.mockRejectedValue(new Error('label update failed'));
    const job = createJob();

    const result = await runSyncTrackerStateWork(job);

    expect(result).toEqual(job.data.pullRequest);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update labels'));
  });

  it('should clean up the terminal workspace after tracker synchronization', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    const job = createJob();

    await runSyncTrackerStateFlow(job);

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith('/tmp/prepare-run-abc123');
  });

  it('should still attempt terminal workspace cleanup when tracker synchronization throws', async () => {
    const { runSyncTrackerStateFlow } = await import('./sync-tracker-state.js');
    mockMoveIssueToInReview.mockRejectedValue(new Error('label update failed'));
    const job = createJob();

    await runSyncTrackerStateFlow(job);

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith('/tmp/prepare-run-abc123');
  });

  it('should export syncTrackerStateHandler', async () => {
    const { syncTrackerStateHandler } = await import('./sync-tracker-state.js');
    expect(typeof syncTrackerStateHandler).toBe('function');
  });
});
