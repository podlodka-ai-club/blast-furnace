import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, PrReworkIntakeJobData } from '../types/index.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
  readRunSummary,
  resolveOrchestrationStorageRoot,
  updateRunSummary,
  updateRunSummaryPendingNextStage,
} from './orchestration.js';

const { mockGetPullRequestState, mockRemoveReworkLabel, mockListReviewComments, mockListPullRequestComments } = vi.hoisted(() => ({
  mockGetPullRequestState: vi.fn(),
  mockRemoveReworkLabel: vi.fn(),
  mockListReviewComments: vi.fn(),
  mockListPullRequestComments: vi.fn(),
}));

const { mockCreateIssueComment } = vi.hoisted(() => ({
  mockCreateIssueComment: vi.fn(),
}));

const { mockJobQueueAdd } = vi.hoisted(() => ({
  mockJobQueueAdd: vi.fn(),
}));

const { mockRunCodexSession } = vi.hoisted(() => ({
  mockRunCodexSession: vi.fn(),
}));

vi.mock('../github/pullRequests.js', () => ({
  getPullRequestState: mockGetPullRequestState,
  removeReworkLabelFromPullRequest: mockRemoveReworkLabel,
  listPullRequestReviewComments: mockListReviewComments,
  listPullRequestComments: mockListPullRequestComments,
}));

vi.mock('../github/comments.js', () => ({
  createIssueComment: mockCreateIssueComment,
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

vi.mock('./codex-session.js', () => ({
  runCodexSession: mockRunCodexSession,
}));

vi.mock('../config/index.js', () => ({
  config: {
    github: {
      owner: 'test-owner',
      repo: 'test-repo',
      pollIntervalMs: 60000,
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

describe('pr-rework-intake job', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    mockRemoveReworkLabel.mockResolvedValue(undefined);
    mockCreateIssueComment.mockResolvedValue({ id: 99 });
    mockJobQueueAdd.mockResolvedValue({ id: 'next-job' });
    mockListReviewComments.mockResolvedValue([]);
    mockListPullRequestComments.mockResolvedValue([]);
    mockRunCodexSession.mockResolvedValue({
      cliCmd: 'codex',
      cliArgs: [],
      output: 'ROUTE: PLAN\nDefault test route.',
    });
  });

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createJob(reworkAttempt = 0): Promise<Job<PrReworkIntakeJobData>> {
    const root = await mkdtemp(join(tmpdir(), 'pr-rework-intake-'));
    tempRoots.push(root);
    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(root, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'sync-tracker-state',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
      reworkAttempt,
      latestHandoffRecord: null,
      stableContext: {
        issue: createIssue(),
        repository: { owner: 'test-owner', repo: 'test-repo' },
        branchName: 'issue-42-test-issue',
        workspacePath: '/tmp/old-workspace',
      },
      stages: {},
    });
    await appendHandoffRecordAndUpdateSummary(root, {
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
          summary: 'Original plan accepted.',
          content: '## Original Plan\nShip it.',
        },
      },
    });
    const makePr = await appendHandoffRecordAndUpdateSummary(root, {
      runId: 'run-123',
      fromStage: 'make-pr',
      toStage: 'sync-tracker-state',
      stageAttempt: 1,
      reworkAttempt,
      status: 'success',
      output: {
        status: 'pull-request-created',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt,
        pullRequest: {
          number: 7,
          htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
        },
      },
    });
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

    return {
      id: 'job-pr-rework-intake',
      data: {
        taskId: 'task-pr-rework-intake',
        type: 'pr-rework-intake',
        runId: 'run-123',
        stage: 'pr-rework-intake',
        stageAttempt: 1,
        reworkAttempt,
        inputRecordRef: sync.inputRecordRef,
      },
    } as unknown as Job<PrReworkIntakeJobData>;
  }

  function openPr(labels: string[] = []) {
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
      labels,
    });
  }

  it('re-enqueues itself without appending a handoff when the pull request is idle', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    openPr([]);

    await runPrReworkIntakeWork(job);

    expect(mockJobQueueAdd).toHaveBeenCalledWith('pr-rework-intake', job.data, { delay: 60000 });
    await expect(readHandoffRecords(job.data.inputRecordRef.handoffPath)).resolves.toHaveLength(3);
  });

  it('appends terminal success when the pull request is merged', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    mockGetPullRequestState.mockResolvedValue({
      number: 7,
      state: 'closed',
      merged: true,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      head: { owner: 'test-owner', repo: 'test-repo', branch: 'issue-42-test-issue', sha: 'abc123' },
      labels: [],
    });

    await runPrReworkIntakeWork(job);

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: null,
      output: { status: 'pull-request-merged' },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('appends terminal closure when the pull request is closed without merge', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    mockGetPullRequestState.mockResolvedValue({
      number: 7,
      state: 'closed',
      merged: false,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      head: { owner: 'test-owner', repo: 'test-repo', branch: 'issue-42-test-issue', sha: 'abc123' },
      labels: [],
    });

    await runPrReworkIntakeWork(job);

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: null,
      output: { status: 'pull-request-closed-without-merge' },
    });
  });

  it('terminates and comments when another rework would exceed the configured limit', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob(2);
    openPr(['Rework']);

    await runPrReworkIntakeWork(job);

    expect(mockCreateIssueComment).toHaveBeenCalledWith(42, expect.stringContaining('too many reworks'));
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      toStage: null,
      output: { status: 'too-many-reworks' },
    });
    expect(mockJobQueueAdd).not.toHaveBeenCalledWith('prepare-run', expect.anything());
  });

  it('consumes a Rework trigger without comments and schedules the next poll', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    openPr(['Rework']);

    await runPrReworkIntakeWork(job);

    expect(mockRemoveReworkLabel).toHaveBeenCalledWith(7);
    expect(mockCreateIssueComment).toHaveBeenCalledWith(7, expect.stringContaining('no review comments'));
    expect(mockCreateIssueComment).not.toHaveBeenCalledWith(42, expect.stringContaining('no review comments'));
    expect(mockJobQueueAdd).toHaveBeenCalledWith('pr-rework-intake', job.data, { delay: 60000 });
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      output: { status: 'no-comments-found' },
    });
  });

  it('creates a route handoff and delegates to Prepare Run when comments qualify', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    openPr(['Rework']);
    mockListReviewComments.mockResolvedValue([
      {
        id: 1,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'Please simplify implementation.',
        createdAt: '2026-04-30T10:00:00.000Z',
        outdated: false,
        resolved: false,
        deleted: false,
      },
    ]);

    await runPrReworkIntakeWork(job, {
      analyzeRoute: async () => 'ROUTE: DEVELOP\nImplementation-only.',
    });

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      status: 'rework-needed',
      reworkAttempt: 1,
      output: {
        status: 'rework-needed',
        selectedNextStage: 'develop',
        latestPlanRecordId: '000001_plan_to_develop',
        commentsMarkdown: expect.stringContaining('Please simplify implementation.'),
      },
    });
    expect(mockJobQueueAdd).toHaveBeenCalledWith('prepare-run', expect.objectContaining({
      type: 'prepare-run',
      stage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 1,
    }));
  });

  it('renders the review comments analysis prompt and invokes Codex route analysis by default', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    openPr(['Rework']);
    mockRunCodexSession.mockResolvedValueOnce({
      cliCmd: 'codex',
      cliArgs: [],
      output: 'ROUTE: DEVELOP\nLocal implementation-only feedback.',
    });
    mockListReviewComments.mockResolvedValue([
      {
        id: 1,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'Please simplify implementation.',
        createdAt: '2026-04-30T10:00:00.000Z',
        outdated: false,
        resolved: false,
        deleted: false,
      },
    ]);

    await runPrReworkIntakeWork(job);

    expect(mockRunCodexSession).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: process.cwd(),
      outputLastMessage: true,
      enableHooks: false,
      sandboxMode: 'read-only',
      logPrefix: 'pr-rework-intake-codex',
      timeoutLabel: 'PR Rework Intake route analysis codex process',
    }));
    const prompt = mockRunCodexSession.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('Test issue');
    expect(prompt).toContain('Issue body');
    expect(prompt).toContain('## Original Plan\nShip it.');
    expect(prompt).toContain('Please simplify implementation.');

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      output: {
        routeAnalysis: 'ROUTE: DEVELOP\nLocal implementation-only feedback.',
        selectedNextStage: 'develop',
      },
    });
  });

  it('exits without appending or enqueueing when an active durable marker exists', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    await updateRunSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), 'run-123', (summary) => ({
      ...summary,
      prReworkIntakeInProgress: {
        action: 'rework-route',
        inputRecordId: job.data.inputRecordRef.recordId,
      },
    }));
    openPr(['Rework']);

    await runPrReworkIntakeWork(job);

    expect(mockGetPullRequestState).not.toHaveBeenCalled();
    expect(mockJobQueueAdd).not.toHaveBeenCalled();
    await expect(readHandoffRecords(job.data.inputRecordRef.handoffPath)).resolves.toHaveLength(3);
  });

  it('does not append duplicate route handoffs when duplicate delayed jobs process the same trigger', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    openPr(['Rework']);
    mockListReviewComments.mockResolvedValue([
      {
        id: 1,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'Please simplify implementation.',
        createdAt: '2026-04-30T10:00:00.000Z',
        outdated: false,
        resolved: false,
        deleted: false,
      },
    ]);

    await runPrReworkIntakeWork(job, {
      analyzeRoute: async () => 'ROUTE: DEVELOP\nImplementation-only.',
    });
    await runPrReworkIntakeWork(job, {
      analyzeRoute: async () => 'ROUTE: DEVELOP\nImplementation-only.',
    });

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.filter((record) => record.fromStage === 'pr-rework-intake' && record.toStage === 'prepare-run')).toHaveLength(1);
    expect(mockJobQueueAdd).toHaveBeenCalledTimes(2);
    expect(mockJobQueueAdd.mock.calls[1][1]).toMatchObject({
      type: 'prepare-run',
      inputRecordRef: records.at(-1) && {
        recordId: records.at(-1)?.recordId,
      },
    });
  });

  it('uses the latest accepted rework Plan when prior rework was routed through Plan', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob(1);
    await appendHandoffRecordAndUpdateSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), {
      runId: 'run-123',
      fromStage: 'plan',
      toStage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 1,
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
        plan: {
          status: 'success',
          summary: 'Rework plan accepted.',
          content: '## Rework Plan\nUpdate tests.',
        },
      },
    });
    openPr(['Rework']);
    mockListReviewComments.mockResolvedValue([
      {
        id: 1,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'Please simplify implementation.',
        createdAt: '2026-04-30T10:00:00.000Z',
        outdated: false,
        resolved: false,
        deleted: false,
      },
    ]);

    await runPrReworkIntakeWork(job, {
      analyzeRoute: async () => 'ROUTE: PLAN\nNeeds planning.',
    });

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      output: {
        latestPlanRecordId: '000004_plan_to_develop',
      },
      dependsOn: expect.arrayContaining(['000004_plan_to_develop']),
    });
  });

  it('keeps the original accepted Plan when prior reworks were routed directly to Develop', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob(1);
    await appendHandoffRecordAndUpdateSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), {
      runId: 'run-123',
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 1,
      status: 'rework-needed',
      createdAt: '2026-04-30T10:00:00.000Z',
      output: {
        status: 'rework-needed',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
        pullRequest: { number: 7, htmlUrl: 'https://github.com/test-owner/test-repo/pull/7' },
        commentsMarkdown: 'comments',
        routeAnalysis: 'ROUTE: DEVELOP',
        selectedNextStage: 'develop',
        pullRequestHead: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'issue-42-test-issue',
          sha: 'abc123',
        },
        latestPlanRecordId: '000001_plan_to_develop',
      },
    });
    openPr(['Rework']);
    mockListReviewComments.mockResolvedValue([
      {
        id: 1,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'Please simplify implementation.',
        createdAt: '2026-04-30T10:30:00.000Z',
        outdated: false,
        resolved: false,
        deleted: false,
      },
    ]);

    await runPrReworkIntakeWork(job, {
      analyzeRoute: async () => 'ROUTE: DEVELOP\nImplementation-only.',
    });

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      output: {
        latestPlanRecordId: '000001_plan_to_develop',
      },
      dependsOn: expect.arrayContaining(['000001_plan_to_develop', '000004_pr-rework-intake_to_prepare-run']),
    });
  });

  it('uses the previous rework trigger createdAt as the comment lower bound', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob(1);
    await appendHandoffRecordAndUpdateSummary(resolveOrchestrationStorageRoot(job.data.inputRecordRef), {
      runId: 'run-123',
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 1,
      status: 'rework-needed',
      createdAt: '2026-04-30T10:00:00.000Z',
      output: {
        status: 'rework-needed',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
        pullRequest: { number: 7, htmlUrl: 'https://github.com/test-owner/test-repo/pull/7' },
        commentsMarkdown: 'comments',
        routeAnalysis: 'ROUTE: DEVELOP',
        selectedNextStage: 'develop',
        pullRequestHead: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'issue-42-test-issue',
          sha: 'abc123',
        },
        latestPlanRecordId: '000001_plan_to_develop',
      },
    });
    openPr(['Rework']);
    mockListReviewComments.mockResolvedValue([
      {
        id: 1,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'Old feedback.',
        createdAt: '2026-04-30T09:59:59.000Z',
        outdated: false,
        resolved: false,
        deleted: false,
      },
      {
        id: 2,
        authorLogin: 'reviewer',
        authorType: 'User',
        body: 'New feedback.',
        createdAt: '2026-04-30T10:30:00.000Z',
        outdated: false,
        resolved: false,
        deleted: false,
      },
    ]);

    await runPrReworkIntakeWork(job, {
      analyzeRoute: async () => 'ROUTE: DEVELOP\nImplementation-only.',
    });

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.at(-1)).toMatchObject({
      output: {
        commentsMarkdown: expect.stringContaining('New feedback.'),
      },
    });
    expect(records.at(-1)?.output).toEqual(expect.objectContaining({
      commentsMarkdown: expect.not.stringContaining('Old feedback.'),
    }));
  });

  it('recovers a missing Prepare Run enqueue from pending next-stage metadata', async () => {
    const { runPrReworkIntakeWork } = await import('./pr-rework-intake.js');
    const job = await createJob();
    const root = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    const route = await appendHandoffRecordAndUpdateSummary(root, {
      runId: 'run-123',
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 1,
      dependsOn: [job.data.inputRecordRef],
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
        latestPlanRecordId: '000003_assess_to_plan',
      },
    });
    await updateRunSummaryPendingNextStage(root, 'run-123', {
      stage: 'prepare-run',
      inputRecordRef: route.inputRecordRef,
      stageAttempt: 1,
      reworkAttempt: 1,
    });
    openPr(['Rework']);

    await runPrReworkIntakeWork(job);

    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    expect(records.filter((record) => record.fromStage === 'pr-rework-intake' && record.toStage === 'prepare-run')).toHaveLength(1);
    expect(mockJobQueueAdd).toHaveBeenCalledWith('prepare-run', expect.objectContaining({
      inputRecordRef: route.inputRecordRef,
      stageAttempt: 1,
      reworkAttempt: 1,
    }));
    await expect(readRunSummary(root, 'run-123')).resolves.toMatchObject({
      pendingNextStage: null,
    });
  });
});
