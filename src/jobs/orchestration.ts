import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ArtifactLocation,
  ArtifactMetadata,
  EventMetadata,
  JobPayload,
  RunId,
  RunSummaryData,
  StageAttemptLocation,
} from '../types/index.js';

export interface QueueLike {
  add(name: string, data: JobPayload): Promise<unknown>;
}

export function resolveRunDirectory(root: string, runId: RunId): string {
  return join(root, '.orchestrator', 'runs', runId);
}

export function resolveStageAttemptDirectory(root: string, location: StageAttemptLocation): string {
  return join(resolveRunDirectory(root, location.runId), 'stages', location.stageName, `attempt-${location.attempt}`);
}

export function resolveArtifactPath(root: string, location: ArtifactLocation): string {
  return join(resolveStageAttemptDirectory(root, location), 'artifacts', location.artifactName);
}

export function resolveEventPath(root: string, runId: RunId, eventName: string): string {
  return join(resolveRunDirectory(root, runId), 'events', eventName);
}

export function resolveRunSummaryPath(root: string, runId: RunId): string {
  return join(resolveRunDirectory(root, runId), 'run.json');
}

async function writeJson(path: string, data: unknown, flag: 'w' | 'wx'): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), { encoding: 'utf8', flag });
}

export async function writeArtifactFile(
  root: string,
  location: ArtifactLocation,
  data: unknown
): Promise<ArtifactMetadata> {
  const path = resolveArtifactPath(root, location);
  const createdAt = new Date().toISOString();
  await writeJson(path, data, 'wx');

  return {
    ...location,
    path,
    createdAt,
  };
}

export async function writeEventFile(
  root: string,
  runId: RunId,
  eventName: string,
  data: unknown
): Promise<EventMetadata> {
  const path = resolveEventPath(root, runId, eventName);
  const createdAt = new Date().toISOString();
  await writeJson(path, data, 'wx');

  return {
    runId,
    eventName,
    path,
    createdAt,
  };
}

export async function readRunSummary(root: string, runId: RunId): Promise<RunSummaryData | null> {
  try {
    const raw = await readFile(resolveRunSummaryPath(root, runId), 'utf8');
    return JSON.parse(raw) as RunSummaryData;
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function writeRunSummary(root: string, summary: RunSummaryData): Promise<void> {
  const now = new Date().toISOString();
  await writeJson(
    resolveRunSummaryPath(root, summary.runId),
    {
      ...summary,
      createdAt: summary.createdAt ?? now,
      updatedAt: now,
    },
    'w'
  );
}

export async function updateRunSummary(
  root: string,
  runId: RunId,
  update: (summary: RunSummaryData) => RunSummaryData
): Promise<RunSummaryData> {
  const existing = await readRunSummary(root, runId);
  const next = update(existing ?? {
    runId,
    status: 'running',
    stages: {},
  });

  await writeRunSummary(root, next);
  const written = await readRunSummary(root, runId);
  if (!written) {
    throw new Error(`Failed to write run summary for ${runId}`);
  }
  return written;
}

export async function scheduleNextJob<TData extends JobPayload>(
  queue: QueueLike,
  jobName: TData['type'],
  data: TData
): Promise<unknown> {
  return queue.add(jobName, data);
}
