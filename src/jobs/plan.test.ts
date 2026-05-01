import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { GitHubIssue, PlanJobData } from '../types/index.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  readHandoffRecords,
} from './orchestration.js';

const { mockJobQueueAdd, mockCreateJobLogger } = vi.hoisted(() => ({
  mockJobQueueAdd: vi.fn(),
  mockCreateJobLogger: vi.fn(),
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
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

describe('plan job', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    mockJobQueueAdd.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createJob(): Promise<Job<PlanJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'plan-ledger-'));
    tempRoots.push(workspacePath);
    const issue = createIssue();
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      stageAttempt: 1,
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
    const first = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'prepare-run',
      toStage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 0,
      },
    });
    const second = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'assess',
      toStage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: [first.inputRecordRef],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 0,
        assessment: {
          status: 'stubbed',
          summary: 'Assessment deferred for this iteration.',
        },
      },
    });

    return {
      id: 'job-plan',
      data: {
        taskId: 'task-plan',
        type: 'plan',
        runId: 'run-123',
        stage: 'plan',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef: second.inputRecordRef,
      },
    } as unknown as Job<PlanJobData>;
  }

  async function createReworkJob(): Promise<Job<PlanJobData>> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'plan-rework-ledger-'));
    tempRoots.push(workspacePath);
    const issue = createIssue();
    const fileSet = createRunFileSet(workspacePath, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(workspacePath, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-26T08:07:30.000Z',
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
        workspacePath,
      },
      stages: {},
    });
    const originalPlan = await appendHandoffRecordAndUpdateSummary(workspacePath, {
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
          content: '## Summary\nOriginal accepted plan.',
        },
      },
    });
    const prRework = await appendHandoffRecordAndUpdateSummary(workspacePath, {
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
        commentsMarkdown: '## Review Comments\n\nPlease simplify the implementation.',
        routeAnalysis: 'ROUTE: PLAN\nNeeds planning.',
        selectedNextStage: 'plan',
        pullRequestHead: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'issue-42-test-issue',
          sha: 'abc123',
        },
        latestPlanRecordId: originalPlan.inputRecordRef.recordId,
      },
    });
    const prepareRun = await appendHandoffRecordAndUpdateSummary(workspacePath, {
      runId: 'run-123',
      fromStage: 'prepare-run',
      toStage: 'plan',
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

    return {
      id: 'job-plan-rework',
      data: {
        taskId: 'task-plan',
        type: 'plan',
        runId: 'run-123',
        stage: 'plan',
        stageAttempt: 1,
        reworkAttempt: 1,
        inputRecordRef: prepareRun.inputRecordRef,
      },
    } as unknown as Job<PlanJobData>;
  }

  async function writePlanAssets(root: string, checks = 'requiredTitles:\n  - Summary\n  - Implementation Plan\n  - Risks\n') {
    const promptPath = join(root, 'plan.md');
    const checksPath = join(root, 'plan-checks.yaml');
    await writeFile(promptPath, [
      'Issue {{issueNumber}}: {{issueTitle}}',
      '',
      '{{issueDescription}}',
    ].join('\n'));
    await writeFile(checksPath, checks);
    return { promptPath, checksPath };
  }

  it('renders the Plan prompt with issue data and fallback body without assessment context', async () => {
    const { renderPlanPrompt } = await import('./plan.js');
    const root = await mkdtemp(join(tmpdir(), 'plan-prompt-'));
    tempRoots.push(root);
    const promptPath = join(root, 'plan.md');
    await writeFile(promptPath, '{{issueNumber}} {{issueTitle}}\n{{issueDescription}}');

    const prompt = await renderPlanPrompt(promptPath, {
      issue: {
        ...createIssue(),
        body: null,
      },
    });

    expect(prompt).toContain('42 Test issue');
    expect(prompt).toContain('(No description provided)');
    expect(prompt).not.toContain('Assessment');
  });

  it('loads YAML plan checks with strict required title validation', async () => {
    const { loadPlanChecks } = await import('./plan.js');
    const root = await mkdtemp(join(tmpdir(), 'plan-checks-'));
    tempRoots.push(root);
    const checksPath = join(root, 'plan-checks.yaml');
    await writeFile(checksPath, 'requiredTitles:\n  - Summary\n  - Implementation Plan\n');

    await expect(loadPlanChecks(checksPath)).resolves.toEqual({
      requiredTitles: ['Summary', 'Implementation Plan'],
    });

    await writeFile(checksPath, 'requiredTitles:\n  - Summary\n  - 12\n');
    await expect(loadPlanChecks(checksPath)).rejects.toThrow('requiredTitles must contain only non-empty strings');

    await writeFile(checksPath, 'notRequiredTitles:\n  - Summary\n');
    await expect(loadPlanChecks(checksPath)).rejects.toThrow('requiredTitles must be a non-empty array');

    await writeFile(checksPath, 'requiredTitles: [Summary\n');
    await expect(loadPlanChecks(checksPath)).rejects.toThrow('Failed to parse Plan checks YAML');
  });

  it('validates required response titles against Markdown headings', async () => {
    const { validatePlanResponse } = await import('./plan.js');

    expect(validatePlanResponse('## summary\ntext\n### Implementation Plan  \nsteps', {
      requiredTitles: ['Summary', 'Implementation Plan'],
    })).toEqual({
      passed: true,
      missingTitles: [],
    });

    expect(validatePlanResponse('## Summary\ntext', {
      requiredTitles: ['Summary', 'Risks'],
    })).toEqual({
      passed: false,
      missingTitles: ['Risks'],
      failureReason: 'Missing required plan section titles: Risks',
    });
  });

  it('appends accepted Plan output and returns a transport-only develop payload', async () => {
    const { runPlanWork } = await import('./plan.js');
    const job = await createJob();
    const assets = await writePlanAssets(job.data.inputRecordRef.runDir);
    const session = {
      prompts: [] as string[],
      send: vi.fn(async (prompt: string) => {
        session.prompts.push(prompt);
        return '## Summary\nReady.\n\n## Implementation Plan\nDo it.\n\n## Risks\nNone.';
      }),
      close: vi.fn(async () => undefined),
    };

    const result = await runPlanWork(job, {
      promptTemplatePath: assets.promptPath,
      checksPath: assets.checksPath,
      createPlanningSession: async () => session,
    });
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result.developJobData).toMatchObject({
      type: 'develop',
      stage: 'develop',
      inputRecordRef: {
        recordId: '000003_plan_to_develop',
        sequence: 3,
        stage: 'plan',
      },
    });
    expect(result.developJobData).not.toHaveProperty('plan');
    expect(session.prompts[0]).toContain('Issue 42: Test issue');
    expect(records[2]).toMatchObject({
      fromStage: 'plan',
      toStage: 'develop',
      status: 'success',
      output: {
        status: 'success',
        plan: {
          status: 'success',
          summary: 'Plan validated successfully.',
          content: '## Summary\nReady.\n\n## Implementation Plan\nDo it.\n\n## Risks\nNone.',
        },
      },
    });
  });

  it('records non-terminal failed attempts and retries in the same injected session', async () => {
    const { PLAN_CONTINUATION_PROMPT, runPlanWork } = await import('./plan.js');
    const job = await createJob();
    const assets = await writePlanAssets(job.data.inputRecordRef.runDir);
    const responses = [
      '## Summary\nMissing required sections.',
      '## Summary\nStill missing sections.',
      '## Summary\nReady.\n\n## Implementation Plan\nDo it.\n\n## Risks\nNone.',
    ];
    const session = {
      prompts: [] as string[],
      send: vi.fn(async (prompt: string) => {
        session.prompts.push(prompt);
        return responses.shift() ?? '';
      }),
      close: vi.fn(async () => undefined),
    };

    const result = await runPlanWork(job, {
      promptTemplatePath: assets.promptPath,
      checksPath: assets.checksPath,
      createPlanningSession: async () => session,
    });
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result.developJobData?.inputRecordRef.recordId).toBe('000005_plan_to_develop');
    expect(session.prompts).toHaveLength(3);
    expect(session.prompts[1]).toBe(PLAN_CONTINUATION_PROMPT);
    expect(session.prompts[2]).toBe(PLAN_CONTINUATION_PROMPT);
    expect(records[2]).toMatchObject({
      fromStage: 'plan',
      toStage: 'plan',
      status: 'rework-needed',
      dependsOn: ['000002_assess_to_plan'],
      output: {
        plan: {
          status: 'validation-failed',
          failureReason: 'Missing required plan section titles: Implementation Plan, Risks',
        },
      },
    });
    expect(records[3]).toMatchObject({
      fromStage: 'plan',
      toStage: 'plan',
      status: 'rework-needed',
      dependsOn: ['000003_plan_to_plan'],
    });
    expect(records[4]).toMatchObject({
      fromStage: 'plan',
      toStage: 'develop',
      status: 'success',
      dependsOn: ['000004_plan_to_plan'],
    });
  });

  it('records terminal blocked Plan output after the third failed validation attempt', async () => {
    const { runPlanWork } = await import('./plan.js');
    const job = await createJob();
    const assets = await writePlanAssets(job.data.inputRecordRef.runDir);
    const session = {
      send: vi.fn(async () => '## Summary\nMissing required sections.'),
      close: vi.fn(async () => undefined),
    };

    const result = await runPlanWork(job, {
      promptTemplatePath: assets.promptPath,
      checksPath: assets.checksPath,
      createPlanningSession: async () => session,
    });
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(result.developJobData).toBeUndefined();
    expect(records[4]).toMatchObject({
      fromStage: 'plan',
      toStage: null,
      status: 'blocked',
      output: {
        status: 'validation-failed',
        plan: {
          status: 'validation-failed',
          content: '## Summary\nMissing required sections.',
          failureReason: 'Missing required plan section titles: Implementation Plan, Risks',
        },
      },
    });
  });

  it('enqueues develop with only an input record reference', async () => {
    const { runPlanFlow } = await import('./plan.js');
    const job = await createJob();
    const assets = await writePlanAssets(job.data.inputRecordRef.runDir);

    await runPlanFlow(job, {
      promptTemplatePath: assets.promptPath,
      checksPath: assets.checksPath,
      createPlanningSession: async () => ({
        send: vi.fn(async () => '## Summary\nReady.\n\n## Implementation Plan\nDo it.\n\n## Risks\nNone.'),
        close: vi.fn(async () => undefined),
      }),
    });

    expect(mockJobQueueAdd).toHaveBeenCalledWith('develop', expect.objectContaining({
      type: 'develop',
      stage: 'develop',
      inputRecordRef: expect.objectContaining({
        recordId: '000003_plan_to_develop',
      }),
    }));
    expect(mockJobQueueAdd.mock.calls[0][1]).not.toHaveProperty('issue');
  });

  it('renders plan-rework prompt from PR comments and latest accepted Plan, then hands off to Develop', async () => {
    const { runPlanWork } = await import('./plan.js');
    const job = await createReworkJob();
    const assets = await writePlanAssets(job.data.inputRecordRef.runDir);
    const session = {
      prompts: [] as string[],
      send: vi.fn(async (prompt: string) => {
        session.prompts.push(prompt);
        return '## Summary\nReady.\n\n## Implementation Plan\nUpdate tests.\n\n## Risks\nNone.';
      }),
      close: vi.fn(async () => undefined),
    };

    const result = await runPlanWork(job, {
      checksPath: assets.checksPath,
      createPlanningSession: async () => session,
    });
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);

    expect(session.prompts[0]).toContain('Test issue');
    expect(session.prompts[0]).toContain('Original accepted plan.');
    expect(session.prompts[0]).toContain('Please simplify the implementation.');
    expect(result.developJobData).toMatchObject({
      stage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 1,
      inputRecordRef: {
        stage: 'plan',
      },
    });
    expect(records.at(-1)).toMatchObject({
      fromStage: 'plan',
      toStage: 'develop',
      dependsOn: ['000003_prepare-run_to_plan', '000001_plan_to_develop'],
      output: {
        plan: {
          content: '## Summary\nReady.\n\n## Implementation Plan\nUpdate tests.\n\n## Risks\nNone.',
        },
      },
    });
  });

  it('does not enqueue develop when Plan validation is terminally blocked', async () => {
    const { runPlanFlow } = await import('./plan.js');
    const job = await createJob();
    const assets = await writePlanAssets(job.data.inputRecordRef.runDir);

    await runPlanFlow(job, {
      promptTemplatePath: assets.promptPath,
      checksPath: assets.checksPath,
      createPlanningSession: async () => ({
        send: vi.fn(async () => '## Summary\nMissing required sections.'),
        close: vi.fn(async () => undefined),
      }),
    });

    expect(mockJobQueueAdd).not.toHaveBeenCalled();
  });

  it('should export planHandler', async () => {
    const { planHandler } = await import('./plan.js');
    expect(typeof planHandler).toBe('function');
  });
});
