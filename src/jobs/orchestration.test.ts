import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { PlanJobData } from '../types/index.js';
import {
  resolveRunDirectory,
  resolveStageAttemptDirectory,
  resolveArtifactPath,
  resolveEventPath,
  resolveRunSummaryPath,
  writeArtifactFile,
  writeEventFile,
  readRunSummary,
  writeRunSummary,
  updateRunSummary,
  scheduleNextJob,
} from './orchestration.js';

describe('job orchestration infrastructure', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createTempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'blast-orchestration-'));
    tempRoots.push(root);
    return root;
  }

  it('resolves run, stage attempt, event, artifact, and run summary paths under .orchestrator/runs', async () => {
    const root = await createTempRoot();

    expect(resolveRunDirectory(root, 'run-123')).toBe(join(root, '.orchestrator', 'runs', 'run-123'));
    expect(resolveStageAttemptDirectory(root, {
      runId: 'run-123',
      stageName: 'plan',
      attempt: 2,
    })).toBe(join(root, '.orchestrator', 'runs', 'run-123', 'stages', 'plan', 'attempt-2'));
    expect(resolveArtifactPath(root, {
      runId: 'run-123',
      stageName: 'plan',
      attempt: 2,
      artifactName: 'prompt.json',
    })).toBe(join(root, '.orchestrator', 'runs', 'run-123', 'stages', 'plan', 'attempt-2', 'artifacts', 'prompt.json'));
    expect(resolveEventPath(root, 'run-123', '0001-plan-started.json')).toBe(
      join(root, '.orchestrator', 'runs', 'run-123', 'events', '0001-plan-started.json')
    );
    expect(resolveRunSummaryPath(root, 'run-123')).toBe(join(root, '.orchestrator', 'runs', 'run-123', 'run.json'));
  });

  it('writes artifact and event files append-only and fails rather than overwrite existing files', async () => {
    const root = await createTempRoot();
    const artifact = {
      runId: 'run-123',
      stageName: 'plan',
      attempt: 1,
      artifactName: 'result.json',
    };

    const artifactMetadata = await writeArtifactFile(root, artifact, { status: 'ok' });
    const eventMetadata = await writeEventFile(root, 'run-123', '0001-plan-complete.json', { event: 'plan-complete' });

    await expect(readFile(artifactMetadata.path, 'utf8')).resolves.toBe(JSON.stringify({ status: 'ok' }, null, 2));
    await expect(readFile(eventMetadata.path, 'utf8')).resolves.toBe(JSON.stringify({ event: 'plan-complete' }, null, 2));
    await expect(writeArtifactFile(root, artifact, { status: 'updated' })).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(writeEventFile(root, 'run-123', '0001-plan-complete.json', { event: 'again' })).rejects.toMatchObject({
      code: 'EEXIST',
    });
  });

  it('treats run.json as mutable summary state', async () => {
    const root = await createTempRoot();

    await expect(readRunSummary(root, 'run-123')).resolves.toBeNull();
    await writeRunSummary(root, {
      runId: 'run-123',
      status: 'running',
      stages: {},
    });
    await updateRunSummary(root, 'run-123', (summary) => ({
      ...summary,
      status: 'completed',
      stages: {
        ...summary.stages,
        plan: {
          attempts: 1,
          status: 'completed',
        },
      },
    }));

    await expect(readRunSummary(root, 'run-123')).resolves.toMatchObject({
      runId: 'run-123',
      status: 'completed',
      stages: {
        plan: {
          attempts: 1,
          status: 'completed',
        },
      },
    });
  });

  it('schedules the next BullMQ job with the current job name and payload unchanged', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'next-job' }),
    };
    const data: PlanJobData = {
      taskId: 'task-1',
      type: 'plan',
      issue: {
        id: 1,
        number: 42,
        title: 'Issue',
        body: null,
        state: 'open',
        labels: [],
        assignee: null,
        createdAt: '2026-04-22T00:00:00Z',
        updatedAt: '2026-04-22T00:00:00Z',
      },
      branchName: 'issue-42-issue',
    };

    await scheduleNextJob(queue, 'plan', data);

    expect(queue.add).toHaveBeenCalledWith('plan', data);
  });
});
