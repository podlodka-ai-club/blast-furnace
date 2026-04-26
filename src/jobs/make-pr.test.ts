import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, MakePrJobData } from '../types/index.js';
import { spawn } from 'child_process';
import { processMakePr, runMakePrFlow, runMakePrWork } from './make-pr.js';

const { mockCreateJobLogger } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
}));

const { mockCreatePullRequest } = vi.hoisted(() => ({
  mockCreatePullRequest: vi.fn(),
}));

const { mockMoveIssueToInReview } = vi.hoisted(() => ({
  mockMoveIssueToInReview: vi.fn(),
}));

const { mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCleanupWorkingDir: vi.fn(),
}));

const { mockJobQueueAdd } = vi.hoisted(() => ({
  mockJobQueueAdd: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
}));

vi.mock('../github/pullRequests.js', () => ({
  createPullRequest: mockCreatePullRequest,
}));

vi.mock('../github/issue-labels.js', () => ({
  moveIssueToInReview: mockMoveIssueToInReview,
}));

vi.mock('../utils/working-dir.js', () => ({
  cleanupWorkingDir: mockCleanupWorkingDir,
  getRepoRemoteUrl: () => 'https://test-token@github.com/test-owner/test-repo.git',
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    github: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

function createIssue(title = 'Test Issue'): GitHubIssue {
  return {
    id: 1,
    number: 42,
    title,
    body: 'Issue body',
    state: 'open',
    labels: ['ready'],
    assignee: null,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
  };
}

function createJob(
  issue = createIssue(),
  overrides: Partial<MakePrJobData> = {}
): Job<MakePrJobData> {
  return {
    id: 'job-make-pr',
    data: {
      taskId: 'task-make-pr',
      type: 'make-pr',
      runId: 'run-123',
      stage: 'make-pr',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue,
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-abc123',
      development: {
        status: 'completed',
        summary: 'Codex completed successfully.',
      },
      quality: {
        status: 'passed',
        summary: 'Quality gate deferred for this iteration.',
      },
      review: {
        status: 'stubbed',
        summary: 'Review deferred for this iteration.',
      },
      ...overrides,
    },
  } as unknown as Job<MakePrJobData>;
}

function createGitMockProcess(exitCode = 0, stdout = '', stderr = ''): ReturnType<typeof spawn> {
  return {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data' && stdout) cb(Buffer.from(stdout));
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data' && stderr) cb(Buffer.from(stderr));
      }),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0);
    }),
    kill: vi.fn(),
  } as unknown as ReturnType<typeof spawn>;
}

describe('make-pr job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    mockCreatePullRequest.mockResolvedValue({
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    });
    mockMoveIssueToInReview.mockResolvedValue(['in review']);
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    mockJobQueueAdd.mockResolvedValue(undefined);
  });

  it('should finalize reviewed target-stage data from the received workspace path', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = createJob();

    const result = await runMakePrWork(job);

    expect(spawn).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/tmp/prepare-run-abc123' });
    expect(result).toEqual({
      status: 'pull-request-created',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    });
  });

  it('should skip finalization, clean up directly, and not enqueue sync-tracker-state when no changes exist', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue(createGitMockProcess(0, ''));
    const job = createJob();

    await processMakePr(job);

    expect(mockSpawn).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/tmp/prepare-run-abc123' });
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith('/tmp/prepare-run-abc123');
  });

  it('should commit, push, create a pull request, and enqueue sync-tracker-state when changes exist', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = createJob();

    await runMakePrFlow(job);

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'Processed issue #42 via codex: Test Issue'],
      { cwd: '/tmp/prepare-run-abc123' }
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['push', 'https://test-token@github.com/test-owner/test-repo.git', 'issue-42-test-issue'],
      { cwd: '/tmp/prepare-run-abc123' }
    );
    expect(mockCreatePullRequest).toHaveBeenCalledWith({
      title: 'Process issue #42: Test Issue',
      head: 'issue-42-test-issue',
      base: 'main',
      body: 'Closes #42',
    });
    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).toHaveBeenCalledWith('sync-tracker-state', {
      taskId: 'task-make-pr',
      type: 'sync-tracker-state',
      runId: 'run-123',
      stage: 'sync-tracker-state',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue: job.data.issue,
      repository: job.data.repository,
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-abc123',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    });
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('should fail mismatched repository identity before make-pr side effects', async () => {
    const job = createJob(createIssue(), {
      repository: {
        owner: 'other-owner',
        repo: 'other-repo',
      },
    });

    await expect(runMakePrFlow(job)).rejects.toThrow('Repository identity mismatch');

    expect(spawn).not.toHaveBeenCalled();
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('should fail without enqueueing sync-tracker-state when push fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      if (cmd === 'git' && args[0] === 'push') {
        return createGitMockProcess(1, '', 'remote: Permission denied');
      }
      return createGitMockProcess();
    });
    const job = createJob();

    await expect(processMakePr(job)).rejects.toThrow('git command failed');

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('should export makePrHandler', async () => {
    const { makePrHandler } = await import('./make-pr.js');
    expect(typeof makePrHandler).toBe('function');
  });
});
