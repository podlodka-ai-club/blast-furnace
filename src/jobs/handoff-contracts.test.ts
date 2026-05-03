import { describe, expect, it } from 'vitest';
import type { GitHubIssue, InputRecordRef, RepositoryIdentity } from '../types/index.js';
import {
  handoffRecordSchema,
  inputRecordRefSchema,
  runSummaryPointerSchema,
  stageOutputSchemas,
  stagePayloadSchemas,
} from './handoff-contracts.js';

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

const repository: RepositoryIdentity = {
  owner: 'test-owner',
  repo: 'test-repo',
};

const inputRecordRef: InputRecordRef = {
  runDir: '/opt/blast-furnace/.orchestrator/runs/2026-04-26_08.07_run-123',
  handoffPath: '/opt/blast-furnace/.orchestrator/runs/2026-04-26_08.07_run-123/2026-04-26_08.07_run-123_handoff.jsonl',
  recordId: '000001_prepare-run_to_assess',
  sequence: 1,
  stage: 'prepare-run',
};

const preparedFields = {
  runId: 'run-123',
  issue: createIssue(),
  repository,
  branchName: 'issue-42-test-issue',
  workspacePath: '/tmp/prepare-run-abc123',
  stageAttempt: 1,
  reworkAttempt: 0,
};

describe('handoff runtime contracts', () => {
  it('parses input refs, run summary pointers, handoff records, and transport payloads', () => {
    expect(inputRecordRefSchema.parse(inputRecordRef)).toEqual(inputRecordRef);
    expect(runSummaryPointerSchema.parse(inputRecordRef)).toEqual(inputRecordRef);
    expect(stagePayloadSchemas.plan.parse({
      taskId: 'task-plan',
      type: 'plan',
      runId: 'run-123',
      stage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef,
    })).toMatchObject({
      stage: 'plan',
      inputRecordRef,
    });
    expect(stagePayloadSchemas['pr-rework-intake'].parse({
      taskId: 'task-pr-rework-intake',
      type: 'pr-rework-intake',
      runId: 'run-123',
      stage: 'pr-rework-intake',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef: {
        ...inputRecordRef,
        recordId: '000007_sync-tracker-state_to_pr-rework-intake',
        sequence: 7,
        stage: 'sync-tracker-state',
      },
    })).toMatchObject({
      stage: 'pr-rework-intake',
    });
    expect(handoffRecordSchema.parse({
      recordId: '000001_prepare-run_to_assess',
      sequence: 1,
      runId: 'run-123',
      createdAt: '2026-04-26T08:07:30.000Z',
      fromStage: 'prepare-run',
      toStage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: [],
      status: 'success',
      output: { status: 'success' },
    })).toMatchObject({
      recordId: '000001_prepare-run_to_assess',
    });
  });

  it('rejects persisted nextInput and requires explicit dependency arrays', () => {
    const baseRecord = {
      recordId: '000002_assess_to_plan',
      sequence: 2,
      runId: 'run-123',
      createdAt: '2026-04-26T08:07:30.000Z',
      fromStage: 'assess',
      toStage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
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

    expect(handoffRecordSchema.parse({
      ...baseRecord,
      dependsOn: [inputRecordRef.recordId],
    })).toMatchObject({
      dependsOn: [inputRecordRef.recordId],
    });
    expect(() => handoffRecordSchema.parse({
      ...baseRecord,
      dependsOn: [{
        recordId: inputRecordRef.recordId,
        sequence: inputRecordRef.sequence,
        stage: inputRecordRef.stage,
      }],
    })).toThrow('dependsOn[0] must be a non-empty record id string');
    expect(() => handoffRecordSchema.parse({
      ...baseRecord,
      dependsOn: null,
    })).toThrow('dependsOn must be an array');
    expect(() => handoffRecordSchema.parse({
      ...baseRecord,
      dependsOn: [],
      nextInput: {
        taskId: 'task-plan',
        type: 'plan',
        runId: 'run-123',
        stage: 'plan',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef,
      },
    })).toThrow('must not include nextInput');
  });

  it('rejects stage outputs that include stable run context or prior stage output fields', () => {
    const assessment = {
      status: 'stubbed',
      summary: 'Assessment deferred for this iteration.',
    } as const;
    const plan = {
      status: 'success',
      summary: 'Plan validated successfully.',
      content: '## Summary\nReady.',
    } as const;
    const development = {
      status: 'completed',
      summary: 'Codex completed successfully.',
    } as const;
    const quality = {
      status: 'passed',
      command: 'npm test',
      exitCode: 0,
      attempts: 1,
      durationMs: 25,
      summary: 'Quality Gate passed.',
    } as const;
    const review = {
      status: 'passed',
      summary: 'Review Success',
    } as const;
    const pullRequest = {
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    };

    expect(() => stageOutputSchemas.assess.parse({
      status: 'success',
      ...preparedFields,
      assessment,
    })).toThrow('assess output must not include issue');
    expect(() => stageOutputSchemas.plan.parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      assessment,
      plan,
    })).toThrow('plan output must not include assessment');
    expect(() => stageOutputSchemas.develop.parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      plan,
      development,
      quality,
    })).toThrow('develop output must not include plan');
    expect(() => stageOutputSchemas.review.parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      development,
      quality,
      review,
    })).toThrow('review output must not include development');
    expect(() => stageOutputSchemas['make-pr'].parse({
      status: 'pull-request-created',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      review,
      pullRequest,
    })).toThrow('make-pr output must not include review');
    expect(() => stageOutputSchemas['sync-tracker-state'].parse({
      status: 'tracker-synced',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      pullRequest,
      trackerLabels: ['in review'],
    })).toThrow('sync-tracker-state output must not include pullRequest');
  });

  it('parses all formal stage output objects', () => {
    const assessment = {
      status: 'stubbed',
      summary: 'Assessment deferred for this iteration.',
    } as const;
    const plan = {
      status: 'success',
      summary: 'Plan validated successfully.',
      content: '## Summary\nReady.',
    } as const;
    const development = {
      status: 'completed',
      summary: 'Codex completed successfully.',
    } as const;
    const quality = {
      status: 'passed',
      command: 'npm test',
      exitCode: 0,
      attempts: 1,
      durationMs: 25,
      summary: 'Quality Gate passed.',
    } as const;
    const review = {
      status: 'passed',
      summary: 'Review Success',
    } as const;
    const pullRequest = {
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    };

    expect(stageOutputSchemas['prepare-run'].parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
    })).toMatchObject({ status: 'success' });
    expect(stageOutputSchemas.assess.parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      assessment,
    })).toMatchObject({ assessment });
    expect(stageOutputSchemas.plan.parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      plan,
    })).toMatchObject({ plan });
    expect(stageOutputSchemas.plan.parse({
      status: 'validation-failed',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      plan: {
        status: 'validation-failed',
        summary: 'Plan validation failed.',
        content: '## Summary\nMissing sections.',
        failureReason: 'Missing required plan section titles: Risks',
      },
    })).toMatchObject({
      status: 'validation-failed',
      plan: {
        status: 'validation-failed',
      },
    });
    expect(stageOutputSchemas.develop.parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      development,
      quality,
    })).toMatchObject({ development, quality });
    expect(stageOutputSchemas.review.parse({
      status: 'success',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      review,
    })).toMatchObject({ review });
    expect(stageOutputSchemas['make-pr'].parse({
      status: 'pull-request-created',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      pullRequest,
    })).toMatchObject({ pullRequest });
    expect(stageOutputSchemas['sync-tracker-state'].parse({
      status: 'tracker-synced',
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      trackerLabels: ['in review'],
    })).toMatchObject({ trackerLabels: ['in review'] });
  });

  it('validates expanded Develop quality output and terminal quality statuses', () => {
    const base = {
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
      development: {
        status: 'completed',
        summary: 'Codex completed successfully.',
      },
    } as const;

    expect(stageOutputSchemas.develop.parse({
      ...base,
      status: 'quality-failed',
      quality: {
        status: 'failed',
        command: 'npm test',
        exitCode: 1,
        attempts: 3,
        durationMs: 120,
        summary: 'Tests failed.',
      },
    })).toMatchObject({
      status: 'quality-failed',
      quality: {
        status: 'failed',
        attempts: 3,
      },
    });

    expect(() => stageOutputSchemas.develop.parse({
      ...base,
      status: 'success',
    })).toThrow('quality must be an object');

    expect(() => stageOutputSchemas.review.parse({
      ...base,
      status: 'quality-failed',
      quality: {
        status: 'failed',
        command: 'npm test',
        exitCode: 1,
        attempts: 3,
        durationMs: 120,
        summary: 'Tests failed.',
      },
      review: {
        status: 'passed',
        summary: 'Review Success',
      },
    })).toThrow('review output must not include development');
  });

  it('validates Review output statuses and rejects invalid Review-owned shapes', () => {
    const base = {
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 0,
    } as const;

    expect(stageOutputSchemas.review.parse({
      ...base,
      status: 'review-failed',
      review: {
        status: 'failed',
        summary: 'Review failed.',
        content: 'Fix the failing test.',
      },
    })).toMatchObject({ status: 'review-failed' });

    expect(stageOutputSchemas.review.parse({
      ...base,
      status: 'review-malformed',
      review: {
        status: 'malformed',
        summary: 'Review response was malformed after repair.',
        rawResponse: 'unexpected prose',
      },
    })).toMatchObject({ status: 'review-malformed' });

    expect(stageOutputSchemas.review.parse({
      ...base,
      status: 'review-exhausted',
      review: {
        status: 'exhausted',
        summary: 'Review failed and rework attempt limit was reached.',
        content: 'Still failing.',
      },
    })).toMatchObject({ status: 'review-exhausted' });

    expect(() => stageOutputSchemas.review.parse({
      ...base,
      status: 'review-failed',
      plan: { status: 'success' },
      review: {
        status: 'failed',
        summary: 'Review failed.',
        content: 'Fix the failing test.',
      },
    })).toThrow('review output must not include plan');

    expect(() => stageOutputSchemas.review.parse({
      ...base,
      status: 'success',
      review: {
        status: 'failed',
        summary: 'Review failed.',
        content: 'Fix the failing test.',
      },
    })).toThrow('successful review output requires review.status passed');
  });

  it('validates PR Rework Intake route, terminal, and no-comment output contracts', () => {
    const base = {
      runId: 'run-123',
      stageAttempt: 1,
      reworkAttempt: 1,
      pullRequest: {
        number: 7,
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
      },
    } as const;

    expect(stageOutputSchemas['pr-rework-intake'].parse({
      ...base,
      status: 'rework-needed',
      commentsMarkdown: '## Review Comments\n\n- Please update tests.',
      routeAnalysis: 'ROUTE: DEVELOP\nThe comments are implementation-only.',
      selectedNextStage: 'develop',
      pullRequestHead: {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'issue-42-test-issue',
        sha: 'abc123',
      },
      latestPlanRecordId: '000003_assess_to_plan',
    })).toMatchObject({
      status: 'rework-needed',
      selectedNextStage: 'develop',
    });

    expect(stageOutputSchemas['pr-rework-intake'].parse({
      ...base,
      status: 'pull-request-merged',
    })).toMatchObject({ status: 'pull-request-merged' });

    expect(stageOutputSchemas['pr-rework-intake'].parse({
      ...base,
      status: 'pull-request-closed-without-merge',
    })).toMatchObject({ status: 'pull-request-closed-without-merge' });

    expect(stageOutputSchemas['pr-rework-intake'].parse({
      ...base,
      status: 'too-many-reworks',
      commentsMarkdown: '## Review Comments\n\n- Another change.',
    })).toMatchObject({ status: 'too-many-reworks' });

    expect(stageOutputSchemas['pr-rework-intake'].parse({
      ...base,
      status: 'no-comments-found',
    })).toMatchObject({ status: 'no-comments-found' });

    expect(() => stageOutputSchemas['pr-rework-intake'].parse({
      ...base,
      status: 'rework-needed',
      workspacePath: '/tmp/prepare-run-abc123',
      commentsMarkdown: 'comments',
      routeAnalysis: 'ROUTE: PLAN',
      selectedNextStage: 'plan',
      pullRequestHead: {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'issue-42-test-issue',
        sha: 'abc123',
      },
      latestPlanRecordId: '000003_assess_to_plan',
    })).toThrow('pr-rework-intake output must not include workspacePath');
  });

  it('validates PR Rework Intake and rework Prepare Run handoff records', () => {
    const syncRecordId = '000007_make-pr_to_sync-tracker-state';
    const planRecordId = '000003_assess_to_plan';
    const prReworkRecord = handoffRecordSchema.parse({
      recordId: '000009_pr-rework-intake_to_prepare-run',
      sequence: 9,
      runId: 'run-123',
      createdAt: '2026-04-26T08:07:30.000Z',
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      stageAttempt: 1,
      reworkAttempt: 1,
      dependsOn: [syncRecordId, planRecordId],
      status: 'rework-needed',
      output: {
        status: 'rework-needed',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
        commentsMarkdown: '## Review Comments\n\n- Please update tests.',
        routeAnalysis: 'ROUTE: PLAN\nPlanning is needed.',
        selectedNextStage: 'plan',
        pullRequest: {
          number: 7,
          htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
        },
        pullRequestHead: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'issue-42-test-issue',
          sha: 'abc123',
        },
        latestPlanRecordId: planRecordId,
      },
    });

    expect(prReworkRecord).toMatchObject({
      fromStage: 'pr-rework-intake',
      toStage: 'prepare-run',
      status: 'rework-needed',
      dependsOn: [syncRecordId, planRecordId],
    });

    expect(handoffRecordSchema.parse({
      recordId: '000010_prepare-run_to_plan',
      sequence: 10,
      runId: 'run-123',
      createdAt: '2026-04-26T08:08:30.000Z',
      fromStage: 'prepare-run',
      toStage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 1,
      dependsOn: [prReworkRecord.recordId],
      status: 'success',
      output: {
        status: 'success',
        runId: 'run-123',
        stageAttempt: 1,
        reworkAttempt: 1,
      },
    })).toMatchObject({
      fromStage: 'prepare-run',
      toStage: 'plan',
      dependsOn: [prReworkRecord.recordId],
    });
  });
});
