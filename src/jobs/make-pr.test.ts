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

function createJob(issue = createIssue()): Job<MakePrJobData> {
  return {
    id: 'job-make-pr',
    data: {
      taskId: 'task-make-pr',
      type: 'make-pr',
      issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
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

  it('should commit, push, create a pull request, transition labels, and enqueue check-pr when changes exist', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = createJob();

    await processMakePr(job);

    expect(mockSpawn).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/tmp/codex-abc123' });
    expect(mockSpawn).toHaveBeenCalledWith('git', ['add', '-A'], { cwd: '/tmp/codex-abc123' });
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'Processed issue #42 via codex: Test Issue'],
      { cwd: '/tmp/codex-abc123' }
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['push', 'https://test-token@github.com/test-owner/test-repo.git', 'issue-42-test-issue'],
      { cwd: '/tmp/codex-abc123' }
    );
    expect(mockCreatePullRequest).toHaveBeenCalledWith({
      title: 'Process issue #42: Test Issue',
      head: 'issue-42-test-issue',
      base: 'main',
      body: 'Closes #42',
    });
    expect(mockMoveIssueToInReview).toHaveBeenCalledWith(42);
    expect(mockJobQueueAdd).toHaveBeenCalledWith('check-pr', {
      taskId: 'task-make-pr',
      type: 'check-pr',
      issue: job.data.issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    });
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('should skip finalization, clean up directly, and not enqueue check-pr when no changes exist', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue(createGitMockProcess(0, ''));
    const job = createJob();

    await processMakePr(job);

    expect(mockSpawn).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/tmp/codex-abc123' });
    expect(mockSpawn.mock.calls.filter(([, args]) => args[0] === 'add')).toHaveLength(0);
    expect(mockSpawn.mock.calls.filter(([, args]) => args[0] === 'push')).toHaveLength(0);
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith('/tmp/codex-abc123');
  });

  it('should expose work that creates pull request data without enqueueing check-pr', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = createJob();

    const result = await runMakePrWork(job);

    expect(result).toEqual({
      status: 'pull-request-created',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('should expose flow that schedules check-pr with unchanged data after pull request creation', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = createJob();

    await runMakePrFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('check-pr', {
      taskId: 'task-make-pr',
      type: 'check-pr',
      issue: job.data.issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    });
  });

  it('should fail without enqueueing check-pr when push fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
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

  it('should warn without failing when label transition fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    mockMoveIssueToInReview.mockRejectedValue(new Error('label update failed'));
    const job = createJob();

    await processMakePr(job);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update labels'));
    expect(mockJobQueueAdd).toHaveBeenCalledWith('check-pr', {
      taskId: 'task-make-pr',
      type: 'check-pr',
      issue: job.data.issue,
      branchName: 'issue-42-test-issue',
      repoPath: '/tmp/codex-abc123',
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    });
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('should export makePrHandler', async () => {
    const { makePrHandler } = await import('./make-pr.js');
    expect(typeof makePrHandler).toBe('function');
  });
});
