import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { PlanJobData } from '../types/index.js';
import {
  resolveRunDirectory,
  resolveOrchestrationStorageRoot,
  resolveStageAttemptDirectory,
  resolveArtifactPath,
  resolveEventPath,
  resolveRunSummaryPath,
  createRunFileSet,
  appendHandoffRecord,
  readHandoffRecords,
  writeArtifactFile,
  writeEventFile,
  readRunSummary,
  writeRunSummary,
  updateRunSummary,
  updateStableRunContext,
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

  it('resolves the orchestration storage root from the process cwd or an input record ref', async () => {
    const root = await createTempRoot();
    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));

    expect(resolveOrchestrationStorageRoot({
      runDir: fileSet.runDirectory,
      handoffPath: fileSet.handoffLedgerPath,
      recordId: '000001_prepare-run_to_assess',
      sequence: 1,
      stage: 'prepare-run',
    })).toBe(root);
    expect(resolveOrchestrationStorageRoot()).toBe(process.env['ORCHESTRATION_STORAGE_ROOT'] ?? process.cwd());
    expect(dirname(dirname(dirname(fileSet.runDirectory)))).toBe(root);
  });

  it('resolves timestamped run directory, summary, and handoff ledger paths from one UTC prefix', async () => {
    const root = await createTempRoot();

    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));

    expect(fileSet).toEqual({
      runId: 'run-123',
      timestampPrefix: '2026-04-26_08.07',
      runDirectory: join(root, '.orchestrator', 'runs', '2026-04-26_08.07_run-123'),
      runSummaryPath: join(
        root,
        '.orchestrator',
        'runs',
        '2026-04-26_08.07_run-123',
        '2026-04-26_08.07_run-123_run.json'
      ),
      handoffLedgerPath: join(
        root,
        '.orchestrator',
        'runs',
        '2026-04-26_08.07_run-123',
        '2026-04-26_08.07_run-123_handoff.jsonl'
      ),
    });
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

  it('persists timestamped run summary paths and resolves them without recomputing time', async () => {
    const root = await createTempRoot();
    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));

    await writeRunSummary(root, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      timestampPrefix: fileSet.timestampPrefix,
      runDirectory: fileSet.runDirectory,
      runSummaryPath: fileSet.runSummaryPath,
      handoffLedgerPath: fileSet.handoffLedgerPath,
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stages: {},
    });

    await updateRunSummary(root, 'run-123', (summary) => ({
      ...summary,
      status: 'completed',
      currentStage: 'assess',
    }));

    await expect(readRunSummary(root, 'run-123')).resolves.toMatchObject({
      runId: 'run-123',
      status: 'completed',
      currentStage: 'assess',
      timestampPrefix: '2026-04-26_08.07',
      runDirectory: fileSet.runDirectory,
      runSummaryPath: fileSet.runSummaryPath,
      handoffLedgerPath: fileSet.handoffLedgerPath,
    });
  });

  it('appends one handoff JSON object per line without overwriting existing records', async () => {
    const root = await createTempRoot();
    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    await writeRunSummary(root, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      timestampPrefix: fileSet.timestampPrefix,
      runDirectory: fileSet.runDirectory,
      runSummaryPath: fileSet.runSummaryPath,
      handoffLedgerPath: fileSet.handoffLedgerPath,
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stages: {},
    });

    const first = await appendHandoffRecord(root, {
      runId: 'run-123',
      fromStage: 'prepare-run',
      toStage: 'assess',
      stageAttempt: 1,
      reworkAttempt: 0,
      status: 'success',
      output: { status: 'success', prepared: true },
    });
    const second = await appendHandoffRecord(root, {
      runId: 'run-123',
      fromStage: 'assess',
      toStage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      dependsOn: [first.inputRecordRef],
      status: 'success',
      output: { status: 'success', assessed: true },
    });

    await expect(readFile(fileSet.handoffLedgerPath, 'utf8')).resolves.toContain(
      `${JSON.stringify(first.record)}\n${JSON.stringify(second.record)}\n`
    );
    await expect(readHandoffRecords(fileSet.handoffLedgerPath)).resolves.toEqual([first.record, second.record]);
    expect(first.record).toMatchObject({
      recordId: '000001_prepare-run_to_assess',
      sequence: 1,
      dependsOn: [],
    });
    expect(second.record).toMatchObject({
      recordId: '000002_assess_to_plan',
      sequence: 2,
      dependsOn: [first.record.recordId],
    });
    expect(first.record).not.toHaveProperty('nextInput');
    expect(second.record).not.toHaveProperty('nextInput');
    expect(second.inputRecordRef).toEqual({
      runDir: fileSet.runDirectory,
      handoffPath: fileSet.handoffLedgerPath,
      recordId: second.record.recordId,
      sequence: second.record.sequence,
      stage: 'assess',
    });
  });

  it('stores stable run context in run summary without copying stage output data', async () => {
    const root = await createTempRoot();
    const fileSet = createRunFileSet(root, 'run-123', new Date('2026-04-26T08:07:30.000Z'));
    const issue = {
      id: 1,
      number: 42,
      title: 'Issue',
      body: null,
      state: 'open' as const,
      labels: ['ready'],
      assignee: null,
      createdAt: '2026-04-22T00:00:00Z',
      updatedAt: '2026-04-22T00:00:00Z',
    };
    const repository = {
      owner: 'test-owner',
      repo: 'test-repo',
    };

    await writeRunSummary(root, {
      runId: 'run-123',
      status: 'running',
      currentStage: 'prepare-run',
      runStartedAt: '2026-04-26T08:07:30.000Z',
      timestampPrefix: fileSet.timestampPrefix,
      runDirectory: fileSet.runDirectory,
      runSummaryPath: fileSet.runSummaryPath,
      handoffLedgerPath: fileSet.handoffLedgerPath,
      stageAttempt: 1,
      reworkAttempt: 0,
      latestHandoffRecord: null,
      stableContext: {
        issue,
        repository,
        branchName: 'issue-42-issue',
        workspacePath: '/tmp/prepare-run-abc123',
      },
      stages: {},
    });
    await appendHandoffRecord(root, {
      runId: 'run-123',
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
    });

    await updateStableRunContext(root, 'run-123', {
      issue,
      repository,
      branchName: 'should-not-replace',
      workspacePath: '/tmp/should-not-replace',
    });

    await expect(readRunSummary(root, 'run-123')).resolves.toMatchObject({
      stableContext: {
        issue,
        repository,
        branchName: 'issue-42-issue',
        workspacePath: '/tmp/prepare-run-abc123',
      },
    });
    const summary = await readRunSummary(root, 'run-123');
    expect(summary).not.toHaveProperty('assessment');
    expect(summary).not.toHaveProperty('plan');
    expect(summary).not.toHaveProperty('development');
    expect(summary).not.toHaveProperty('quality');
  });

  it('schedules the next BullMQ job with the current job name and payload unchanged', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'next-job' }),
    };
    const data: PlanJobData = {
      taskId: 'task-1',
      type: 'plan',
      runId: 'run-123',
      stage: 'plan',
      stageAttempt: 1,
      reworkAttempt: 0,
      inputRecordRef: {
        runDir: '/tmp/blast/.orchestrator/runs/2026-04-26_08.07_run-123',
        handoffPath: '/tmp/blast/.orchestrator/runs/2026-04-26_08.07_run-123/2026-04-26_08.07_run-123_handoff.jsonl',
        recordId: '000002_assess_to_plan',
        sequence: 2,
        stage: 'assess',
      },
    };

    await scheduleNextJob(queue, 'plan', data);

    expect(queue.add).toHaveBeenCalledWith('plan', data);
  });
});
