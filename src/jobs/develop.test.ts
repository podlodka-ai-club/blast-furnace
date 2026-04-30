import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { DevelopJobData, GitHubIssue, QualityGateResult } from '../types/index.js';
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

const { mockHandleDevelopStopHook, mockPrepareDevelopStopHook, mockReadFinalQualityResult } = vi.hoisted(() => ({
  mockHandleDevelopStopHook: vi.fn(),
  mockPrepareDevelopStopHook: vi.fn(),
  mockReadFinalQualityResult: vi.fn(),
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
    qualityGate: {
      testCommand: 'npm test',
      testTimeoutMs: 180000,
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

vi.mock('./develop-stop-hook.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./develop-stop-hook.js')>();
  return {
    ...actual,
    handleDevelopStopHook: mockHandleDevelopStopHook,
    prepareDevelopStopHook: mockPrepareDevelopStopHook,
  };
});

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
    mockHandleDevelopStopHook.mockReset();
    mockPrepareDevelopStopHook.mockReset();
    mockReadFinalQualityResult.mockReset();
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
    mockHandleDevelopStopHook.mockResolvedValue({ decision: 'allow' });
    mockReadFinalQualityResult.mockResolvedValue({
      status: 'passed',
      command: 'npm test',
      exitCode: 0,
      attempts: 1,
      durationMs: 42,
      summary: 'Quality Gate passed.',
      outputPath: '/tmp/run/quality/attempt-1.log',
    } satisfies QualityGateResult);
    mockPrepareDevelopStopHook.mockImplementation(async (options: {
      runDir: string;
      qualityGateTimeoutMs: number;
    }) => ({
      runDir: options.runDir,
      statePath: join(options.runDir, 'quality', 'stop-hook-state.json'),
      scriptPath: '/stable/develop-stop-hook-runner.js',
      env: {
        BLAST_FURNACE_STOP_HOOK_STATE_PATH: join(options.runDir, 'quality', 'stop-hook-state.json'),
        BLAST_FURNACE_STOP_HOOK_SCRIPT_PATH: '/stable/develop-stop-hook-runner.js',
      },
      hookCommand: 'node "/stable/develop-stop-hook-runner.js"',
      hookTimeoutSeconds: 185,
      readFinalQualityResult: mockReadFinalQualityResult,
    }));
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
    issue = createIssue(42, 'Test Issue', 'Test body'),
    stageAttempt = 1
  ): Promise<Job<DevelopJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'develop-ledger-'));
    tempRoots.push(workspacePath);
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'plan',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt,
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
          content: '## Summary\nReady.\n\n## Implementation Plan\nDo it.\n\n## Risks\nNone.',
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
        stageAttempt,
        reworkAttempt: 0,
        inputRecordRef,
      },
    } as unknown as Job<DevelopJobData>;
  }

  it('renders the Develop prompt with accepted Plan content only', async () => {
    const { renderDevelopPrompt } = await import('./develop.js');
    const root = await mkdtemp(join(tmpdir(), 'develop-prompt-'));
    tempRoots.push(root);
    const promptPath = join(root, 'develop.md');
    await writeFile(promptPath, [
      'Implement this plan:',
      '',
      '{{planContent}}',
    ].join('\n'));

    const prompt = await renderDevelopPrompt(promptPath, {
      planContent: '## Summary\nUse the accepted plan.',
    });

    expect(prompt).toContain('## Summary\nUse the accepted plan.');
    expect(prompt).not.toContain('{{planContent}}');
    expect(prompt).not.toContain('Issue #');
    expect(prompt).not.toContain('Test Issue');
    expect(prompt).not.toContain('Test body');
  });

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

  it('builds the codex command with accepted Plan content only and streams PTY output', async () => {
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
      expect.arrayContaining([
        '@openai/codex',
        'exec',
        '--enable',
        'codex_hooks',
        '--dangerously-bypass-approvals-and-sandbox',
        '--model',
        'gpt-5.4',
      ]),
      expect.objectContaining({ cwd: expect.stringContaining('develop-ledger-') })
    );
    const args = vi.mocked(nodePty.spawn).mock.calls[0][1];
    expect(args).not.toContain('--config');
    expect(args).not.toContain('resume');
    expect(args).not.toContain('--last');
    expect(args.some((arg) => arg.includes('hooks.Stop'))).toBe(false);
    const prompt = vi.mocked(nodePty.spawn).mock.calls[0][1].at(-1);
    expect(prompt).toContain('## Summary\nReady.');
    expect(prompt).toContain('## Implementation Plan\nDo it.');
    expect(prompt).not.toContain('Issue #42: Test Issue');
    expect(prompt).not.toContain('Test body');
    expect(prompt).not.toContain('Plan validated successfully.');
    expect(prompt).not.toContain('"status"');
    expect(mockLogger.info).toHaveBeenCalledWith('[codex] codex output');
    expect(mockPrepareDevelopStopHook).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: expect.stringContaining('develop-ledger-'),
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    }));
    expect(nodePty.spawn).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          BLAST_FURNACE_STOP_HOOK_STATE_PATH: expect.stringContaining('/quality/stop-hook-state.json'),
        }),
      })
    );
  });

  it('does not duplicate codex_hooks when the configured Codex invocation already enables it', async () => {
    const { buildCodexCliArgs } = await import('./develop.js');

    const args = buildCodexCliArgs(
      'codex',
      ['exec', '--enable', 'codex_hooks'],
      'Do the work',
      'gpt-5.4'
    );

    expect(args.filter((arg) => arg === '--enable')).toHaveLength(1);
    expect(args.filter((arg) => arg === 'codex_hooks')).toHaveLength(1);
  });

  it('appends development and passed quality output, then enqueues review by input record reference', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(records[1]).toMatchObject({
      fromStage: 'develop',
      toStage: 'review',
      status: 'success',
      dependsOn: ['000001_plan_to_develop'],
      output: {
        status: 'success',
        development: {
          status: 'completed',
          summary: 'Codex completed successfully.',
        },
        quality: {
          status: 'passed',
          command: 'npm test',
          attempts: 1,
        },
      },
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('review', expect.objectContaining({
      type: 'review',
      stage: 'review',
      inputRecordRef: expect.objectContaining({
        recordId: '000002_develop_to_review',
        stage: 'develop',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('development');
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('quality-gate', expect.anything());
  });

  it('preserves the develop stage attempt when enqueueing review after rework', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob(createIssue(42, 'Test Issue', 'Test body'), 2);

    await runDevelopFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('review', expect.objectContaining({
      stage: 'review',
      stageAttempt: 2,
      reworkAttempt: 0,
      inputRecordRef: expect.objectContaining({
        recordId: '000002_develop_to_review',
      }),
    }));
  });

  it('cleans successful quality artifacts after handoff and does not keep stale output paths', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();
    const qualityDir = join(job.data.inputRecordRef.runDir, 'quality');
    const outputPath = join(qualityDir, 'attempt-1.log');
    await mkdir(qualityDir, { recursive: true });
    await writeFile(outputPath, 'passing output', 'utf8');
    await writeFile(join(qualityDir, 'stop-hook-state.json'), '{}', 'utf8');
    mockReadFinalQualityResult.mockResolvedValue({
      status: 'passed',
      command: 'npm test',
      exitCode: 0,
      attempts: 1,
      durationMs: 42,
      summary: 'Quality Gate passed.',
      outputPath,
    } satisfies QualityGateResult);

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(records[1].output).toMatchObject({
      status: 'success',
      quality: {
        status: 'passed',
        command: 'npm test',
      },
    });
    expect(records[1].output).toEqual(expect.objectContaining({
      quality: expect.not.objectContaining({
        outputPath: expect.any(String),
      }),
    }));
    await expect(access(qualityDir)).rejects.toThrow();
  });

  it('runs the Quality Gate fallback when Codex exits without producing a Stop-hook result', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    mockReadFinalQualityResult
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        status: 'passed',
        command: 'npm test',
        exitCode: 0,
        attempts: 1,
        durationMs: 42,
        summary: 'Quality Gate passed from fallback.',
        outputPath: '/tmp/run/quality/attempt-1.log',
      } satisfies QualityGateResult);
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(mockHandleDevelopStopHook).toHaveBeenCalledWith({
      statePath: expect.stringContaining('/quality/stop-hook-state.json'),
      runDir: expect.stringContaining('/.orchestrator/runs/'),
      workspacePath: expect.stringContaining('develop-ledger-'),
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: {},
    });
    expect(records[1]).toMatchObject({
      fromStage: 'develop',
      toStage: 'review',
      status: 'success',
      output: {
        status: 'success',
        quality: {
          status: 'passed',
          summary: 'Quality Gate passed from fallback.',
        },
      },
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('review', expect.anything());
  });

  it('keeps running fallback Quality Gate until a terminal quality result is available', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    mockReadFinalQualityResult
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        status: 'failed',
        command: 'npm test',
        exitCode: 1,
        attempts: 3,
        durationMs: 200,
        summary: 'Tests failed after retry budget.',
        outputPath: '/tmp/run/quality/attempt-3.log',
      } satisfies QualityGateResult);
    mockHandleDevelopStopHook
      .mockResolvedValueOnce({ decision: 'block', reason: 'first failure' })
      .mockResolvedValueOnce({ decision: 'block', reason: 'second failure' })
      .mockResolvedValueOnce({ decision: 'allow' });
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(mockHandleDevelopStopHook).toHaveBeenCalledTimes(3);
    expect(records[1]).toMatchObject({
      fromStage: 'develop',
      toStage: null,
      status: 'failure',
      output: {
        status: 'quality-failed',
        quality: {
          status: 'failed',
          attempts: 3,
          summary: 'Tests failed after retry budget.',
        },
      },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('appends terminal quality-misconfigured output and does not enqueue downstream jobs', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    mockReadFinalQualityResult.mockResolvedValue({
      status: 'misconfigured',
      command: '',
      attempts: 1,
      durationMs: 0,
      summary: 'QUALITY_GATE_TEST_COMMAND is not configured.',
    } satisfies QualityGateResult);
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(records[1]).toMatchObject({
      fromStage: 'develop',
      toStage: null,
      status: 'blocked',
      output: {
        status: 'quality-misconfigured',
        quality: {
          status: 'misconfigured',
          command: '',
        },
      },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('appends terminal failed and timed-out quality output without review, make-pr, or tracker jobs', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    mockReadFinalQualityResult.mockResolvedValue({
      status: 'failed',
      command: 'npm test',
      exitCode: 1,
      attempts: 3,
      durationMs: 200,
      summary: 'Tests failed.',
    } satisfies QualityGateResult);
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(records[1]).toMatchObject({
      fromStage: 'develop',
      toStage: null,
      status: 'failure',
      output: {
        status: 'quality-failed',
        quality: {
          status: 'failed',
          attempts: 3,
        },
      },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('review', expect.anything());
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('make-pr', expect.anything());
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('sync-tracker-state', expect.anything());

    mockJobQueueAdd.mockClear();
    mockReadFinalQualityResult.mockResolvedValue({
      status: 'timed-out',
      command: 'npm test',
      attempts: 3,
      durationMs: 180000,
      summary: 'Tests timed out.',
    } satisfies QualityGateResult);
    const timedOutJob = await createJob(createIssue(43, 'Timeout Issue', 'Timeout body'));

    await runDevelopFlow(timedOutJob);
    const timedOutRecords = await readHandoffRecords(timedOutJob.data.inputRecordRef.handoffPath);

    expect(timedOutRecords[1]).toMatchObject({
      fromStage: 'develop',
      toStage: null,
      status: 'failure',
      output: {
        status: 'quality-timed-out',
        quality: {
          status: 'timed-out',
        },
      },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('keeps failed quality artifacts and preserves their output path in the terminal handoff', async () => {
    const { runDevelopFlow } = await import('./develop.js');
    vi.mocked(nodePty.spawn).mockReturnValue(createCodexMockProcess());
    const job = await createJob();
    const qualityDir = join(job.data.inputRecordRef.runDir, 'quality');
    const outputPath = join(qualityDir, 'attempt-3.log');
    await mkdir(qualityDir, { recursive: true });
    await writeFile(outputPath, 'failing output', 'utf8');
    mockReadFinalQualityResult.mockResolvedValue({
      status: 'failed',
      command: 'npm test',
      exitCode: 1,
      attempts: 3,
      durationMs: 200,
      summary: 'Tests failed.',
      outputPath,
    } satisfies QualityGateResult);

    await runDevelopFlow(job);
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(records[1].output).toMatchObject({
      status: 'quality-failed',
      quality: {
        status: 'failed',
        outputPath,
      },
    });
    await expect(access(outputPath)).resolves.toBeUndefined();
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
