import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { CheckPrJobData, GitHubIssue } from '../types/index.js';

const { mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCleanupWorkingDir: vi.fn(),
}));

const { mockCreateJobLogger } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
}));

vi.mock('../utils/working-dir.js', () => ({
  cleanupWorkingDir: mockCleanupWorkingDir,
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

function createJob(overrides: Partial<CheckPrJobData> = {}): Job<CheckPrJobData> {
  return {
    id: 'job-check-pr',
    data: {
      taskId: 'task-check-pr',
      type: 'check-pr',
      issue: createIssue(),
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
      ...overrides,
    },
  } as unknown as Job<CheckPrJobData>;
}

describe('check-pr job', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
  });

  it('should clean up temp working directory when pull request metadata exists', async () => {
    const { processCheckPr } = await import('./check-pr.js');
    const job = createJob();

    await processCheckPr(job);

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith('/tmp/codex-abc123');
  });

  it('should export checkPrHandler', async () => {
    const { checkPrHandler } = await import('./check-pr.js');
    expect(typeof checkPrHandler).toBe('function');
  });
});
