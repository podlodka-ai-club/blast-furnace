import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { DevelopJobData, GitHubIssue } from '../types/index.js';
import { spawn } from 'child_process';
import * as nodePty from 'node-pty';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
} from './orchestration.js';

const { mockCreateJobLogger, mockJobQueueAdd } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
  mockJobQueueAdd: vi.fn(),
}));

const { mockCreateTempWorkingDir, mockCloneRepoInto, mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCreateTempWorkingDir: vi.fn(),
  mockCloneRepoInto: vi.fn(),
  mockCleanupWorkingDir: vi.fn(),
}));

const { mockCreatePullRequest } = vi.hoisted(() => ({
  mockCreatePullRequest: vi.fn(),
}));

const { mockMoveIssueToInReview } = vi.hoisted(() => ({
  mockMoveIssueToInReview: vi.fn(),
}));

const { mockEnsureNodePtySpawnHelperExecutable } = vi.hoisted(() => ({
  mockEnsureNodePtySpawnHelperExecutable: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
    },
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      pollIntervalMs: 60000,
    },
    codex: {
      cliPath: 'npx @openai/codex',
      model: 'gpt-5.4',
      timeoutMs: 300000,
    },
  },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('../utils/working-dir.js', () => ({
  createTempWorkingDir: mockCreateTempWorkingDir,
  cloneRepoInto: mockCloneRepoInto,
  cleanupWorkingDir: mockCleanupWorkingDir,
}));

vi.mock('../github/pullRequests.js', () => ({
  createPullRequest: mockCreatePullRequest,
}));

vi.mock('../github/issue-labels.js', () => ({
  moveIssueToInReview: mockMoveIssueToInReview,
}));

vi.mock('../utils/node-pty.js', () => ({
  ensureNodePtySpawnHelperExecutable: mockEnsureNodePtySpawnHelperExecutable,
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

function createIssue(number: number, title: string, body: string | null): GitHubIssue {
  return {
    id: 100 + number,
    number,
    title,
    body,
    state: 'open',
    labels: ['ready'],
    assignee: null,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
  };
}

function createCodexMockProcess(exitCode = 0): ReturnType<typeof nodePty.spawn> {
  return {
    onData: vi.fn(),
    onExit: vi.fn((callback: (exit: { exitCode: number; reason?: string }) => void) => {
      setTimeout(() => callback({ exitCode, reason: '' }), 10);
    }),
    kill: vi.fn(),
  } as unknown as ReturnType<typeof nodePty.spawn>;
}

describe('develop job', () => {
  const originalCodexPath = process.env['CODEX_CLI_PATH'];
  const originalCodexModel = process.env['CODEX_MODEL'];
  const originalCodexTimeout = process.env['CODEX_TIMEOUT_MS'];
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    mockEnsureNodePtySpawnHelperExecutable.mockResolvedValue(undefined);
    mockJobQueueAdd.mockResolvedValue(undefined);
    mockCreatePullRequest.mockResolvedValue({
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    });
    mockMoveIssueToInReview.mockResolvedValue(['in review']);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
    if (originalCodexPath !== undefined) {
      process.env['CODEX_CLI_PATH'] = originalCodexPath;
    } else {
      delete process.env['CODEX_CLI_PATH'];
    }
    if (originalCodexModel !== undefined) {
      process.env['CODEX_MODEL'] = originalCodexModel;
    } else {
      delete process.env['CODEX_MODEL'];
    }
    if (originalCodexTimeout !== undefined) {
      process.env['CODEX_TIMEOUT_MS'] = originalCodexTimeout;
    } else {
      delete process.env['CODEX_TIMEOUT_MS'];
    }
  });

  async function createJob(
    issue = createIssue(42, 'Test Issue', 'Test body')
  ): Promise<Job<DevelopJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'develop-ledger-'));
    tempRoots.push(workspacePath);
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'plan',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stages: {},
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'plan',
      toStage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: {
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
        assessment: {
          status: 'stubbed',
          summary: 'Assessment deferred for this iteration.',
        },
        plan: {
          status: 'stubbed',
          summary: 'Planning deferred for this iteration.',
        },
      },
    });

    return {
      id: 'job-develop',
      data: {
        taskId: 'task-develop',
        type: 'develop',
        runId: 'run-123',
        stage: 'develop',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef,
      },
    } as unknown as Job<DevelopJobData>;
  }

  it('uses the prepared workspace from the ledger and does not prepare the repository again', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);

    expect(mockCreateTempWorkingDir).not.toHaveBeenCalled();
    expect(mockCloneRepoInto).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(nodePty.spawn).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({ cwd: expect.stringContaining('develop-ledger-') })
    );
  });

  it('builds the codex command with issue and plan context and streams PTY output', async () => {
    const { runDevelopWork } = await import('./develop.js');
    const dataHandlers: Array<(data: string) => void> = [];
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);
    vi.mocked(nodePty.spawn).mockReturnValue({
      onData: vi.fn((callback: (data: string) => void) => {
        dataHandlers.push(callback);
      }),
      onExit: vi.fn((callback: (exit: { exitCode: number; reason?: string }) => void) => {
        setTimeout(() => callback({ exitCode: 0, reason: '' }), 10);
      }),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof nodePty.spawn>);
    const job = await createJob();

    await runDevelopWork(job);
    dataHandlers[0]('codex output');

    expect(mockEnsureNodePtySpawnHelperExecutable).toHaveBeenCalledTimes(1);
    expect(nodePty.spawn).toHaveBeenCalledWith(
      'npx',
      [
        '@openai/codex',
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        '--model',
        'gpt-5.4',
        expect.stringContaining('Issue #42: Test Issue'),
      ],
      expect.objectContaining({ cwd: expect.stringContaining('develop-ledger-') })
    );
    const prompt = vi.mocked(nodePty.spawn).mock.calls[0][1].at(-1);
    expect(prompt).toContain('Test body');
    expect(prompt).toContain('Planning deferred for this iteration.');
    expect(mockLogger.info).toHaveBeenCalledWith('[codex] codex output');
  });

  it('appends development output and enqueues quality-gate with an input record reference', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(records[1]).toMatchObject({
      fromStage: 'develop',
      toStage: 'quality-gate',
      output: {
        development: {
          status: 'completed',
          summary: 'Codex completed successfully.',
        },
      },
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('quality-gate', expect.objectContaining({
      type: 'quality-gate',
      stage: 'quality-gate',
      inputRecordRef: expect.objectContaining({
        recordId: '000002_develop_to_quality-gate',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('development');
  });

  it('fails when codex exits with a non-zero code', async () => {
    const { runDevelopWork } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess(1));
    const job = await createJob();

    await expect(runDevelopWork(job)).rejects.toThrow('codex process failed with exit code 1');
  });

  it('kills and fails the executor when codex times out', async () => {
    process.env['CODEX_TIMEOUT_MS'] = '1';
    const { runDevelopWork } = await import('./develop.js');
    const job = await createJob();
    const mockProcess = {
      onData: vi.fn(),
      onExit: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof nodePty.spawn>;
    vi.mocked(nodePty.spawn).mockReturnValue(mockProcess);

    await expect(runDevelopWork(job)).rejects.toThrow('codex process timed out after 1ms');
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does not commit, push, create pull requests, transition labels, or clean up terminal workspace', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);

    expect(spawn).not.toHaveBeenCalled();
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
  });
});
