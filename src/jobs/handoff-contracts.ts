import type {
  AssessOutput,
  DevelopOutput,
  HandoffRecord,
  InputRecordRef,
  MakePrOutput,
  PlanOutput,
  PrepareRunOutput,
  QualityGateResult,
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

function requireStringValue(value: Record<string, unknown>, field: string): void {
  if (typeof value[field] !== 'string') {
    throw new Error(`${field} must be a string`);
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

function parsePreparedFields<T>(value: unknown, label: string): T {
  assertObject(value, label);
  requirePreparedFields(value);
  return value as T;
}

function parseAssessOutput(value: unknown): AssessOutput {
  const parsed = parsePreparedOutput<AssessOutput>(value, 'assess output');
  requireObject(parsed as unknown as Record<string, unknown>, 'assessment');
  return parsed;
}

function parsePlanOutput(value: unknown): PlanOutput {
  const parsed = parsePreparedFields<Record<string, unknown>>(value, 'plan output') as unknown as PlanOutput;
  if (!['success', 'validation-failed'].includes(String(parsed.status))) {
    throw new Error('plan status must be success or validation-failed');
  }
  requireObject(parsed as unknown as Record<string, unknown>, 'assessment');
  const plan = (parsed as unknown as Record<string, unknown>)['plan'];
  requireObject(parsed as unknown as Record<string, unknown>, 'plan');
  assertObject(plan, 'plan');
  if (!['success', 'validation-failed'].includes(String(plan['status']))) {
    throw new Error('plan.status must be success or validation-failed');
  }
  requireString(plan, 'summary');
  requireString(plan, 'content');
  if (plan['status'] === 'validation-failed') {
    requireString(plan, 'failureReason');
  }
  return parsed;
}

function parsePlanFields(value: unknown): Record<string, unknown> {
  const parsed = parsePreparedFields<Record<string, unknown>>(value, 'stage output');
  requireObject(parsed, 'assessment');
  requireObject(parsed, 'plan');
  return parsed;
}

function parseQualityGateResult(value: unknown): QualityGateResult {
  assertObject(value, 'quality');
  if (!['passed', 'failed', 'misconfigured', 'timed-out'].includes(String(value['status']))) {
    throw new Error('quality.status must be passed, failed, misconfigured, or timed-out');
  }
  requireStringValue(value, 'command');
  requireNumber(value, 'attempts');
  requireNumber(value, 'durationMs');
  requireString(value, 'summary');
  if (value['exitCode'] !== undefined) {
    requireNumber(value, 'exitCode');
  }
  if (value['outputPath'] !== undefined) {
    requireString(value, 'outputPath');
  }
  return value as unknown as QualityGateResult;
}

function parseDevelopOutput(value: unknown): DevelopOutput {
  const parsed = parsePlanFields(value) as unknown as DevelopOutput;
  if (!['success', 'quality-failed', 'quality-timed-out', 'quality-misconfigured'].includes(String(parsed.status))) {
    throw new Error('develop status must be success, quality-failed, quality-timed-out, or quality-misconfigured');
  }
  requireObject(parsed as unknown as Record<string, unknown>, 'development');
  requireObject(parsed as unknown as Record<string, unknown>, 'quality');
  const quality = parseQualityGateResult((parsed as unknown as Record<string, unknown>)['quality']);
  const expectedQualityStatusByDevelopStatus: Record<DevelopOutput['status'], QualityGateResult['status']> = {
    success: 'passed',
    'quality-failed': 'failed',
    'quality-timed-out': 'timed-out',
    'quality-misconfigured': 'misconfigured',
  };
  const expectedQualityStatus = expectedQualityStatusByDevelopStatus[parsed.status];
  if (quality.status !== expectedQualityStatus) {
    throw new Error(`develop ${parsed.status} requires quality.status ${expectedQualityStatus}`);
  }
  return parsed;
}

function parseReviewOutput(value: unknown): ReviewOutput {
  const parsed = parseDevelopOutput(value) as unknown as ReviewOutput;
  if (parsed.quality.status !== 'passed') {
    throw new Error('review input quality.status must be passed');
  }
  requireStatus(parsed as unknown as Record<string, unknown>, 'success');
  requireObject(parsed as unknown as Record<string, unknown>, 'review');
  return parsed;
}

function parseMakePrOutput(value: unknown): MakePrOutput {
  assertObject(value, 'make-pr output');
  requirePreparedFields(value);
  requireObject(value, 'development');
  requireObject(value, 'quality');
  const quality = parseQualityGateResult(value['quality']);
  if (quality.status !== 'passed') {
    throw new Error('make-pr input quality.status must be passed');
  }
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
