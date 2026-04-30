import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackerClient } from '../tracker/github.js';
import { createRunFileSet, initializeRunSummary, readRunSummary } from './orchestration.js';
import { statusItem, updateRunStatus } from './status.js';

describe('job status updates', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'blast-status-test-'));
    tempRoots.push(root);
    return root;
  }

  async function initialize(root: string): Promise<void> {
    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-30T10:00:00.000Z'));
    await initializeRunSummary(root, fileSet, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-30T10:00:00.000Z',
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      initialContext: {
        issue: {
          id: 1,
          number: 42,
          title: 'Issue',
          body: null,
          state: 'open',
          labels: [],
          assignee: null,
          createdAt: '2026-04-30T09:00:00.000Z',
          updatedAt: '2026-04-30T09:00:00.000Z',
        },
        repository: {
          owner: 'owner',
          repo: 'repo',
        },
      },
      stages: {},
    });
  }

  it('uses a fake tracker client and persists returned external identity', async () => {
    const root = await createRoot();
    await initialize(root);
    const client: TrackerClient = {
      createOrUpdateStatusComment: vi.fn(async (input) => ({
        ...input.status,
        externalId: 'comment-123',
        updatedAt: '2026-04-30T10:01:00.000Z',
      })),
    };

    await updateRunStatus(root, 'run-123', {
      items: [statusItem('prepare-run', 1, 'in-progress', 'Prepare run', 'In progress')],
    }, undefined, client);

    expect(client.createOrUpdateStatusComment).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-123',
      issueNumber: 42,
      repository: { owner: 'owner', repo: 'repo' },
    }));
    await expect(readRunSummary(root, 'run-123')).resolves.toMatchObject({
      trackerStatus: {
        externalId: 'comment-123',
        checklist: expect.arrayContaining([
          expect.objectContaining({ id: 'prepare-run:attempt-1', state: 'in-progress' }),
        ]),
      },
    });
  });

  it('logs tracker failures and still preserves local checklist state', async () => {
    const root = await createRoot();
    await initialize(root);
    const logger = { warn: vi.fn() };
    const client: TrackerClient = {
      createOrUpdateStatusComment: vi.fn(async () => {
        throw new Error('tracker unavailable');
      }),
    };

    await expect(updateRunStatus(root, 'run-123', {
      items: [statusItem('plan', 1, 'retrying', 'Plan solution', 'Validation retry')],
    }, logger, client)).resolves.toBeNull();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('tracker unavailable'));
    await expect(readRunSummary(root, 'run-123')).resolves.toMatchObject({
      trackerStatus: {
        checklist: expect.arrayContaining([
          expect.objectContaining({ id: 'plan:attempt-1', state: 'retrying' }),
        ]),
      },
    });
  });
});
