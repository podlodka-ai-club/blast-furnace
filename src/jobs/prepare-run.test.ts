import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, PrepareRunJobData } from '../types/index.js';
import { spawn } from 'child_process';
import { createPrepareRunPayload, runPrepareRunFlow, runPrepareRunWork } from './prepare-run.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
  readRunSummary,
} from './orchestration.js';

const TEMP_DIR = '/tmp/prepare-run-abc123';
let orchestrationRoot: string;
const originalOrchestrationRoot = process.env['ORCHESTRATION_STORAGE_ROOT'];

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
  createGitCommandEnv: () => ({
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic test-credentials',
  }),
  getRepoRemoteUrl: () => 'https://github.com/test-owner/test-repo.git',
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('prepare-run job', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    orchestrationRoot = await mkdtemp(join(tmpdir(), 'blast-orchestration-root-'));
    process.env['ORCHESTRATION_STORAGE_ROOT'] = orchestrationRoot;
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
    await rm(orchestrationRoot, { recursive: true, force: true });
    if (originalOrchestrationRoot === undefined) {
      delete process.env['ORCHESTRATION_STORAGE_ROOT'];
    } else {
      process.env['ORCHESTRATION_STORAGE_ROOT'] = originalOrchestrationRoot;
    }
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

  it('initializes run metadata in the orchestration root without creating a run log', async () => {
    const job = createJob();

    const result = await runPrepareRunWork(job);
    const records = await readHandoffRecords(result.assessJobData.inputRecordRef.handoffPath);
    const summary = await readRunSummary(orchestrationRoot, 'run-123');

    expect(result).not.toHaveProperty('runLogPath');
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
    expect(relative(orchestrationRoot, result.assessJobData.inputRecordRef.runDir)).not.toMatch(/^\.\./);
    expect(relative(orchestrationRoot, result.assessJobData.inputRecordRef.handoffPath)).not.toMatch(/^\.\./);
    expect(result.assessJobData.inputRecordRef.runDir).not.toContain(TEMP_DIR);
    expect(result.assessJobData.inputRecordRef.handoffPath).not.toContain(TEMP_DIR);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      fromStage: 'prepare-run',
      toStage: 'assess',
      dependsOn: [],
      output: {
        status: 'success',
      },
    });
    expect(records[0]).not.toHaveProperty('nextInput');
    expect(records[0].output).not.toHaveProperty('issue');
    expect(records[0].output).not.toHaveProperty('repository');
    expect(records[0].output).not.toHaveProperty('branchName');
    expect(records[0].output).not.toHaveProperty('workspacePath');
    expect(summary).toMatchObject({
      runId: 'run-123',
      currentStage: 'assess',
      stableContext: {
        issue: job.data.issue,
        repository: job.data.repository,
        branchName: 'issue-42-test-issue',
        workspacePath: TEMP_DIR,
      },
      timestampPrefix: expect.stringMatching(/^\d{4}-\d{2}-\d{2}_\d{2}\.\d{2}$/),
      runDirectory: expect.stringContaining('.orchestrator/runs/'),
      runSummaryPath: expect.stringContaining('_run.json'),
      handoffLedgerPath: expect.stringContaining('_handoff.jsonl'),
      latestHandoffRecord: {
        recordId: '000001_prepare-run_to_assess',
      },
    });
    expect(summary?.runDirectory).toBe(result.assessJobData.inputRecordRef.runDir);
    expect(summary?.handoffLedgerPath).toBe(result.assessJobData.inputRecordRef.handoffPath);
    expect(summary?.runSummaryPath).toEqual(expect.stringContaining(orchestrationRoot));
    expect(summary?.runSummaryPath).not.toContain(TEMP_DIR);
    expect(await pathExists(join(result.assessJobData.inputRecordRef.runDir, 'run.log'))).toBe(false);
    expect(await pathExists(join(TEMP_DIR, '.orchestrator'))).toBe(false);
  });

  it('continues from a pre-initialized run summary created by Intake', async () => {
    const issue = createIssue();
    const fileSet = createRunFileSet(orchestrationRoot, 'run-123', new Date('2026-04-30T10:00:00.000Z'));
    await initializeRunSummary(orchestrationRoot, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-30T10:00:00.000Z',
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      initialContext: {
        issue,
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
        },
      },
      stages: {
        intake: {
          attempts: 1,
          status: 'success',
        },
      },
    });

    await runPrepareRunWork(createJob(issue));

    await expect(readRunSummary(orchestrationRoot, 'run-123')).resolves.toMatchObject({
      initialContext: {
        issue,
      },
      stableContext: {
        issue,
        branchName: 'issue-42-test-issue',
        workspacePath: TEMP_DIR,
      },
      trackerStatus: {
        checklist: expect.arrayContaining([
          expect.objectContaining({ id: 'prepare-run:attempt-1', state: 'completed' }),
        ]),
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
      'https://github.com/test-owner/test-repo.git'
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['fetch', 'https://github.com/test-owner/test-repo.git', 'heads/issue-42-test-issue'],
      {
        cwd: TEMP_DIR,
        env: expect.objectContaining({
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic test-credentials',
        }),
      }
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '-b', 'issue-42-test-issue', '--track', 'origin/issue-42-test-issue'],
      {
        cwd: TEMP_DIR,
        env: expect.objectContaining({
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic test-credentials',
        }),
      }
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'origin/issue-42-test-issue'],
      {
        cwd: TEMP_DIR,
        env: expect.objectContaining({
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic test-credentials',
        }),
      }
    );
  });

  it('clones into an empty target workspace and keeps orchestrator metadata out of it', async () => {
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
      'https://github.com/test-owner/test-repo.git'
    );
    expect(await pathExists(join(TEMP_DIR, '.orchestrator'))).toBe(false);
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

  async function createReworkJob(route: 'plan' | 'develop' = 'plan'): Promise<Job<PrepareRunJobData>> {
    const issue = createIssue();
    const fileSet = createRunFileSet(orchestrationRoot, 'run-123', new Date('2026-04-30T10:00:00.000Z'));
    await initializeRunSummary(orchestrationRoot, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'pr-rework-intake',
      runStartedAt: '2026-04-30T10:00:00.000Z',
      stageAttempt: 1,
      reworkAttempt: 1,
      latestHandoffRecord: null,
      stableContext: {
        issue,
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
        },
        branchName: 'issue-42-test-issue',
        workspacePath: '/tmp/old-workspace',
      },
      stages: {},
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: 'run-123',
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 1,
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
        routeAnalysis: route === 'develop' ? 'ROUTE: DEVELOP' : 'ROUTE: PLAN',
        selectedNextStage: route,
        pullRequestHead: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'issue-42-test-issue',
          sha: 'abc123',
        },
        latestPlanRecordId: '000001_plan_to_develop',
      },
    });

    return createJob(issue, {
      reworkAttempt: 1,
      inputRecordRef,
    });
  }

  it('prepares a rework workspace from the existing PR head and forwards stageAttempt 1 to Plan', async () => {
    const job = await createReworkJob('plan');

    const result = await runPrepareRunWork(job);
    const records = await readHandoffRecords(job.data.inputRecordRef?.handoffPath ?? '');
    const summary = await readRunSummary(orchestrationRoot, 'run-123');

    expect(mockGetRef).not.toHaveBeenCalledWith('main');
    expect(mockPushBranch).not.toHaveBeenCalled();
    expect(mockCloneRepoInto).toHaveBeenCalledWith(TEMP_DIR, 'https://github.com/test-owner/test-repo.git');
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['fetch', 'https://github.com/test-owner/test-repo.git', 'heads/issue-42-test-issue'],
      expect.objectContaining({ cwd: TEMP_DIR })
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'abc123'],
      expect.objectContaining({ cwd: TEMP_DIR })
    );
    expect(result).toMatchObject({
      nextJobData: {
        type: 'plan',
        stage: 'plan',
        stageAttempt: 1,
        reworkAttempt: 1,
      },
    });
    expect(records.at(-1)).toMatchObject({
      fromStage: 'prepare-run',
      toStage: 'plan',
      dependsOn: [job.data.inputRecordRef?.recordId],
      stageAttempt: 1,
      reworkAttempt: 1,
    });
    expect(summary).toMatchObject({
      stableContext: {
        branchName: 'issue-42-test-issue',
        workspacePath: TEMP_DIR,
      },
    });
  });

  it('rejects rework PR heads from forks before workspace side effects', async () => {
    const job = await createReworkJob('develop');
    const records = await readHandoffRecords(job.data.inputRecordRef?.handoffPath ?? '');
    const reworkRecord = records.at(-1);
    if (!reworkRecord || typeof reworkRecord.output !== 'object' || reworkRecord.output === null) {
      throw new Error('Expected rework record');
    }
    reworkRecord.output = {
      ...reworkRecord.output,
      pullRequestHead: {
        owner: 'other-owner',
        repo: 'other-repo',
        branch: 'issue-42-test-issue',
        sha: 'abc123',
      },
    };
    await rm(job.data.inputRecordRef?.handoffPath ?? '', { force: true });
    for (const record of records) {
      await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId: record.runId,
        fromStage: record.fromStage,
        toStage: record.toStage,
        stageAttempt: record.stageAttempt,
        reworkAttempt: record.reworkAttempt,
        dependsOn: record.dependsOn,
        status: record.status,
        output: record.output,
        createdAt: record.createdAt,
      });
    }

    await expect(runPrepareRunWork(job)).rejects.toThrow('Rework pull request head repository mismatch');

    expect(mockCreateTempWorkingDir).not.toHaveBeenCalled();
    expect(mockCloneRepoInto).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('enqueues the selected rework next stage instead of Assess', async () => {
    const job = await createReworkJob('develop');

    await runPrepareRunFlow(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('develop', expect.objectContaining({
      type: 'develop',
      stage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 1,
      inputRecordRef: expect.objectContaining({
        stage: 'prepare-run',
      }),
    }));
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('assess', expect.anything());
  });

  it('keeps the previous current workspace pointer and cleans up when rework preparation fails', async () => {
    const job = await createReworkJob('plan');
    mockCloneRepoInto.mockRejectedValue(new Error('clone failed'));

    await expect(runPrepareRunFlow(job)).rejects.toThrow('clone failed');

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
    await expect(readRunSummary(orchestrationRoot, 'run-123')).resolves.toMatchObject({
      stableContext: {
        workspacePath: '/tmp/old-workspace',
      },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });
});
