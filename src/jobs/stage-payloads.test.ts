import { describe, it, expect } from 'vitest';
import type { AssessJobData, GitHubIssue, InputRecordRef, PrepareRunJobData } from '../types/index.js';
import {
  createForwardStagePayload,
  validateStagePayload,
  validateStageInputRecord,
} from './stage-payloads.js';

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

describe('stage payload factories', () => {
  const inputRecordRef: InputRecordRef = {
    runDir: '/tmp/work/.orchestrator/runs/2026-04-26_08.07_run-123',
    handoffPath: '/tmp/work/.orchestrator/runs/2026-04-26_08.07_run-123/2026-04-26_08.07_run-123_handoff.jsonl',
    recordId: '000001_prepare-run_to_assess',
    sequence: 1,
    stage: 'prepare-run',
  };

  it('preserves runId and reworkAttempt while setting transport-only next stage data', () => {
    const preparePayload: PrepareRunJobData = {
      taskId: 'task-assess',
      type: 'prepare-run',
      runId: 'run-123',
      stage: 'prepare-run',
      stageAttempt: 2,
      reworkAttempt: 3,
      issue: createIssue(),
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
    };

    const payload = createForwardStagePayload(preparePayload, 'assess', inputRecordRef);

    expect(payload).toMatchObject({
      taskId: 'task-assess',
      type: 'assess',
      runId: 'run-123',
      stage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 3,
      inputRecordRef,
    });
    expect(payload).not.toHaveProperty('issue');
    expect(payload).not.toHaveProperty('repository');
    expect(payload).not.toHaveProperty('branchName');
    expect(payload).not.toHaveProperty('workspacePath');
  });

  it('does not derive domain stageAttempt from BullMQ retry metadata', () => {
    const assessPayload: AssessJobData = {
      taskId: 'task-assess',
      type: 'assess',
      runId: 'run-123',
      stage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef,
    };
    const bullMqAttemptsMade = 8;

    const payload = createForwardStagePayload(assessPayload, 'plan', inputRecordRef);

    expect(payload.stageAttempt).toBe(1);
    expect(payload.stageAttempt).not.toBe(bullMqAttemptsMade);
  });

  it('validates transport-only downstream payloads and rejects business fields', () => {
    const payload = createForwardStagePayload(
      {
        taskId: 'task-assess',
        type: 'assess',
        runId: 'run-123',
        stage: 'assess',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef,
      } satisfies AssessJobData,
      'plan',
      inputRecordRef
    );

    expect(() => validateStagePayload('plan', payload)).not.toThrow();
    expect(() => validateStagePayload('plan', { ...payload, issue: createIssue() })).toThrow(
      'must not include issue'
    );
  });

  it('rejects input handoff records that do not match the receiving stage context', () => {
    const payload = createForwardStagePayload(
      {
        taskId: 'task-assess',
        type: 'assess',
        runId: 'run-123',
        stage: 'assess',
        stageAttempt: 1,
        reworkAttempt: 0,
        inputRecordRef,
      } satisfies AssessJobData,
      'plan',
      inputRecordRef
    );

    expect(() => validateStageInputRecord(payload, {
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
      output: {},
      nextInput: null,
    })).toThrow('toStage mismatch');
  });
});
