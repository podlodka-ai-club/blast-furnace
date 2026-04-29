import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WORKFLOW_STAGES } from '../types/index.js';
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
  StableRunContext,
  StageHandoffJobPayload,
  StageAttemptLocation,
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

function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && (WORKFLOW_STAGES as readonly string[]).includes(value);
}

function toDependency(dependsOn: InputRecordRef | HandoffRecordDependency): HandoffRecordDependency {
  return typeof dependsOn === 'string' ? dependsOn : dependsOn.recordId;
}

function toDependencies(dependsOn: Array<InputRecordRef | HandoffRecordDependency> | undefined): HandoffRecordDependency[] {
  return (dependsOn ?? []).map(toDependency);
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
  dependsOn?: Array<InputRecordRef | HandoffRecordDependency>;
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
    dependsOn: toDependencies(input.dependsOn),
    status: input.status,
    output: input.output,
  };

  const inputRecordRef = toInputRecordRef(fileSet, record);
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

function validateDependencyReference(value: unknown, label = 'dependsOn entry'): asserts value is HandoffRecordDependency {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty record id string`);
  }
}

const STABLE_CONTEXT_FIELDS = ['issue', 'repository', 'branchName', 'workspacePath'] as const;
const PRIOR_OUTPUT_FIELDS_BY_STAGE: Partial<Record<WorkflowStage, readonly string[]>> = {
  'prepare-run': ['assessment', 'plan', 'development', 'quality', 'review', 'pullRequest', 'trackerLabels'],
  assess: ['plan', 'development', 'quality', 'review', 'pullRequest', 'trackerLabels'],
  plan: ['assessment', 'development', 'quality', 'review', 'pullRequest', 'trackerLabels'],
  develop: ['assessment', 'plan', 'review', 'pullRequest', 'trackerLabels'],
  review: ['assessment', 'plan', 'development', 'quality', 'pullRequest', 'trackerLabels'],
  'make-pr': ['assessment', 'plan', 'development', 'quality', 'review', 'trackerLabels'],
  'sync-tracker-state': ['assessment', 'plan', 'development', 'quality', 'review', 'pullRequest'],
};

function validateStageLocalOutput(stage: WorkflowStage, output: unknown): void {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    throw new Error('Handoff record output must be an object');
  }
  const objectOutput = output as Record<string, unknown>;
  const forbiddenFields = [
    ...STABLE_CONTEXT_FIELDS,
    ...(PRIOR_OUTPUT_FIELDS_BY_STAGE[stage] ?? []),
  ];
  for (const field of forbiddenFields) {
    if (field in objectOutput) {
      throw new Error(`${stage} output must not include ${field}`);
    }
  }
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
  if (!isWorkflowStage(record.fromStage)) throw new Error('Handoff record must include valid fromStage');
  if (record.toStage !== null && !isWorkflowStage(record.toStage)) {
    throw new Error('Handoff record must include valid toStage or null');
  }
  if (!Number.isInteger(record.stageAttempt) || record.stageAttempt < 1) {
    throw new Error('Handoff record stageAttempt must be a positive integer');
  }
  if (!Number.isInteger(record.reworkAttempt) || record.reworkAttempt < 0) {
    throw new Error('Handoff record reworkAttempt must be a non-negative integer');
  }
  if (!Array.isArray(record.dependsOn)) {
    throw new Error('dependsOn must be an array');
  }
  record.dependsOn.forEach((dependency, index) => validateDependencyReference(dependency, `dependsOn[${index}]`));
  if (!['success', 'failure', 'blocked', 'clarify', 'rework-needed'].includes(record.status)) {
    throw new Error(`Invalid handoff record status: ${record.status}`);
  }
  if ('nextInput' in (record as unknown as Record<string, unknown>)) {
    throw new Error('Handoff record must not include nextInput');
  }
  validateStageLocalOutput(record.fromStage, record.output);
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

export async function updateStableRunContext(
  root: string,
  runId: RunId,
  stableContext: StableRunContext
): Promise<RunSummaryData> {
  return updateRunSummary(root, runId, (summary) => {
    const existing = summary.stableContext;
    return {
      ...summary,
      stableContext: {
        issue: stableContext.issue,
        repository: stableContext.repository,
        branchName: existing?.branchName ?? stableContext.branchName,
        workspacePath: existing?.workspacePath ?? stableContext.workspacePath,
      },
    };
  });
}

export async function scheduleNextJob<TData extends JobPayload>(
  queue: QueueLike,
  jobName: TData['type'],
  data: TData
): Promise<unknown> {
  return queue.add(jobName, data);
}
