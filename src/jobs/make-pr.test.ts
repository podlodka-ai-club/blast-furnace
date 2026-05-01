import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, MakePrJobData, RepositoryIdentity } from '../types/index.js';
import { spawn } from 'child_process';
import { processMakePr, runMakePrFlow, runMakePrWork } from './make-pr.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
  readRunSummary,
  resolveOrchestrationStorageRoot,
} from './orchestration.js';

const { mockCreateJobLogger } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
}));

const { mockCreatePullRequest, mockGetPullRequestState } = vi.hoisted(() => ({
  mockCreatePullRequest: vi.fn(),
  mockGetPullRequestState: vi.fn(),
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
  getPullRequestState: mockGetPullRequestState,
}));

vi.mock('../github/issue-labels.js', () => ({
  moveIssueToInReview: mockMoveIssueToInReview,
}));

vi.mock('../utils/working-dir.js', () => ({
  cleanupWorkingDir: mockCleanupWorkingDir,
  createGitCommandEnv: () => ({
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic test-credentials',
  }),
  getRepoRemoteUrl: () => 'https://github.com/test-owner/test-repo.git',
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

function expectGitSpawnOptions() {
  return {
    cwd: expect.stringContaining('make-pr-ledger-'),
    env: expect.objectContaining({
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic test-credentials',
    }),
  };
}

describe('make-pr job', () => {
  const tempRoots: string[] = [];

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
    mockGetPullRequestState.mockResolvedValue({
      number: 7,
      state: 'open',
      merged: false,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      head: {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'issue-42-test-issue',
        sha: 'abc123',
      },
      labels: ['Rework'],
    });
    mockMoveIssueToInReview.mockResolvedValue(['in review']);
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    mockJobQueueAdd.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createJob(
    issue = createIssue(),
    repository: RepositoryIdentity = {
      owner: 'test-owner',
      repo: 'test-repo',
    },
    reviewOutput?: Record<string, unknown>,
    stageAttempt = 1
  ): Promise<Job<MakePrJobData>> {
    const effectiveReviewOutput = reviewOutput ?? {
      status: 'success',
      runId: 'run-123',
      stageAttempt,
      reworkAttempt: 0,
      review: {
        status: 'passed',
        summary: 'Review Success',
      },
    };
    const workspacePath = await mkdtemp(join(tmpdir(), 'make-pr-ledger-'));
    tempRoots.push(workspacePath);
    const orchestrationRoot = await mkdtemp(join(tmpdir(), 'make-pr-orchestration-'));
    tempRoots.push(orchestrationRoot);
    const fileSet = createRunFileSet(orchestrationRoot, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(orchestrationRoot, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'review',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stableContext: {
        issue,
        repository,
        branchName: 'issue-42-test-issue',
        workspacePath,
      },
      stages: {},
    });
    const plan = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
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
    const develop = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'develop',
      toStage: 'review',
      stageAttempt,
      reworkAttempt: 0,
      dependsOn: [plan.inputRecordRef],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt,
        reworkAttempt: 0,
        development: {
          status: 'completed',
          summary: 'Codex completed successfully.',
        },
        quality: {
          status: 'passed',
          command: 'npm test',
          exitCode: 0,
          attempts: 1,
          durationMs: 25,
          summary: 'Quality gate passed.',
        },
      },
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'review',
      toStage: 'make-pr',
      stageAttempt,
      reworkAttempt: 0,
      dependsOn: [develop.inputRecordRef, plan.inputRecordRef],
      status: 'success',
      output: effectiveReviewOutput,
    });

    return {
      id: 'job-make-pr',
      data: {
        taskId: 'task-make-pr',
        type: 'make-pr',
        runId: 'run-123',
        stage: 'make-pr',
        stageAttempt,
        reworkAttempt: 0,
        inputRecordRef,
      },
    } as unknown as Job<MakePrJobData>;
  }

  async function createReworkJob(): Promise<Job<MakePrJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'make-pr-ledger-'));
    tempRoots.push(workspacePath);
    const orchestrationRoot = await mkdtemp(join(tmpdir(), 'make-pr-orchestration-'));
    tempRoots.push(orchestrationRoot);
    const fileSet = createRunFileSet(orchestrationRoot, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(orchestrationRoot, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'review',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
      reworkAttempt: 1,
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
    const originalPlan = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'plan',
      toStage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 0,
        plan: {
          status: 'success',
          summary: 'Plan validated successfully.',
          content: '## Summary\nReady.',
        },
      },
    });
    const prRework = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 1,
      dependsOn: [originalPlan.inputRecordRef],
      status: 'rework-needed',
      output: {
        status: 'rework-needed',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
        pullRequest: {
          number: 7,
          htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
        },
        commentsMarkdown: 'comments',
        routeAnalysis: 'ROUTE: DEVELOP',
        selectedNextStage: 'develop',
        pullRequestHead: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'issue-42-test-issue',
          sha: 'abc123',
        },
        latestPlanRecordId: originalPlan.inputRecordRef.recordId,
      },
    });
    const prepareRun = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'prepare-run',
      toStage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 1,
      dependsOn: [prRework.inputRecordRef],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
      },
    });
    const develop = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'develop',
      toStage: 'review',
      stageAttempt: 1,
      reworkAttempt: 1,
      dependsOn: [prepareRun.inputRecordRef, prRework.inputRecordRef, originalPlan.inputRecordRef],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
        development: {
          status: 'completed',
          summary: 'Codex completed successfully.',
        },
        quality: {
          status: 'passed',
          command: 'npm test',
          exitCode: 0,
          attempts: 1,
          durationMs: 25,
          summary: 'Quality gate passed.',
        },
      },
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'review',
      toStage: 'make-pr',
      stageAttempt: 1,
      reworkAttempt: 1,
      dependsOn: [develop.inputRecordRef, originalPlan.inputRecordRef],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
        review: {
          status: 'passed',
          summary: 'Review Success',
        },
      },
    });

    return {
      id: 'job-make-pr-rework',
      data: {
        taskId: 'task-make-pr',
        type: 'make-pr',
        runId: 'run-123',
        stage: 'make-pr',
        stageAttempt: 1,
        reworkAttempt: 1,
        inputRecordRef,
      },
    } as unknown as Job<MakePrJobData>;
  }

  it('finalizes reviewed data from the ledger workspace path', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = await createJob();

    const result = await runMakePrWork(job);

    expect(spawn).toHaveBeenCalledWith(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        '.',
        ':(exclude).orchestrator',
        ':(exclude).orchestrator/**',
        ':(exclude).codex',
        ':(exclude).codex/**',
      ],
      expectGitSpawnOptions()
    );
    expect(result).toMatchObject({
      status: 'pull-request-created',
      output: {
        pullRequest: {
          number: 7,
          htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
        },
      },
    });
  });

  it('skips finalization, appends terminal no-change output, cleans up, and does not enqueue sync-tracker-state', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue(createGitMockProcess(0, ''));
    const job = await createJob();

    await processMakePr(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        '.',
        ':(exclude).orchestrator',
        ':(exclude).orchestrator/**',
        ':(exclude).codex',
        ':(exclude).codex/**',
      ],
      expectGitSpawnOptions()
    );
    expect(records[3]).toMatchObject({
      fromStage: 'make-pr',
      toStage: null,
      dependsOn: [
        '000003_review_to_make-pr',
        '000002_develop_to_review',
        '000001_plan_to_develop',
      ],
      output: {
        status: 'no-changes',
      },
    });
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(expect.stringContaining('make-pr-ledger-'));
  });

  it('commits, pushes, creates a pull request, appends output, and enqueues sync-tracker-state by reference', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = await createJob();

    await runMakePrFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        '.',
        ':(exclude).orchestrator',
        ':(exclude).orchestrator/**',
        ':(exclude).codex',
        ':(exclude).codex/**',
      ],
      expectGitSpawnOptions()
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      [
        'add',
        '-A',
        '--',
        'modified-file.txt',
      ],
      expectGitSpawnOptions()
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'Processed issue #42 via codex: Test Issue'],
      expectGitSpawnOptions()
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['push', 'https://github.com/test-owner/test-repo.git', 'issue-42-test-issue'],
      expectGitSpawnOptions()
    );
    expect(mockCreatePullRequest).toHaveBeenCalledWith({
      title: 'Process issue #42: Test Issue',
      head: 'issue-42-test-issue',
      base: 'main',
      body: 'Closes #42',
    });
    expect(records[3]).toMatchObject({
      fromStage: 'make-pr',
      toStage: 'sync-tracker-state',
      dependsOn: [
        '000003_review_to_make-pr',
        '000002_develop_to_review',
        '000001_plan_to_develop',
      ],
      output: {
        status: 'pull-request-created',
        pullRequest: {
          number: 7,
        },
      },
    });
    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).toHaveBeenCalledWith('sync-tracker-state', expect.objectContaining({
      type: 'sync-tracker-state',
      stage: 'sync-tracker-state',
      inputRecordRef: expect.objectContaining({
        recordId: '000004_make-pr_to_sync-tracker-state',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('pullRequest');
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('preserves the make-pr stage attempt when enqueueing sync-tracker-state after a retry', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = await createJob(createIssue(), {
      owner: 'test-owner',
      repo: 'test-repo',
    }, undefined, 2);

    await runMakePrFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('sync-tracker-state', expect.objectContaining({
      type: 'sync-tracker-state',
      stage: 'sync-tracker-state',
      stageAttempt: 2,
      reworkAttempt: 0,
      inputRecordRef: expect.objectContaining({
        recordId: '000004_make-pr_to_sync-tracker-state',
      }),
    }));
  });

  it('finalizes rework by pushing the existing PR branch without creating a new pull request', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    const job = await createReworkJob();

    await runMakePrFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['push', 'https://github.com/test-owner/test-repo.git', 'issue-42-test-issue'],
      expectGitSpawnOptions()
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(records.at(-1)).toMatchObject({
      fromStage: 'make-pr',
      toStage: 'sync-tracker-state',
      reworkAttempt: 1,
      output: {
        status: 'pull-request-created',
        pullRequest: {
          number: 7,
          htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
        },
      },
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('sync-tracker-state', expect.objectContaining({
      stage: 'sync-tracker-state',
      reworkAttempt: 1,
    }));
  });

  it('hands no-change rework to Sync Tracker State without cleaning up inside Make PR', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue(createGitMockProcess(0, ''));
    const job = await createReworkJob();

    await runMakePrFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
    expect(records.at(-1)).toMatchObject({
      fromStage: 'make-pr',
      toStage: 'sync-tracker-state',
      output: {
        status: 'no-changes',
        pullRequest: {
          number: 7,
        },
      },
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('sync-tracker-state', expect.objectContaining({
      reworkAttempt: 1,
    }));
  });

  it('rejects rework fork pull requests before commit or push side effects', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    mockGetPullRequestState.mockResolvedValue({
      number: 7,
      state: 'open',
      merged: false,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      head: {
        owner: 'other-owner',
        repo: 'other-repo',
        branch: 'issue-42-test-issue',
        sha: 'abc123',
      },
      labels: ['Rework'],
    });
    const job = await createReworkJob();

    await expect(runMakePrFlow(job)).rejects.toThrow('Rework pull request head repository mismatch');

    expect(mockSpawn).not.toHaveBeenCalledWith('git', expect.arrayContaining(['commit']), expect.anything());
    expect(mockSpawn).not.toHaveBeenCalledWith('git', expect.arrayContaining(['push']), expect.anything());
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('rejects rework when the current PR branch or SHA no longer matches the captured head', async () => {
    const job = await createReworkJob();
    mockGetPullRequestState.mockResolvedValueOnce({
      number: 7,
      state: 'open',
      merged: false,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      head: {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'other-branch',
        sha: 'abc123',
      },
      labels: ['Rework'],
    });

    await expect(runMakePrWork(job)).rejects.toThrow('Rework pull request head branch mismatch');

    mockGetPullRequestState.mockResolvedValueOnce({
      number: 7,
      state: 'open',
      merged: false,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      head: {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'issue-42-test-issue',
        sha: 'different-sha',
      },
      labels: ['Rework'],
    });

    await expect(runMakePrWork(job)).rejects.toThrow('Rework pull request head SHA mismatch');
  });

  it('records a pull-request-already-exists output when GitHub rejects duplicate PR creation', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    mockCreatePullRequest.mockRejectedValue(Object.assign(
      new Error('Validation Failed: A pull request already exists for test-owner:issue-42-test-issue.'),
      {
        status: 422,
        response: {
          data: {
            errors: [{
              resource: 'PullRequest',
              code: 'custom',
              message: 'A pull request already exists for test-owner:issue-42-test-issue.',
            }],
          },
        },
      }
    ));
    const job = await createJob();

    await runMakePrFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    const summary = await readRunSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), job.data.runId);

    expect(records[3]).toMatchObject({
      fromStage: 'make-pr',
      toStage: null,
      status: 'failure',
      output: {
        status: 'pull-request-already-exists',
        errorMessage: 'A pull request already exists for test-owner:issue-42-test-issue.',
      },
    });
    expect(summary).toMatchObject({
      status: 'pull-request-already-exists',
      stages: {
        'make-pr': {
          status: 'failure',
        },
      },
      trackerStatus: {
        heading: 'Blast Furnace found an existing pull request',
        focus: 'Final state: Pull request already exists',
      },
    });
    expect(summary?.trackerStatus?.checklist).toContainEqual(expect.objectContaining({
      id: 'draft-pr-and-in-review:attempt-1',
      state: 'failed',
      detail: 'A pull request already exists',
    }));
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('records a pull-request-creation-failed output for generic PR creation errors', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      return createGitMockProcess();
    });
    mockCreatePullRequest.mockRejectedValue(new Error('GitHub unavailable'));
    const job = await createJob();

    await runMakePrFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    const summary = await readRunSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), job.data.runId);

    expect(records[3]).toMatchObject({
      fromStage: 'make-pr',
      toStage: null,
      status: 'failure',
      output: {
        status: 'pull-request-creation-failed',
        errorMessage: 'GitHub unavailable',
      },
    });
    expect(summary).toMatchObject({
      status: 'pull-request-creation-failed',
      trackerStatus: {
        heading: 'Blast Furnace could not create a pull request',
        focus: 'Final state: Pull request creation failed',
      },
    });
    expect(summary?.trackerStatus?.checklist).toContainEqual(expect.objectContaining({
      id: 'draft-pr-and-in-review:attempt-1',
      state: 'failed',
      detail: 'PR creation failed',
    }));
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('treats target workspace orchestration and Codex hook files as non-committable state', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (
        cmd === 'git' &&
        args[0] === 'status' &&
        args.includes(':(exclude).orchestrator') &&
        args.includes(':(exclude).orchestrator/**') &&
        args.includes(':(exclude).codex') &&
        args.includes(':(exclude).codex/**')
      ) {
        return createGitMockProcess(0, '');
      }
      return createGitMockProcess();
    });
    const job = await createJob();

    const result = await runMakePrWork(job);

    expect(result.status).toBe('no-changes');
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        '.',
        ':(exclude).orchestrator',
        ':(exclude).orchestrator/**',
        ':(exclude).codex',
        ':(exclude).codex/**',
      ],
      expectGitSpawnOptions()
    );
    expect(mockSpawn).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['add']),
      expect.anything()
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('fails mismatched repository identity before make-pr side effects', async () => {
    const job = await createJob(createIssue(), {
      owner: 'other-owner',
      repo: 'other-repo',
    });

    await expect(runMakePrFlow(job)).rejects.toThrow('Repository identity mismatch');

    expect(spawn).not.toHaveBeenCalled();
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('rejects non-passed Review records before repository finalization', async () => {
    const { runMakePrWork } = await import('./make-pr.js');
    const job = await createJob(createIssue(), {
      owner: 'test-owner',
      repo: 'test-repo',
    }, {
      status: 'review-failed',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      review: {
        status: 'failed',
        summary: 'Review failed.',
        content: 'Fix the issue.',
      },
    });

    await expect(runMakePrWork(job)).rejects.toThrow('Make PR requires a passed Review input record');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails without enqueueing sync-tracker-state when push fails', async () => {
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
    const job = await createJob();

    await expect(processMakePr(job)).rejects.toThrow('git command failed');

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });

  it('refetches the PR branch before retrying non-fast-forward rework pushes and fails after retries exhaust', async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M modified-file.txt');
      }
      if (cmd === 'git' && args[0] === 'push') {
        return createGitMockProcess(1, '', 'Updates were rejected because the tip of your current branch is behind');
      }
      return createGitMockProcess();
    });
    const job = await createReworkJob();

    await expect(runMakePrFlow(job)).rejects.toThrow('git command failed');
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['fetch', 'https://github.com/test-owner/test-repo.git', 'heads/issue-42-test-issue'],
      expectGitSpawnOptions()
    );
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  }, 10000);

  it('should export makePrHandler', async () => {
    const { makePrHandler } = await import('./make-pr.js');
    expect(typeof makePrHandler).toBe('function');
  });
});
