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
    expect(handoffRecordSchema.parse({
      recordId: '000001_prepare-run_to_assess',
      sequence: 1,
      runId: 'run-123',
      createdAt: '2026-04-26T08:07:30.000Z',
      fromStage: 'prepare-run',
      toStage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: null,
      status: 'success',
      output: { status: 'success' },
      nextInput: null,
    })).toMatchObject({
      recordId: '000001_prepare-run_to_assess',
    });
  });

  it('parses all formal stage output objects', () => {
    const assessment = {
      status: 'stubbed',
      summary: 'Assessment deferred for this iteration.',
    } as const;
    const plan = {
      status: 'stubbed',
      summary: 'Planning deferred for this iteration.',
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
      outputPath: '/tmp/run/quality/attempt-1.log',
    } as const;
    const review = {
      status: 'stubbed',
      summary: 'Review deferred for this iteration.',
    } as const;
    const pullRequest = {
      number: 7,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/7',
    };

    expect(stageOutputSchemas['prepare-run'].parse({
      status: 'success',
      ...preparedFields,
    })).toMatchObject({ status: 'success', branchName: 'issue-42-test-issue' });
    expect(stageOutputSchemas.assess.parse({
      status: 'success',
      ...preparedFields,
      assessment,
    })).toMatchObject({ assessment });
    expect(stageOutputSchemas.plan.parse({
      status: 'success',
      ...preparedFields,
      assessment,
      plan,
    })).toMatchObject({ plan });
    expect(stageOutputSchemas.develop.parse({
      status: 'success',
      ...preparedFields,
      assessment,
      plan,
      development,
      quality,
    })).toMatchObject({ development, quality });
    expect(stageOutputSchemas.review.parse({
      status: 'success',
      ...preparedFields,
      assessment,
      plan,
      development,
      quality,
      review,
    })).toMatchObject({ review });
    expect(stageOutputSchemas['make-pr'].parse({
      status: 'pull-request-created',
      ...preparedFields,
      development,
      quality,
      review,
      pullRequest,
    })).toMatchObject({ pullRequest });
    expect(stageOutputSchemas['sync-tracker-state'].parse({
      status: 'tracker-synced',
      ...preparedFields,
      pullRequest,
      trackerLabels: ['in review'],
    })).toMatchObject({ trackerLabels: ['in review'] });
  });

  it('validates expanded Develop quality output and terminal quality statuses', () => {
    const base = {
      ...preparedFields,
      assessment: {
        status: 'stubbed',
        summary: 'Assessment deferred for this iteration.',
      },
      plan: {
        status: 'stubbed',
        summary: 'Planning deferred for this iteration.',
      },
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
        status: 'stubbed',
        summary: 'Review deferred.',
      },
    })).toThrow('review input quality.status must be passed');
  });
});
