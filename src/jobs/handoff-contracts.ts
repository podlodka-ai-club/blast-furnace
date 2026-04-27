import type {
  AssessOutput,
  DevelopOutput,
  HandoffRecord,
  InputRecordRef,
  MakePrOutput,
  PlanOutput,
  PrepareRunOutput,
  QualityGateOutput,
  ReviewOutput,
  StageHandoffJobPayload,
  SyncTrackerStateOutput,
  WorkflowStage,
} from '../types/index.js';
import { validateHandoffRecord } from './orchestration.js';
import { validateInputRecordRef, validateStagePayload } from './stage-payloads.js';

export interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

type DownstreamStage = Exclude<WorkflowStage, 'intake' | 'prepare-run'>;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value: Record<string, unknown>, field: string): void {
  if (typeof value[field] !== 'string' || value[field].length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function requireNumber(value: Record<string, unknown>, field: string): void {
  if (!Number.isInteger(value[field])) {
    throw new Error(`${field} must be an integer`);
  }
}

function requireObject(value: Record<string, unknown>, field: string): void {
  assertObject(value[field], field);
}

function requirePreparedFields(value: Record<string, unknown>): void {
  requireString(value, 'runId');
  requireString(value, 'branchName');
  requireString(value, 'workspacePath');
  requireNumber(value, 'stageAttempt');
  requireNumber(value, 'reworkAttempt');
  requireObject(value, 'issue');
  requireObject(value, 'repository');
}

function requireStatus(value: Record<string, unknown>, expected: string): void {
  if (value['status'] !== expected) {
    throw new Error(`status must be ${expected}`);
  }
}

function parsePreparedOutput<T>(value: unknown, label: string, status = 'success'): T {
  assertObject(value, label);
  requireStatus(value, status);
  requirePreparedFields(value);
  return value as T;
}

function parseAssessOutput(value: unknown): AssessOutput {
  const parsed = parsePreparedOutput<AssessOutput>(value, 'assess output');
  requireObject(parsed as unknown as Record<string, unknown>, 'assessment');
  return parsed;
}

function parsePlanOutput(value: unknown): PlanOutput {
  const parsed = parseAssessOutput(value) as unknown as PlanOutput;
  requireObject(parsed as unknown as Record<string, unknown>, 'plan');
  return parsed;
}

function parseDevelopOutput(value: unknown): DevelopOutput {
  const parsed = parsePlanOutput(value) as unknown as DevelopOutput;
  requireObject(parsed as unknown as Record<string, unknown>, 'development');
  return parsed;
}

function parseQualityGateOutput(value: unknown): QualityGateOutput {
  const parsed = parseDevelopOutput(value) as unknown as QualityGateOutput;
  requireObject(parsed as unknown as Record<string, unknown>, 'quality');
  return parsed;
}

function parseReviewOutput(value: unknown): ReviewOutput {
  const parsed = parseQualityGateOutput(value) as unknown as ReviewOutput;
  requireObject(parsed as unknown as Record<string, unknown>, 'review');
  return parsed;
}

function parseMakePrOutput(value: unknown): MakePrOutput {
  assertObject(value, 'make-pr output');
  requirePreparedFields(value);
  requireObject(value, 'development');
  requireObject(value, 'quality');
  requireObject(value, 'review');

  if (value['status'] === 'pull-request-created') {
    requireObject(value, 'pullRequest');
    return value as unknown as MakePrOutput;
  }
  if (value['status'] === 'no-changes') {
    return value as unknown as MakePrOutput;
  }

  throw new Error('make-pr status must be pull-request-created or no-changes');
}

function parseSyncTrackerStateOutput(value: unknown): SyncTrackerStateOutput {
  const parsed = parsePreparedOutput<SyncTrackerStateOutput>(value, 'sync-tracker-state output', 'tracker-synced');
  requireObject(parsed as unknown as Record<string, unknown>, 'pullRequest');
  if (!Array.isArray((parsed as unknown as Record<string, unknown>)['trackerLabels'])) {
    throw new Error('trackerLabels must be an array');
  }
  return parsed;
}

export const inputRecordRefSchema: RuntimeSchema<InputRecordRef> = {
  parse(value) {
    validateInputRecordRef(value);
    return value;
  },
};

export const runSummaryPointerSchema: RuntimeSchema<InputRecordRef> = inputRecordRefSchema;

export const handoffRecordSchema: RuntimeSchema<HandoffRecord> = {
  parse(value) {
    assertObject(value, 'handoff record');
    validateHandoffRecord(value as unknown as HandoffRecord);
    return value as unknown as HandoffRecord;
  },
};

function payloadSchema<TStage extends DownstreamStage>(stage: TStage): RuntimeSchema<StageHandoffJobPayload<TStage>> {
  return {
    parse(value) {
      validateStagePayload(stage, value);
      return value;
    },
  };
}

export const stagePayloadSchemas = {
  assess: payloadSchema('assess'),
  plan: payloadSchema('plan'),
  develop: payloadSchema('develop'),
  'quality-gate': payloadSchema('quality-gate'),
  review: payloadSchema('review'),
  'make-pr': payloadSchema('make-pr'),
  'sync-tracker-state': payloadSchema('sync-tracker-state'),
} as const;

export const stageOutputSchemas = {
  'prepare-run': {
    parse: (value: unknown) => parsePreparedOutput<PrepareRunOutput>(value, 'prepare-run output'),
  },
  assess: {
    parse: parseAssessOutput,
  },
  plan: {
    parse: parsePlanOutput,
  },
  develop: {
    parse: parseDevelopOutput,
  },
  'quality-gate': {
    parse: parseQualityGateOutput,
  },
  review: {
    parse: parseReviewOutput,
  },
  'make-pr': {
    parse: parseMakePrOutput,
  },
  'sync-tracker-state': {
    parse: parseSyncTrackerStateOutput,
  },
} as const;

export function parseStageOutput(stage: Exclude<WorkflowStage, 'intake'>, value: unknown): unknown {
  return stageOutputSchemas[stage].parse(value as never);
}
