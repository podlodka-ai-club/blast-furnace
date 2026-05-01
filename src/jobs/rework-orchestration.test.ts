import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { spawn } from 'child_process';
import type {
  DevelopJobData,
  GitHubIssue,
  InputRecordRef,
  MakePrJobData,
  PlanJobData,
  PrepareRunJobData,
  PrReworkIntakeJobData,
  RepositoryIdentity,
  ReviewJobData,
  SyncTrackerStateJobData,
} from '../types/index.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
  readRunSummary,
} from './orchestration.js';
import { runDevelopWork } from './develop.js';
import { runMakePrWork } from './make-pr.js';
import { runPlanWork } from './plan.js';
import { runPrepareRunWork } from './prepare-run.js';
import { runPrReworkIntakeWork } from './pr-rework-intake.js';
import { runReviewWork } from './review.js';
import { runSyncTrackerStateFlow } from './sync-tracker-state.js';

const { mockCreateJobLogger, mockJobQueueAdd } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
  mockJobQueueAdd: vi.fn(),
}));

const { mockCreateTempWorkingDir, mockCloneRepoInto, mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCreateTempWorkingDir: vi.fn(),
  mockCloneRepoInto: vi.fn(),
  mockCleanupWorkingDir: vi.fn(),
}));

const {
  mockCreatePullRequest,
  mockGetPullRequestState,
  mockListPullRequestComments,
  mockListPullRequestReviewComments,
  mockRemoveReworkLabelFromPullRequest,
} = vi.hoisted(() => ({
  mockCreatePullRequest: vi.fn(),
  mockGetPullRequestState: vi.fn(),
  mockListPullRequestComments: vi.fn(),
  mockListPullRequestReviewComments: vi.fn(),
  mockRemoveReworkLabelFromPullRequest: vi.fn(),
}));

const { mockCreateIssueComment } = vi.hoisted(() => ({
  mockCreateIssueComment: vi.fn(),
}));

const { mockMoveIssueToInReview } = vi.hoisted(() => ({
  mockMoveIssueToInReview: vi.fn(),
}));

const { mockGetRef, mockPushBranch, mockDeleteBranch } = vi.hoisted(() => ({
  mockGetRef: vi.fn(),
  mockPushBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
}));

const {
  mockRunCodexSession,
  mockPrepareDevelopStopHook,
  mockHandleDevelopStopHook,
  mockCleanupSuccessfulQualityArtifacts,
} = vi.hoisted(() => ({
  mockRunCodexSession: vi.fn(),
  mockPrepareDevelopStopHook: vi.fn(),
  mockHandleDevelopStopHook: vi.fn(),
  mockCleanupSuccessfulQualityArtifacts: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

vi.mock('../utils/working-dir.js', () => ({
  createTempWorkingDir: mockCreateTempWorkingDir,
  cloneRepoInto: mockCloneRepoInto,
  cleanupWorkingDir: mockCleanupWorkingDir,
  createGitCommandEnv: () => ({
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic test-credentials',
  }),
  getRepoRemoteUrl: () => 'https://github.com/test-owner/test-repo.git',
}));

vi.mock('../github/pullRequests.js', () => ({
  createPullRequest: mockCreatePullRequest,
  getPullRequestState: mockGetPullRequestState,
  listPullRequestComments: mockListPullRequestComments,
  listPullRequestReviewComments: mockListPullRequestReviewComments,
  removeReworkLabelFromPullRequest: mockRemoveReworkLabelFromPullRequest,
}));

vi.mock('../github/comments.js', () => ({
  createIssueComment: mockCreateIssueComment,
  listIssueComments: vi.fn().mockResolvedValue([]),
  updateIssueComment: vi.fn(),
}));

vi.mock('../github/issue-labels.js', () => ({
  moveIssueToInReview: mockMoveIssueToInReview,
}));

vi.mock('../github/branches.js', () => ({
  getRef: mockGetRef,
  pushBranch: mockPushBranch,
  deleteBranch: mockDeleteBranch,
}));

vi.mock('./codex-session.js', () => ({
  buildCodexSessionArgs: vi.fn(() => ['codex']),
  runCodexSession: mockRunCodexSession,
}));

vi.mock('./develop-stop-hook.js', () => ({
  prepareDevelopStopHook: mockPrepareDevelopStopHook,
  handleDevelopStopHook: mockHandleDevelopStopHook,
  cleanupSuccessfulQualityArtifacts: mockCleanupSuccessfulQualityArtifacts,
  qualityResultForHandoff: (quality: unknown) => quality,
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
      timeoutMs: 600000,
    },
    qualityGate: {
      testCommand: 'npm test',
      testTimeoutMs: 180000,
    },
    review: {
      attemptLimit: 3,
    },
    rework: {
      maxHumanReworkAttempts: 3,
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

function makeJob<TData>(data: TData, id = `job-${String((data as { stage?: string }).stage ?? 'stage')}`): Job<TData> {
  return {
    id,
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<TData>;
}

function openPullRequest(labels = ['Rework']) {
  return {
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
    labels,
  };
}

interface PostPrRun {
  root: string;
  workspacePath: string;
  syncInput: InputRecordRef;
  prReworkJobData: PrReworkIntakeJobData;
  syncTrackerStateJobData: SyncTrackerStateJobData;
}

async function createPostPrRun(options: {
  withSyncHandoff?: boolean;
  reworkAttempt?: number;
  makePrStatus?: 'pull-request-created' | 'no-changes';
} = {}): Promise<PostPrRun> {
  const root = await mkdtemp(join(tmpdir(), 'rework-orchestration-'));
  const workspacePath = await mkdtemp(join(tmpdir(), 'rework-target-'));
  tempRoots.push(root, workspacePath);
  const repository: RepositoryIdentity = {
    owner: 'test-owner',
    repo: 'test-repo',
  };
  const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
  const reworkAttempt = options.reworkAttempt ?? 0;
  await initializeRunSummary(root, fileSet, {
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
  const plan = await appendHandoffRecordAndUpdateSummary(root, {
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
        summary: 'Initial plan accepted.',
        content: '## Summary\nInitial plan.',
      },
    },
  });
  const makePr = await appendHandoffRecordAndUpdateSummary(root, {
    runId: 'run-123',
    fromStage: 'make-pr',
    toStage: 'sync-tracker-state',
    stageAttempt: 1,
    reworkAttempt,
    dependsOn: [plan.inputRecordRef],
    status: 'success',
    output: {
      status: options.makePrStatus ?? 'pull-request-created',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt,
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    },
  });
  const syncTrackerStateJobData: SyncTrackerStateJobData = {
    taskId: 'task-sync-tracker-state',
    type: 'sync-tracker-state',
    runId: 'run-123',
    stage: 'sync-tracker-state',
    stageAttempt: 1,
    reworkAttempt,
    inputRecordRef: makePr.inputRecordRef,
  };

  let syncInput = makePr.inputRecordRef;
  if (options.withSyncHandoff ?? true) {
    const sync = await appendHandoffRecordAndUpdateSummary(root, {
      runId: 'run-123',
      fromStage: 'sync-tracker-state',
      toStage: 'pr-rework-intake',
      stageAttempt: 1,
      reworkAttempt,
      dependsOn: [makePr.inputRecordRef],
      status: 'success',
      output: {
        status: 'tracker-synced',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt,
        trackerLabels: ['in review'],
      },
    });
    syncInput = sync.inputRecordRef;
  }

  return {
    root,
    workspacePath,
    syncInput,
    prReworkJobData: {
      taskId: 'task-pr-rework-intake',
      type: 'pr-rework-intake',
      runId: 'run-123',
      stage: 'pr-rework-intake',
      stageAttempt: 1,
      reworkAttempt,
      inputRecordRef: syncInput,
    },
    syncTrackerStateJobData,
  };
}

function prepareRunJobData(inputRecordRef: InputRecordRef, reworkAttempt: number): PrepareRunJobData {
  return {
    taskId: 'task-prepare-run',
    type: 'prepare-run',
    runId: 'run-123',
    stage: 'prepare-run',
    stageAttempt: 1,
    reworkAttempt,
    issue: createIssue(),
    repository: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
    inputRecordRef,
  };
}

async function writePlanArtifacts(root: string) {
  const checksPath = join(root, 'plan-checks.yaml');
  const templatePath = join(root, 'plan-rework.md');
  await writeFile(checksPath, 'requiredTitles:\n  - Summary\n');
  await writeFile(templatePath, 'Review comments:\n{{commentsMarkdown}}\n\nLatest plan:\n{{latestPlanContent}}\n');
  return { checksPath, templatePath };
}

async function runReworkRoute(route: 'plan' | 'develop') {
  const run = await createPostPrRun();
  const reworkJob = makeJob(run.prReworkJobData);
  await runPrReworkIntakeWork(reworkJob, {
    analyzeRoute: async () => route === 'develop' ? 'ROUTE: DEVELOP\nUse direct edits.' : 'ROUTE: PLAN\nRevise the plan.',
  });
  const prReworkRecords = await readHandoffRecords(run.syncInput.handoffPath);
  const prReworkRecord = prReworkRecords.at(-1);
  if (!prReworkRecord) throw new Error('PR Rework Intake record not found');

  const prepareResult = await runPrepareRunWork(makeJob(prepareRunJobData({
    runDir: run.syncInput.runDir,
    handoffPath: run.syncInput.handoffPath,
    recordId: prReworkRecord.recordId,
    sequence: prReworkRecord.sequence,
    stage: 'pr-rework-intake',
  }, 1)));

  let developJobData: DevelopJobData | undefined;
  if (route === 'plan') {
    const planJobData = prepareResult.nextJobData as PlanJobData;
    const artifacts = await writePlanArtifacts(run.root);
    const planResult = await runPlanWork(makeJob(planJobData), {
      checksPath: artifacts.checksPath,
      promptTemplatePath: artifacts.templatePath,
      createPlanningSession: async () => ({
        send: vi.fn().mockResolvedValue('## Summary\nRework plan accepted.'),
      }),
    });
    developJobData = planResult.developJobData;
  } else {
    developJobData = prepareResult.nextJobData as DevelopJobData;
  }

  if (!developJobData) throw new Error('Develop job data not produced');
  const developResult = await runDevelopWork(makeJob(developJobData));
  if (!developResult.reviewJobData) throw new Error('Review job data not produced');
  const reviewResult = await runReviewWork(makeJob(developResult.reviewJobData as ReviewJobData));
  if (reviewResult.status !== 'success') throw new Error('Review did not pass');
  const makePrResult = await runMakePrWork(makeJob(reviewResult.makePrJobData as MakePrJobData));
  if (!makePrResult.syncTrackerStateJobData) throw new Error('Sync Tracker State job data not produced');
  await runSyncTrackerStateFlow(makeJob(makePrResult.syncTrackerStateJobData));

  return run;
}

const tempRoots: string[] = [];

describe('human PR rework orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    mockJobQueueAdd.mockResolvedValue({ id: 'queued' });
    mockCreateTempWorkingDir.mockResolvedValue('/tmp/rework-prepared-workspace');
    mockCloneRepoInto.mockResolvedValue(undefined);
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    mockGetRef.mockResolvedValue({ object: { sha: 'abc123' } });
    mockPushBranch.mockResolvedValue(undefined);
    mockDeleteBranch.mockResolvedValue(undefined);
    mockCreatePullRequest.mockResolvedValue({
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    });
    mockGetPullRequestState.mockResolvedValue(openPullRequest());
    mockListPullRequestReviewComments.mockResolvedValue([
      {
        id: 11,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'Please update the implementation.',
        createdAt: '2026-04-26T09:00:00.000Z',
        path: 'src/example.ts',
        line: 12,
        outdated: false,
        resolved: false,
        deleted: false,
      },
    ]);
    mockListPullRequestComments.mockResolvedValue([]);
    mockRemoveReworkLabelFromPullRequest.mockResolvedValue(undefined);
    mockCreateIssueComment.mockResolvedValue({
      id: 100,
      body: 'comment',
      createdAt: '2026-04-26T09:00:00.000Z',
      updatedAt: '2026-04-26T09:00:00.000Z',
    });
    mockMoveIssueToInReview.mockResolvedValue(['in review']);
    vi.mocked(spawn).mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        return createGitMockProcess(0, 'M src/example.ts');
      }
      return createGitMockProcess();
    });
    mockRunCodexSession.mockResolvedValue({ output: 'Review Success' });
    mockPrepareDevelopStopHook.mockResolvedValue({
      env: {},
      statePath: '/tmp/rework-stop-hook-state.json',
      runDir: '/tmp/rework-stop-hook-run',
      readFinalQualityResult: vi.fn().mockResolvedValue({
        status: 'passed',
        command: 'npm test',
        exitCode: 0,
        attempts: 1,
        durationMs: 10,
        summary: 'Quality Gate passed.',
      }),
    });
    mockHandleDevelopStopHook.mockResolvedValue({ decision: 'allow' });
    mockCleanupSuccessfulQualityArtifacts.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('continues from initial pull request tracker synchronization into PR Rework Intake polling', async () => {
    const run = await createPostPrRun({ withSyncHandoff: false });

    await runSyncTrackerStateFlow(makeJob(run.syncTrackerStateJobData));
    const records = await readHandoffRecords(run.syncTrackerStateJobData.inputRecordRef.handoffPath);
    const summary = await readRunSummary(run.root, 'run-123');

    expect(records.at(-1)).toMatchObject({
      fromStage: 'sync-tracker-state',
      toStage: 'pr-rework-intake',
      reworkAttempt: 0,
    });
    expect(summary).toMatchObject({
      status: 'running',
      currentStage: 'pr-rework-intake',
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('pr-rework-intake', expect.objectContaining({
      stage: 'pr-rework-intake',
      reworkAttempt: 0,
    }));
  });

  it('routes a Rework label through Prepare Run, Plan, Develop, Review, Make PR, Sync Tracker State, and back to polling', async () => {
    const run = await runReworkRoute('plan');
    const records = await readHandoffRecords(run.syncInput.handoffPath);

    expect(records.map((record) => `${record.fromStage}->${record.toStage ?? 'terminal'}`)).toEqual([
      'plan->develop',
      'make-pr->sync-tracker-state',
      'sync-tracker-state->pr-rework-intake',
      'pr-rework-intake->prepare-run',
      'prepare-run->plan',
      'plan->develop',
      'develop->review',
      'review->make-pr',
      'make-pr->sync-tracker-state',
      'sync-tracker-state->pr-rework-intake',
    ]);
    expect(records.slice(3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromStage: 'pr-rework-intake', reworkAttempt: 1, stageAttempt: 1 }),
      expect.objectContaining({ fromStage: 'prepare-run', toStage: 'plan', reworkAttempt: 1, stageAttempt: 1 }),
      expect.objectContaining({ fromStage: 'make-pr', toStage: 'sync-tracker-state', reworkAttempt: 1 }),
    ]));
    expect(mockRemoveReworkLabelFromPullRequest).toHaveBeenCalledWith(7);
  });

  it('routes a Rework label directly through Develop, Quality Gate, Review, Make PR, Sync Tracker State, and back to polling', async () => {
    const run = await runReworkRoute('develop');
    const records = await readHandoffRecords(run.syncInput.handoffPath);

    expect(records.map((record) => `${record.fromStage}->${record.toStage ?? 'terminal'}`)).toEqual([
      'plan->develop',
      'make-pr->sync-tracker-state',
      'sync-tracker-state->pr-rework-intake',
      'pr-rework-intake->prepare-run',
      'prepare-run->develop',
      'develop->review',
      'review->make-pr',
      'make-pr->sync-tracker-state',
      'sync-tracker-state->pr-rework-intake',
    ]);
    expect(records.filter((record) => record.fromStage === 'plan')).toHaveLength(1);
    expect(records.at(-1)).toMatchObject({
      fromStage: 'sync-tracker-state',
      toStage: 'pr-rework-intake',
      reworkAttempt: 1,
    });
  });

  it('closes the run successfully when the pull request is merged', async () => {
    const run = await createPostPrRun();
    mockGetPullRequestState.mockResolvedValue({
      ...openPullRequest([]),
      state: 'closed',
      merged: true,
    });

    await runPrReworkIntakeWork(makeJob(run.prReworkJobData));
    const records = await readHandoffRecords(run.syncInput.handoffPath);
    const summary = await readRunSummary(run.root, 'run-123');

    expect(records.at(-1)).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: null,
      status: 'success',
      output: {
        status: 'pull-request-merged',
      },
    });
    expect(summary).toMatchObject({
      status: 'completed',
      currentStage: null,
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('terminates the run when the pull request is closed without merge', async () => {
    const run = await createPostPrRun();
    mockGetPullRequestState.mockResolvedValue({
      ...openPullRequest([]),
      state: 'closed',
      merged: false,
    });

    await runPrReworkIntakeWork(makeJob(run.prReworkJobData));
    const records = await readHandoffRecords(run.syncInput.handoffPath);
    const summary = await readRunSummary(run.root, 'run-123');

    expect(records.at(-1)).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: null,
      status: 'failure',
      output: {
        status: 'pull-request-closed-without-merge',
      },
    });
    expect(summary).toMatchObject({
      status: 'terminated',
      currentStage: null,
    });
  });

  it('terminates after too many human reworks without scheduling implementation work', async () => {
    const run = await createPostPrRun({ reworkAttempt: 2 });
    mockGetPullRequestState.mockResolvedValue(openPullRequest(['Rework']));

    await runPrReworkIntakeWork(makeJob(run.prReworkJobData));
    const records = await readHandoffRecords(run.syncInput.handoffPath);
    const summary = await readRunSummary(run.root, 'run-123');

    expect(mockCreateIssueComment).toHaveBeenCalledWith(42, expect.stringContaining('too many reworks'));
    expect(records.at(-1)).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: null,
      status: 'failure',
      output: {
        status: 'too-many-reworks',
      },
    });
    expect(summary).toMatchObject({ status: 'terminated' });
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('prepare-run', expect.anything());
  });

  it('consumes a no-comment Rework trigger and schedules the next poll without implementation work', async () => {
    const run = await createPostPrRun();
    mockGetPullRequestState.mockResolvedValue(openPullRequest(['Rework']));
    mockListPullRequestReviewComments.mockResolvedValue([]);
    mockListPullRequestComments.mockResolvedValue([]);

    await runPrReworkIntakeWork(makeJob(run.prReworkJobData));
    const records = await readHandoffRecords(run.syncInput.handoffPath);
    const summary = await readRunSummary(run.root, 'run-123');

    expect(mockRemoveReworkLabelFromPullRequest).toHaveBeenCalledWith(7);
    expect(mockCreateIssueComment).toHaveBeenCalledWith(42, expect.stringContaining('no review comments'));
    expect(records.at(-1)).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: null,
      output: {
        status: 'no-comments-found',
      },
    });
    expect(summary).toMatchObject({
      status: 'running',
      currentStage: null,
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('pr-rework-intake', run.prReworkJobData, { delay: 60000 });
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('prepare-run', expect.anything());
  });
});
