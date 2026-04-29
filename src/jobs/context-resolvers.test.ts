import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  GitHubIssue,
  HandoffRecord,
  InputRecordRef,
  DevelopJobData,
  ReviewJobData,
  RunFileSet,
} from '../types/index.js';
import { createRunFileSet, initializeRunSummary } from './orchestration.js';
import { resolveDevelopContext, resolveReviewContext } from './context-resolvers.js';

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

function ref(fileSet: RunFileSet, record: HandoffRecord): InputRecordRef {
  return {
    runDir: fileSet.runDirectory,
    handoffPath: fileSet.handoffLedgerPath,
    recordId: record.recordId,
    sequence: record.sequence,
    stage: record.fromStage,
  };
}

function createReviewPayload(inputRecordRef: InputRecordRef): ReviewJobData {
  return {
    taskId: 'task-review',
    type: 'review',
    runId: 'run-123',
    stage: 'review',
    stageAttempt: 1,
    reworkAttempt: 0,
    inputRecordRef,
  };
}

function createDevelopPayload(inputRecordRef: InputRecordRef): DevelopJobData {
  return {
    taskId: 'task-develop',
    type: 'develop',
    runId: 'run-123',
    stage: 'develop',
    stageAttempt: 2,
    reworkAttempt: 0,
    inputRecordRef,
  };
}

describe('stage context resolvers', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function writeReviewLedger(options: {
    dependencies?: HandoffRecord['dependsOn'];
    dependencyRecord?: HandoffRecord;
  } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'context-resolver-'));
    tempRoots.push(root);
    const issue = createIssue();
    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await initializeRunSummary(root, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'develop',
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
        workspacePath: root,
      },
      stages: {},
    });
    const planRecord: HandoffRecord = options.dependencyRecord ?? {
      recordId: '000001_plan_to_develop',
      sequence: 1,
      runId: 'run-123',
      createdAt: '2026-04-26T08:07:30.000Z',
      fromStage: 'plan',
      toStage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: [],
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
    };
    const developRecord: HandoffRecord = {
      recordId: '000002_develop_to_review',
      sequence: 2,
      runId: 'run-123',
      createdAt: '2026-04-26T08:08:30.000Z',
      fromStage: 'develop',
      toStage: 'review',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: options.dependencies ?? [planRecord.recordId],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
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
          summary: 'Quality Gate passed.',
        },
      },
    };
    await writeFile(fileSet.handoffLedgerPath, `${JSON.stringify(planRecord)}\n${JSON.stringify(developRecord)}\n`);

    return {
      payload: createReviewPayload(ref(fileSet, developRecord)),
      fileSet,
      planRecord,
      developRecord,
    };
  }

  it('resolves Review context from stable run context plus explicit Develop and Plan records', async () => {
    const { payload } = await writeReviewLedger();

    await expect(resolveReviewContext(payload)).resolves.toMatchObject({
      runContext: {
        issue: {
          number: 42,
        },
        branchName: 'issue-42-test-issue',
      },
      plan: {
        status: 'success',
      },
      development: {
        status: 'completed',
      },
      quality: {
        status: 'passed',
      },
    });
  });

  it('fails when a required dependency id is missing', async () => {
    const { payload } = await writeReviewLedger({ dependencies: [] });

    await expect(resolveReviewContext(payload)).rejects.toThrow('Missing required plan dependency');
  });

  it('fails when a dependency points to the wrong stage', async () => {
    const wrongStageRecord: HandoffRecord = {
      recordId: '000001_assess_to_plan',
      sequence: 1,
      runId: 'run-123',
      createdAt: '2026-04-26T08:07:30.000Z',
      fromStage: 'assess',
      toStage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: [],
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
    };
    const { payload } = await writeReviewLedger({
      dependencyRecord: wrongStageRecord,
      dependencies: [wrongStageRecord.recordId],
    });

    await expect(resolveReviewContext(payload)).rejects.toThrow('expected stage plan but found assess');
  });

  it('fails when a dependency points to a missing record', async () => {
    const { payload } = await writeReviewLedger({
      dependencies: ['000404_plan_to_develop'],
    });

    await expect(resolveReviewContext(payload)).rejects.toThrow('Handoff dependency record not found');
  });

  it('fails when a dependency output does not match the expected stage output schema', async () => {
    const invalidPlanRecord: HandoffRecord = {
      recordId: '000001_plan_to_develop',
      sequence: 1,
      runId: 'run-123',
      createdAt: '2026-04-26T08:07:30.000Z',
      fromStage: 'plan',
      toStage: 'develop',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: [],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 0,
      },
    };
    const { payload } = await writeReviewLedger({ dependencyRecord: invalidPlanRecord });

    await expect(resolveReviewContext(payload)).rejects.toThrow('plan must be an object');
  });

  it('resolves Develop rework context from a failed Review record and explicit Plan dependency', async () => {
    const { fileSet, planRecord, developRecord } = await writeReviewLedger();
    const reviewRecord: HandoffRecord = {
      recordId: '000003_review_to_develop',
      sequence: 3,
      runId: 'run-123',
      createdAt: '2026-04-26T08:09:30.000Z',
      fromStage: 'review',
      toStage: 'develop',
      stageAttempt: 2,
      reworkAttempt: 0,
      dependsOn: [developRecord.recordId, planRecord.recordId],
      status: 'rework-needed',
      output: {
        status: 'review-failed',
        runId: 'run-123',
        stageAttempt: 2,
        reworkAttempt: 0,
        review: {
          status: 'failed',
          summary: 'Review failed.',
          content: 'Fix the regression.',
        },
      },
    };
    await writeFile(fileSet.handoffLedgerPath, [
      JSON.stringify(planRecord),
      JSON.stringify(developRecord),
      JSON.stringify(reviewRecord),
      '',
    ].join('\n'));

    await expect(resolveDevelopContext(createDevelopPayload(ref(fileSet, reviewRecord)))).resolves.toMatchObject({
      inputKind: 'review-rework',
      plan: {
        content: '## Summary\nReady.',
      },
      reviewFailureContent: 'Fix the regression.',
      planRecord: {
        recordId: planRecord.recordId,
      },
    });
  });
});
