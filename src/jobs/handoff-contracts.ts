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

function requireStageMetadata(value: Record<string, unknown>): void {
  requireString(value, 'runId');
  requireNumber(value, 'stageAttempt');
  requireNumber(value, 'reworkAttempt');
}

function requireStatus(value: Record<string, unknown>, expected: string): void {
  if (value['status'] !== expected) {
    throw new Error(`status must be ${expected}`);
  }
}

const STABLE_CONTEXT_FIELDS = ['issue', 'repository', 'branchName', 'workspacePath'] as const;

function rejectFields(value: Record<string, unknown>, label: string, fields: readonly string[]): void {
  for (const field of fields) {
    if (field in value) {
      throw new Error(`${label} must not include ${field}`);
    }
  }
}

function parseAssessOutput(value: unknown): AssessOutput {
  assertObject(value, 'assess output');
  rejectFields(value, 'assess output', [
    ...STABLE_CONTEXT_FIELDS,
    'plan',
    'development',
    'quality',
    'review',
    'pullRequest',
    'trackerLabels',
  ]);
  requireStatus(value, 'success');
  requireStageMetadata(value);
  requireObject(value, 'assessment');
  const parsed = value as unknown as AssessOutput;
  return parsed;
}

function parsePlanOutput(value: unknown): PlanOutput {
  assertObject(value, 'plan output');
  rejectFields(value, 'plan output', [
    ...STABLE_CONTEXT_FIELDS,
    'assessment',
    'development',
    'quality',
    'review',
    'pullRequest',
    'trackerLabels',
  ]);
  requireStageMetadata(value);
  if (!['success', 'validation-failed'].includes(String(value['status']))) {
    throw new Error('plan status must be success or validation-failed');
  }
  const plan = value['plan'];
  requireObject(value, 'plan');
  assertObject(plan, 'plan');
  if (!['success', 'validation-failed'].includes(String(plan['status']))) {
    throw new Error('plan.status must be success or validation-failed');
  }
  requireString(plan, 'summary');
  requireString(plan, 'content');
  if (plan['status'] === 'validation-failed') {
    requireString(plan, 'failureReason');
  }
  if (value['status'] === 'success' && plan['status'] !== 'success') {
    throw new Error('successful plan output requires plan.status success');
  }
  if (value['status'] === 'validation-failed' && plan['status'] !== 'validation-failed') {
    throw new Error('validation-failed plan output requires plan.status validation-failed');
  }
  return value as unknown as PlanOutput;
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
  assertObject(value, 'develop output');
  rejectFields(value, 'develop output', [
    ...STABLE_CONTEXT_FIELDS,
    'assessment',
    'plan',
    'review',
    'pullRequest',
    'trackerLabels',
  ]);
  requireStageMetadata(value);
  if (!['success', 'quality-failed', 'quality-timed-out', 'quality-misconfigured'].includes(String(value['status']))) {
    throw new Error('develop status must be success, quality-failed, quality-timed-out, or quality-misconfigured');
  }
  requireObject(value, 'development');
  requireObject(value, 'quality');
  const quality = parseQualityGateResult(value['quality']);
  const parsed = value as unknown as DevelopOutput;
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
  if (quality.status === 'passed' && quality.outputPath !== undefined) {
    throw new Error('passed quality output must not include outputPath');
  }
  return parsed;
}

function parseReviewOutput(value: unknown): ReviewOutput {
  assertObject(value, 'review output');
  rejectFields(value, 'review output', [
    ...STABLE_CONTEXT_FIELDS,
    'assessment',
    'plan',
    'development',
    'quality',
    'pullRequest',
    'trackerLabels',
  ]);
  requireStatus(value, 'success');
  requireStageMetadata(value);
  requireObject(value, 'review');
  return value as unknown as ReviewOutput;
}

function parseMakePrOutput(value: unknown): MakePrOutput {
  assertObject(value, 'make-pr output');
  rejectFields(value, 'make-pr output', [
    ...STABLE_CONTEXT_FIELDS,
    'assessment',
    'plan',
    'development',
    'quality',
    'review',
    'trackerLabels',
  ]);
  requireStageMetadata(value);

  if (value['status'] === 'pull-request-created') {
    requireObject(value, 'pullRequest');
    return value as unknown as MakePrOutput;
  }
  if (value['status'] === 'no-changes') {
    if ('pullRequest' in value) {
      throw new Error('no-changes make-pr output must not include pullRequest');
    }
    return value as unknown as MakePrOutput;
  }

  throw new Error('make-pr status must be pull-request-created or no-changes');
}

function parseSyncTrackerStateOutput(value: unknown): SyncTrackerStateOutput {
  assertObject(value, 'sync-tracker-state output');
  rejectFields(value, 'sync-tracker-state output', [
    ...STABLE_CONTEXT_FIELDS,
    'assessment',
    'plan',
    'development',
    'quality',
    'review',
    'pullRequest',
  ]);
  requireStatus(value, 'tracker-synced');
  requireStageMetadata(value);
  if (!Array.isArray(value['trackerLabels'])) {
    throw new Error('trackerLabels must be an array');
  }
  return value as unknown as SyncTrackerStateOutput;
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
    parse: (value: unknown) => {
      assertObject(value, 'prepare-run output');
      rejectFields(value, 'prepare-run output', [
        ...STABLE_CONTEXT_FIELDS,
        'assessment',
        'plan',
        'development',
        'quality',
        'review',
        'pullRequest',
        'trackerLabels',
      ]);
      requireStatus(value, 'success');
      requireStageMetadata(value);
      return value as unknown as PrepareRunOutput;
    },
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
