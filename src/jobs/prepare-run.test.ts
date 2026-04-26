import { mkdir, readdir, rm } from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, PrepareRunJobData } from '../types/index.js';
import { spawn } from 'child_process';
import { createPrepareRunPayload, runPrepareRunFlow, runPrepareRunWork } from './prepare-run.js';
import { readHandoffRecords, readRunSummary } from './orchestration.js';

const TEMP_DIR = '/tmp/prepare-run-abc123';

const { mockGetRef, mockPushBranch, mockDeleteBranch } = vi.hoisted(() => ({
  mockGetRef: vi.fn(),
  mockPushBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
}));

const { mockCreateTempWorkingDir, mockCloneRepoInto, mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCreateTempWorkingDir: vi.fn(),
  mockCloneRepoInto: vi.fn(),
  mockCleanupWorkingDir: vi.fn(),
}));

const { mockCreateJobLogger, mockJobQueueAdd } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
  mockJobQueueAdd: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../github/branches.js', () => ({
  getRef: mockGetRef,
  pushBranch: mockPushBranch,
  deleteBranch: mockDeleteBranch,
}));

vi.mock('../utils/working-dir.js', () => ({
  createTempWorkingDir: mockCreateTempWorkingDir,
  cloneRepoInto: mockCloneRepoInto,
  cleanupWorkingDir: mockCleanupWorkingDir,
  getRepoRemoteUrl: () => 'https://test-token@github.com/test-owner/test-repo.git',
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
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

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 1,
    number: 42,
    title: 'Test Issue',
    body: 'Test body content',
    state: 'open',
    labels: ['ready'],
    assignee: null,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
    ...overrides,
  };
}

function createJob(
  issue = createIssue(),
  overrides: Partial<PrepareRunJobData> = {}
): Job<PrepareRunJobData> {
  return {
    id: 'job-prepare',
    data: {
      taskId: 'task-prepare',
      type: 'prepare-run',
      runId: 'run-123',
      stage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue,
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      ...overrides,
    },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<PrepareRunJobData>;
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

describe('prepare-run job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    mockCreateTempWorkingDir.mockResolvedValue(TEMP_DIR);
    mockCloneRepoInto.mockResolvedValue(undefined);
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    mockPushBranch.mockResolvedValue(undefined);
    mockDeleteBranch.mockResolvedValue(undefined);
    mockJobQueueAdd.mockResolvedValue(undefined);
    mockGetRef.mockImplementation((branchName: string) => {
      if (branchName === 'main') return Promise.resolve('main-sha');
      if (mockGetRef.mock.calls.filter(([branch]) => branch === branchName).length === 1) {
        return Promise.reject(new Error('Branch not found'));
      }
      return Promise.resolve('branch-sha');
    });
    vi.mocked(spawn).mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'rev-parse') {
        return createGitMockProcess(1);
      }
      return createGitMockProcess();
    });
  });

  afterEach(async () => {
    await rm(TEMP_DIR, { recursive: true, force: true });
  });

  it('creates prepare-run payloads with run identity and initial attempt counters', () => {
    const issue = createIssue();

    const payload = createPrepareRunPayload({
      taskId: 'task-prepare',
      runId: 'run-fixed',
      issue,
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
    });

    expect(payload).toEqual({
      taskId: 'task-prepare',
      type: 'prepare-run',
      runId: 'run-fixed',
      stage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue,
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
    });
  });

  it('initializes run metadata and a run-level log target', async () => {
    const job = createJob();

    const result = await runPrepareRunWork(job);
    const records = await readHandoffRecords(result.assessJobData.inputRecordRef.handoffPath);
    const summary = await readRunSummary(TEMP_DIR, 'run-123');

    expect(result.runLogPath).toMatch(
      /^\/tmp\/prepare-run-abc123\/\.orchestrator\/runs\/\d{4}-\d{2}-\d{2}_\d{2}\.\d{2}_run-123\/run\.log$/
    );
    expect(result.assessJobData).toMatchObject({
      runId: 'run-123',
      stage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef: {
        recordId: '000001_prepare-run_to_assess',
        sequence: 1,
        stage: 'prepare-run',
      },
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      fromStage: 'prepare-run',
      toStage: 'assess',
      dependsOn: null,
      output: {
        issue: job.data.issue,
        branchName: 'issue-42-test-issue',
        workspacePath: TEMP_DIR,
      },
    });
    expect(summary).toMatchObject({
      runId: 'run-123',
      currentStage: 'assess',
      timestampPrefix: expect.stringMatching(/^\d{4}-\d{2}-\d{2}_\d{2}\.\d{2}$/),
      runDirectory: expect.stringContaining('.orchestrator/runs/'),
      runSummaryPath: expect.stringContaining('_run.json'),
      handoffLedgerPath: expect.stringContaining('_handoff.jsonl'),
      latestHandoffRecord: {
        recordId: '000001_prepare-run_to_assess',
      },
    });
  });

  it('slugifies and validates the issue branch before creating it when absent', async () => {
    const job = createJob(createIssue({ title: 'Fix: "Awesome" bug #1 & other stuff!' }));

    await runPrepareRunWork(job);

    expect(mockGetRef).toHaveBeenCalledWith('main');
    expect(mockPushBranch).toHaveBeenCalledWith('issue-42-fix-awesome-bug-1-other-stuff', 'main-sha');
    expect(mockGetRef).toHaveBeenCalledWith('issue-42-fix-awesome-bug-1-other-stuff');
  });

  it('reuses an existing issue branch without creating it again', async () => {
    mockGetRef.mockImplementation((branchName: string) => {
      if (branchName === 'main') return Promise.resolve('main-sha');
      return Promise.resolve('branch-sha');
    });
    const job = createJob();

    await runPrepareRunWork(job);

    expect(mockPushBranch).not.toHaveBeenCalled();
  });

  it('creates a workspace, clones the repository, fetches the branch, checks it out, and resets it', async () => {
    const job = createJob();

    await runPrepareRunWork(job);

    expect(mockCreateTempWorkingDir).toHaveBeenCalledWith('prepare-run');
    expect(mockCloneRepoInto).toHaveBeenCalledWith(
      TEMP_DIR,
      'https://test-token@github.com/test-owner/test-repo.git'
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['fetch', 'https://test-token@github.com/test-owner/test-repo.git', 'heads/issue-42-test-issue'],
      { cwd: TEMP_DIR }
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '-b', 'issue-42-test-issue', '--track', 'origin/issue-42-test-issue'],
      { cwd: TEMP_DIR }
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'origin/issue-42-test-issue'],
      { cwd: TEMP_DIR }
    );
  });

  it('clones before writing orchestrator metadata into the workspace', async () => {
    mockCreateTempWorkingDir.mockImplementation(async () => {
      await mkdir(TEMP_DIR, { recursive: true });
      return TEMP_DIR;
    });
    mockCloneRepoInto.mockImplementation(async (workingDir: string) => {
      expect(await readdir(workingDir)).toEqual([]);
    });
    const job = createJob();

    await runPrepareRunWork(job);

    expect(mockCloneRepoInto).toHaveBeenCalledWith(
      TEMP_DIR,
      'https://test-token@github.com/test-owner/test-repo.git'
    );
  });

  it('enqueues assess with only transport metadata and an input record reference', async () => {
    const job = createJob();

    await runPrepareRunFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('assess', {
      taskId: 'task-prepare',
      type: 'assess',
      runId: 'run-123',
      stage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef: expect.objectContaining({
        recordId: '000001_prepare-run_to_assess',
        sequence: 1,
        stage: 'prepare-run',
      }),
    });
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('issue');
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('repository');
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('branchName');
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('workspacePath');
  });

  it('fails mismatched repository identity before prepare-run side effects', async () => {
    const job = createJob(createIssue(), {
      repository: {
        owner: 'other-owner',
        repo: 'other-repo',
      },
    });

    await expect(runPrepareRunFlow(job)).rejects.toThrow('Repository identity mismatch');

    expect(mockGetRef).not.toHaveBeenCalled();
    expect(mockPushBranch).not.toHaveBeenCalled();
    expect(mockCreateTempWorkingDir).not.toHaveBeenCalled();
    expect(mockCloneRepoInto).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('cleans up the workspace and created branch when preparation fails before assess handoff', async () => {
    mockJobQueueAdd.mockRejectedValue(new Error('Queue add failed'));
    const job = createJob();

    await expect(runPrepareRunFlow(job)).rejects.toThrow('Queue add failed');

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
    expect(mockDeleteBranch).toHaveBeenCalledWith('issue-42-test-issue');
  });

  it('does not delete an existing branch when preparation fails before assess handoff', async () => {
    mockGetRef.mockImplementation((branchName: string) => {
      if (branchName === 'main') return Promise.resolve('main-sha');
      return Promise.resolve('branch-sha');
    });
    mockJobQueueAdd.mockRejectedValue(new Error('Queue add failed'));
    const job = createJob();

    await expect(runPrepareRunFlow(job)).rejects.toThrow('Queue add failed');

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
    expect(mockDeleteBranch).not.toHaveBeenCalled();
  });
});
