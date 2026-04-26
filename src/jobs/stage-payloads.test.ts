import { describe, it, expect } from 'vitest';
import type { AssessJobData, GitHubIssue } from '../types/index.js';
import { createForwardStagePayload } from './stage-payloads.js';

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
  it('preserves runId and reworkAttempt while setting the next stage and domain stage attempt', () => {
    const assessPayload: AssessJobData = {
      taskId: 'task-assess',
      type: 'assess',
      runId: 'run-123',
      stage: 'assess',
      stageAttempt: 2,
      reworkAttempt: 3,
      issue: createIssue(),
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-123',
    };

    const payload = createForwardStagePayload(assessPayload, 'plan', {
      assessment: {
        status: 'stubbed',
        summary: 'Assessment deferred.',
      },
    });

    expect(payload).toMatchObject({
      taskId: 'task-assess',
      type: 'plan',
      runId: 'run-123',
      stage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 3,
    });
  });

  it('does not derive domain stageAttempt from BullMQ retry metadata', () => {
    const assessPayload: AssessJobData = {
      taskId: 'task-assess',
      type: 'assess',
      runId: 'run-123',
      stage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      issue: createIssue(),
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      branchName: 'issue-42-test-issue',
      workspacePath: '/tmp/prepare-run-123',
    };
    const bullMqAttemptsMade = 8;

    const payload = createForwardStagePayload(assessPayload, 'plan', {
      assessment: {
        status: 'stubbed',
        summary: `BullMQ attempts ignored: ${bullMqAttemptsMade}`,
      },
    });

    expect(payload.stageAttempt).toBe(1);
    expect(payload.stageAttempt).not.toBe(bullMqAttemptsMade);
  });
});
