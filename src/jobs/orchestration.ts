import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ArtifactLocation,
  ArtifactMetadata,
  EventMetadata,
  HandoffRecord,
  HandoffRecordDependency,
  HandoffStatus,
  InputRecordRef,
  JobPayload,
  RunId,
  RunFileSet,
  RunSummaryData,
  StageHandoffJobPayload,
  StageAttemptLocation,
  StageJobPayload,
  WorkflowStage,
} from '../types/index.js';
import { validateStageInputRecord } from './stage-payloads.js';

export interface QueueLike {
  add(name: string, data: JobPayload): Promise<unknown>;
}

export function resolveRunDirectory(root: string, runId: RunId): string {
  return join(root, '.orchestrator', 'runs', runId);
}

export function resolveOrchestrationStorageRoot(ref?: InputRecordRef): string {
  if (ref) {
    return dirname(dirname(dirname(ref.runDir)));
  }

  return process.env['ORCHESTRATION_STORAGE_ROOT'] ?? process.cwd();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatRunTimestamp(date = new Date()): string {
  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    '_',
    pad(date.getUTCHours()),
    '.',
    pad(date.getUTCMinutes()),
  ].join('');
}

export function createRunFileSet(root: string, runId: RunId, date = new Date()): RunFileSet {
  return resolveRunFileSet(root, runId, formatRunTimestamp(date));
}

export function resolveRunFileSet(root: string, runId: RunId, timestampPrefix: string): RunFileSet {
  const filePrefix = `${timestampPrefix}_${runId}`;
  const runDirectory = join(root, '.orchestrator', 'runs', filePrefix);

  return {
    runId,
    timestampPrefix,
    runDirectory,
    runSummaryPath: join(runDirectory, `${filePrefix}_run.json`),
    handoffLedgerPath: join(runDirectory, `${filePrefix}_handoff.jsonl`),
  };
}

export function resolveRunFileSetFromSummary(summary: RunSummaryData): RunFileSet {
  if (
    !summary.timestampPrefix ||
    !summary.runDirectory ||
    !summary.runSummaryPath ||
    !summary.handoffLedgerPath
  ) {
    throw new Error(`Run summary for ${summary.runId} does not contain timestamped run file metadata`);
  }

  return {
    runId: summary.runId,
    timestampPrefix: summary.timestampPrefix,
    runDirectory: summary.runDirectory,
    runSummaryPath: summary.runSummaryPath,
    handoffLedgerPath: summary.handoffLedgerPath,
  };
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

async function findTimestampedRunSummaryPath(root: string, runId: RunId): Promise<string | null> {
  const runsRoot = join(root, '.orchestrator', 'runs');
  let entries: string[];
  try {
    entries = await readdir(runsRoot);
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  const suffix = `_${runId}`;
  const matches = entries
    .filter((entry) => entry.endsWith(suffix))
    .sort()
    .reverse();

  if (matches.length === 0) {
    return null;
  }

  const filePrefix = matches[0];
  return join(runsRoot, filePrefix, `${filePrefix}_run.json`);
}

async function resolveWritableRunSummaryPath(root: string, summary: RunSummaryData): Promise<string> {
  if (summary.runSummaryPath) {
    return summary.runSummaryPath;
  }

  const existingPath = await findTimestampedRunSummaryPath(root, summary.runId);
  return existingPath ?? resolveRunSummaryPath(root, summary.runId);
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
  const timestampedPath = await findTimestampedRunSummaryPath(root, runId);
  const paths = [
    ...(timestampedPath ? [timestampedPath] : []),
    resolveRunSummaryPath(root, runId),
  ];

  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as RunSummaryData;
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        continue;
      }
      throw err;
    }
  }

  return null;
}

export async function writeRunSummary(root: string, summary: RunSummaryData): Promise<void> {
  const now = new Date().toISOString();
  await writeJson(
    await resolveWritableRunSummaryPath(root, summary),
    {
      ...summary,
      createdAt: summary.createdAt ?? now,
      updatedAt: now,
    },
    'w'
  );
}

export async function initializeRunSummary(
  root: string,
  fileSet: RunFileSet,
  summary: Omit<RunSummaryData, 'timestampPrefix' | 'runDirectory' | 'runSummaryPath' | 'handoffLedgerPath'>
): Promise<RunSummaryData> {
  const initialized: RunSummaryData = {
    ...summary,
    timestampPrefix: fileSet.timestampPrefix,
    runDirectory: fileSet.runDirectory,
    runSummaryPath: fileSet.runSummaryPath,
    handoffLedgerPath: fileSet.handoffLedgerPath,
  };

  await mkdir(fileSet.runDirectory, { recursive: true });
  await writeFile(fileSet.handoffLedgerPath, '', { encoding: 'utf8', flag: 'a' });
  await writeRunSummary(root, initialized);
  const written = await readRunSummary(root, fileSet.runId);
  if (!written) {
    throw new Error(`Failed to initialize run summary for ${fileSet.runId}`);
  }
  return written;
}

function isInputRecordRef(value: unknown): value is InputRecordRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runDir' in value &&
    typeof value.runDir === 'string' &&
    'handoffPath' in value &&
    typeof value.handoffPath === 'string' &&
    'recordId' in value &&
    typeof value.recordId === 'string' &&
    'sequence' in value &&
    typeof value.sequence === 'number' &&
    'stage' in value &&
    typeof value.stage === 'string'
  );
}

function toDependency(dependsOn: InputRecordRef | HandoffRecordDependency | null | undefined): HandoffRecordDependency | null {
  if (!dependsOn) return null;
  return {
    recordId: dependsOn.recordId,
    sequence: dependsOn.sequence,
    stage: dependsOn.stage,
  };
}

function toInputRecordRef(fileSet: RunFileSet, record: HandoffRecord): InputRecordRef {
  return {
    runDir: fileSet.runDirectory,
    handoffPath: fileSet.handoffLedgerPath,
    recordId: record.recordId,
    sequence: record.sequence,
    stage: record.fromStage,
  };
}

function recordIdFor(sequence: number, fromStage: WorkflowStage, toStage: WorkflowStage | null): string {
  return `${String(sequence).padStart(6, '0')}_${fromStage}_to_${toStage ?? 'terminal'}`;
}

export interface AppendHandoffRecordInput {
  runId: RunId;
  fromStage: WorkflowStage;
  toStage: WorkflowStage | null;
  stageAttempt: number;
  reworkAttempt: number;
  dependsOn?: InputRecordRef | HandoffRecordDependency | null;
  status: HandoffStatus;
  output: unknown;
  createdAt?: string;
}

export interface AppendHandoffRecordResult {
  record: HandoffRecord;
  inputRecordRef: InputRecordRef;
}

export async function readHandoffRecords(handoffPath: string): Promise<HandoffRecord[]> {
  try {
    const raw = await readFile(handoffPath, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as HandoffRecord);
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

export async function readHandoffRecord(ref: InputRecordRef): Promise<HandoffRecord> {
  const records = await readHandoffRecords(ref.handoffPath);
  const record = records.find((candidate) => candidate.recordId === ref.recordId && candidate.sequence === ref.sequence);
  if (!record) {
    throw new Error(`Handoff record not found: ${ref.recordId}`);
  }
  return record;
}

export async function appendHandoffRecord(
  root: string,
  input: AppendHandoffRecordInput
): Promise<AppendHandoffRecordResult> {
  const summary = await readRunSummary(root, input.runId);
  if (!summary) {
    throw new Error(`Run summary not found for ${input.runId}`);
  }
  const fileSet = resolveRunFileSetFromSummary(summary);
  const records = await readHandoffRecords(fileSet.handoffLedgerPath);
  const sequence = records.length + 1;
  const record: HandoffRecord = {
    recordId: recordIdFor(sequence, input.fromStage, input.toStage),
    sequence,
    runId: input.runId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    fromStage: input.fromStage,
    toStage: input.toStage,
    stageAttempt: input.stageAttempt,
    reworkAttempt: input.reworkAttempt,
    dependsOn: toDependency(input.dependsOn),
    status: input.status,
    output: input.output,
    nextInput: null,
  };

  const inputRecordRef = toInputRecordRef(fileSet, record);
  record.nextInput = input.toStage ? {
    taskId: `${input.toStage}-${input.runId}-${sequence}`,
    type: input.toStage,
    runId: input.runId,
    stage: input.toStage,
    stageAttempt: input.stageAttempt,
    reworkAttempt: input.reworkAttempt,
    inputRecordRef,
  } as StageJobPayload : null;

  validateHandoffRecord(record);
  await mkdir(dirname(fileSet.handoffLedgerPath), { recursive: true });
  await appendFile(fileSet.handoffLedgerPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });

  return { record, inputRecordRef };
}

type DownstreamStage = Exclude<WorkflowStage, 'intake' | 'prepare-run'>;

export async function readValidatedStageInputRecord(
  payload: StageHandoffJobPayload<DownstreamStage>
): Promise<HandoffRecord> {
  const record = await readHandoffRecord(payload.inputRecordRef);
  validateStageInputRecord(payload, record);
  return record;
}

export async function appendHandoffRecordAndUpdateSummary(
  root: string,
  input: AppendHandoffRecordInput,
  runStatus?: string
): Promise<AppendHandoffRecordResult> {
  const result = await appendHandoffRecord(root, input);
  await updateRunSummaryForHandoff(root, result.record, result.inputRecordRef, runStatus);
  return result;
}

export function validateHandoffRecord(record: HandoffRecord): void {
  if (!record.recordId) throw new Error('Handoff record must include recordId');
  if (!Number.isInteger(record.sequence) || record.sequence < 1) {
    throw new Error('Handoff record sequence must be a positive integer');
  }
  if (!record.runId) throw new Error('Handoff record must include runId');
  if (!record.createdAt || Number.isNaN(new Date(record.createdAt).getTime())) {
    throw new Error('Handoff record must include valid createdAt');
  }
  if (!record.fromStage) throw new Error('Handoff record must include fromStage');
  if (!['success', 'failure', 'blocked', 'clarify', 'rework-needed'].includes(record.status)) {
    throw new Error(`Invalid handoff record status: ${record.status}`);
  }
  if (record.nextInput !== null && !isInputRecordRef((record.nextInput as { inputRecordRef?: unknown }).inputRecordRef)) {
    throw new Error('Handoff record nextInput must include a valid inputRecordRef');
  }
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

export async function updateRunSummaryForHandoff(
  root: string,
  record: HandoffRecord,
  ref: InputRecordRef,
  status = record.toStage === null ? 'completed' : 'running'
): Promise<RunSummaryData> {
  return updateRunSummary(root, record.runId, (summary) => ({
    ...summary,
    status,
    currentStage: record.toStage,
    stageAttempt: record.stageAttempt,
    reworkAttempt: record.reworkAttempt,
    latestHandoffRecord: ref,
    handoffLedgerPath: summary.handoffLedgerPath ?? ref.handoffPath,
    runDirectory: summary.runDirectory ?? ref.runDir,
    stages: {
      ...summary.stages,
      [record.fromStage]: {
        attempts: record.stageAttempt,
        status: record.status,
        updatedAt: record.createdAt,
      },
    },
  }));
}

export async function scheduleNextJob<TData extends JobPayload>(
  queue: QueueLike,
  jobName: TData['type'],
  data: TData
): Promise<unknown> {
  return queue.add(jobName, data);
}
