import type {
  AssessJobData,
  AssessOutput,
  DevelopJobData,
  DevelopOutput,
  DevelopmentResult,
  HandoffRecord,
  HandoffRecordDependency,
  InputRecordRef,
  MakePrJobData,
  PlanJobData,
  PlanOutput,
  PlanResult,
  PrepareRunOutput,
  PrReworkIntakeOutput,
  PullRequestOutput,
  QualityGateResult,
  ReviewJobData,
  ReviewOutput,
  ReviewResult,
  StableRunContext,
  SyncTrackerStateJobData,
  WorkflowStage,
} from '../types/index.js';
import {
  readHandoffRecords,
  readRunSummary,
  readValidatedStageInputRecord,
  resolveOrchestrationStorageRoot,
} from './orchestration.js';
import { parseStageOutput, stagePayloadSchemas } from './handoff-contracts.js';

export interface AssessContext {
  runContext: StableRunContext;
  prepareRun: unknown;
  inputRecord: HandoffRecord;
}

export interface PlanContext {
  runContext: StableRunContext;
  inputKind: 'assess' | 'pr-rework';
  assessment?: AssessOutput['assessment'];
  inputRecord: HandoffRecord<AssessOutput> | HandoffRecord<PrepareRunOutput>;
  prReworkRecord?: HandoffRecord<PrReworkIntakeOutput>;
  latestPlanRecord?: HandoffRecord<PlanOutput>;
  latestPlan?: Extract<PlanResult, { status: 'success' }>;
  commentsMarkdown?: string;
}

export interface DevelopContext {
  runContext: StableRunContext;
  inputKind: 'plan' | 'review-rework' | 'human-pr-rework';
  plan: Extract<PlanResult, { status: 'success' }>;
  reviewFailureContent?: string;
  inputRecord: HandoffRecord<PlanOutput> | HandoffRecord<ReviewOutput> | HandoffRecord<PrepareRunOutput>;
  prReworkRecord?: HandoffRecord<PrReworkIntakeOutput>;
  planRecord: HandoffRecord<PlanOutput>;
}

export interface ReviewContext {
  runContext: StableRunContext;
  plan: Extract<PlanResult, { status: 'success' }>;
  development: DevelopmentResult;
  quality: QualityGateResult & { status: 'passed' };
  inputRecord: HandoffRecord<DevelopOutput>;
  planRecord: HandoffRecord<PlanOutput>;
}

export interface MakePrContext {
  runContext: StableRunContext;
  plan: Extract<PlanResult, { status: 'success' }>;
  development: DevelopmentResult;
  quality: QualityGateResult & { status: 'passed' };
  review: ReviewResult;
  inputRecord: HandoffRecord<ReviewOutput>;
  developRecord: HandoffRecord<DevelopOutput>;
  planRecord: HandoffRecord<PlanOutput>;
}

export interface SyncTrackerStateContext {
  runContext: StableRunContext;
  pullRequest: PullRequestOutput['pullRequest'];
  inputRecord: HandoffRecord<PullRequestOutput>;
}

type DownstreamPayload =
  | AssessJobData
  | PlanJobData
  | DevelopJobData
  | ReviewJobData
  | MakePrJobData
  | SyncTrackerStateJobData;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertStableRunContext(value: unknown): asserts value is StableRunContext {
  assertObject(value, 'stableContext');
  assertObject(value['issue'], 'stableContext.issue');
  assertObject(value['repository'], 'stableContext.repository');
  if (typeof value['branchName'] !== 'string' || value['branchName'].length === 0) {
    throw new Error('stableContext.branchName must be a non-empty string');
  }
  if (typeof value['workspacePath'] !== 'string' || value['workspacePath'].length === 0) {
    throw new Error('stableContext.workspacePath must be a non-empty string');
  }
}

async function readStableRunContext(payload: DownstreamPayload): Promise<StableRunContext> {
  const root = resolveOrchestrationStorageRoot(payload.inputRecordRef);
  const summary = await readRunSummary(root, payload.runId);
  if (!summary) {
    throw new Error(`Run summary not found for ${payload.runId}`);
  }
  assertStableRunContext(summary.stableContext);
  return summary.stableContext;
}

function ensureInputStage(record: HandoffRecord, expectedStage: WorkflowStage, label = 'input record'): void {
  if (record.fromStage !== expectedStage) {
    throw new Error(`${label} expected stage ${expectedStage} but found ${record.fromStage}`);
  }
}

function findHandoffRecordById(records: HandoffRecord[], recordId: HandoffRecordDependency): HandoffRecord {
  const record = records.find((candidate) => candidate.recordId === recordId);
  if (!record) {
    throw new Error(`Handoff dependency record not found: ${recordId}`);
  }
  return record;
}

function validateDependencyRecord<TOutput>(
  record: HandoffRecord,
  expectedStage: Exclude<WorkflowStage, 'intake'>
): HandoffRecord<TOutput> {
  if (record.fromStage !== expectedStage) {
    throw new Error(`Handoff dependency ${record.recordId} expected stage ${expectedStage} but found ${record.fromStage}`);
  }
  parseStageOutput(expectedStage, record.output);
  return record as HandoffRecord<TOutput>;
}

export async function loadDependencyRecord<TOutput>(
  inputRecordRef: InputRecordRef,
  dependency: HandoffRecordDependency,
  expectedStage: Exclude<WorkflowStage, 'intake'>
): Promise<HandoffRecord<TOutput>> {
  const records = await readHandoffRecords(inputRecordRef.handoffPath);
  return validateDependencyRecord<TOutput>(findHandoffRecordById(records, dependency), expectedStage);
}

async function loadRequiredDependencyRecord<TOutput>(
  inputRecordRef: InputRecordRef,
  sourceRecord: HandoffRecord,
  expectedStage: Exclude<WorkflowStage, 'intake'>
): Promise<HandoffRecord<TOutput>> {
  if (sourceRecord.dependsOn.length === 0) {
    throw new Error(`Missing required ${expectedStage} dependency`);
  }

  const records = await readHandoffRecords(inputRecordRef.handoffPath);
  const dependencyRecords = sourceRecord.dependsOn.map((recordId) => findHandoffRecordById(records, recordId));
  const matches = dependencyRecords.filter((record) => record.fromStage === expectedStage);
  if (matches.length === 0) {
    if (dependencyRecords.length === 1) {
      return validateDependencyRecord<TOutput>(dependencyRecords[0], expectedStage);
    }
    throw new Error(`Missing required ${expectedStage} dependency`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple ${expectedStage} dependencies found`);
  }

  return validateDependencyRecord<TOutput>(matches[0], expectedStage);
}

function requireAcceptedPlan(output: PlanOutput): Extract<PlanResult, { status: 'success' }> {
  if (output.status !== 'success' || output.plan.status !== 'success') {
    throw new Error('accepted plan output is required');
  }
  return output.plan;
}

function requirePassedQuality(output: DevelopOutput): QualityGateResult & { status: 'passed' } {
  if (output.status !== 'success' || output.quality.status !== 'passed') {
    throw new Error('review input quality.status must be passed');
  }
  return output.quality as QualityGateResult & { status: 'passed' };
}

function requireFailedReviewOutput(record: HandoffRecord, output: ReviewOutput): ReviewResult & { status: 'failed' } {
  if (record.toStage !== 'develop' || record.status !== 'rework-needed') {
    throw new Error('review rework input must be a rework-needed handoff to develop');
  }
  if (output.status !== 'review-failed' || output.review.status !== 'failed') {
    throw new Error('review rework input requires review-failed output');
  }
  return output.review;
}

export async function resolveAssessContext(payload: AssessJobData): Promise<AssessContext> {
  stagePayloadSchemas.assess.parse(payload);
  const [runContext, inputRecord] = await Promise.all([
    readStableRunContext(payload),
    readValidatedStageInputRecord(payload),
  ]);
  ensureInputStage(inputRecord, 'prepare-run');
  const prepareRun = parseStageOutput('prepare-run', inputRecord.output);
  return { runContext, prepareRun, inputRecord };
}

export async function resolvePlanContext(payload: PlanJobData): Promise<PlanContext> {
  stagePayloadSchemas.plan.parse(payload);
  const [runContext, inputRecord] = await Promise.all([
    readStableRunContext(payload),
    readValidatedStageInputRecord(payload),
  ]);
  if (inputRecord.fromStage === 'assess') {
    const output = parseStageOutput('assess', inputRecord.output) as AssessOutput;
    return {
      runContext,
      inputKind: 'assess',
      assessment: output.assessment,
      inputRecord: inputRecord as HandoffRecord<AssessOutput>,
    };
  }

  if (inputRecord.fromStage === 'prepare-run') {
    parseStageOutput('prepare-run', inputRecord.output) as PrepareRunOutput;
    const prReworkRecord = await loadRequiredDependencyRecord<PrReworkIntakeOutput>(
      payload.inputRecordRef,
      inputRecord,
      'pr-rework-intake'
    );
    const prReworkOutput = parseStageOutput('pr-rework-intake', prReworkRecord.output) as PrReworkIntakeOutput;
    if (prReworkOutput.status !== 'rework-needed' || prReworkOutput.selectedNextStage !== 'plan') {
      throw new Error('Plan rework input requires a pr-rework-intake route to plan');
    }
    const latestPlanRecord = await loadDependencyRecord<PlanOutput>(
      payload.inputRecordRef,
      prReworkOutput.latestPlanRecordId,
      'plan'
    );
    const latestPlanOutput = parseStageOutput('plan', latestPlanRecord.output) as PlanOutput;
    return {
      runContext,
      inputKind: 'pr-rework',
      inputRecord: inputRecord as HandoffRecord<PrepareRunOutput>,
      prReworkRecord,
      latestPlanRecord,
      latestPlan: requireAcceptedPlan(latestPlanOutput),
      commentsMarkdown: prReworkOutput.commentsMarkdown,
    };
  }

  throw new Error(`plan input record expected stage assess or prepare-run but found ${inputRecord.fromStage}`);
}

export async function resolveDevelopContext(payload: DevelopJobData): Promise<DevelopContext> {
  stagePayloadSchemas.develop.parse(payload);
  const [runContext, inputRecord] = await Promise.all([
    readStableRunContext(payload),
    readValidatedStageInputRecord(payload),
  ]);
  if (inputRecord.fromStage === 'plan') {
    const output = parseStageOutput('plan', inputRecord.output) as PlanOutput;
    return {
      runContext,
      inputKind: 'plan',
      plan: requireAcceptedPlan(output),
      inputRecord: inputRecord as HandoffRecord<PlanOutput>,
      planRecord: inputRecord as HandoffRecord<PlanOutput>,
    };
  }

  if (inputRecord.fromStage === 'review') {
    const output = parseStageOutput('review', inputRecord.output) as ReviewOutput;
    const review = requireFailedReviewOutput(inputRecord, output);
    const planRecord = await loadRequiredDependencyRecord<PlanOutput>(
      payload.inputRecordRef,
      inputRecord,
      'plan'
    );
    const planOutput = parseStageOutput('plan', planRecord.output) as PlanOutput;
    return {
      runContext,
      inputKind: 'review-rework',
      plan: requireAcceptedPlan(planOutput),
      reviewFailureContent: review.content,
      inputRecord: inputRecord as HandoffRecord<ReviewOutput>,
      planRecord,
    };
  }

  if (inputRecord.fromStage === 'prepare-run') {
    parseStageOutput('prepare-run', inputRecord.output) as PrepareRunOutput;
    const prReworkRecord = await loadRequiredDependencyRecord<PrReworkIntakeOutput>(
      payload.inputRecordRef,
      inputRecord,
      'pr-rework-intake'
    );
    const prReworkOutput = parseStageOutput('pr-rework-intake', prReworkRecord.output) as PrReworkIntakeOutput;
    if (prReworkOutput.status !== 'rework-needed' || prReworkOutput.selectedNextStage !== 'develop') {
      throw new Error('Direct Develop rework input requires a pr-rework-intake route to develop');
    }
    const planRecord = await loadDependencyRecord<PlanOutput>(
      payload.inputRecordRef,
      prReworkOutput.latestPlanRecordId,
      'plan'
    );
    const planOutput = parseStageOutput('plan', planRecord.output) as PlanOutput;
    return {
      runContext,
      inputKind: 'human-pr-rework',
      plan: requireAcceptedPlan(planOutput),
      reviewFailureContent: prReworkOutput.commentsMarkdown,
      inputRecord: inputRecord as HandoffRecord<PrepareRunOutput>,
      prReworkRecord,
      planRecord,
    };
  }

  throw new Error(`develop input record expected stage plan, review, or prepare-run but found ${inputRecord.fromStage}`);
}

export async function resolveReviewContext(payload: ReviewJobData): Promise<ReviewContext> {
  stagePayloadSchemas.review.parse(payload);
  const [runContext, inputRecord] = await Promise.all([
    readStableRunContext(payload),
    readValidatedStageInputRecord(payload),
  ]);
  ensureInputStage(inputRecord, 'develop');
  const output = parseStageOutput('develop', inputRecord.output) as DevelopOutput;
  const planRecord = await loadRequiredDependencyRecord<PlanOutput>(
    payload.inputRecordRef,
    inputRecord,
    'plan'
  );
  const planOutput = parseStageOutput('plan', planRecord.output) as PlanOutput;
  return {
    runContext,
    plan: requireAcceptedPlan(planOutput),
    development: output.development,
    quality: requirePassedQuality(output),
    inputRecord: inputRecord as HandoffRecord<DevelopOutput>,
    planRecord,
  };
}

export async function resolveMakePrContext(payload: MakePrJobData): Promise<MakePrContext> {
  stagePayloadSchemas['make-pr'].parse(payload);
  const [runContext, inputRecord] = await Promise.all([
    readStableRunContext(payload),
    readValidatedStageInputRecord(payload),
  ]);
  ensureInputStage(inputRecord, 'review');
  const reviewOutput = parseStageOutput('review', inputRecord.output) as ReviewOutput;
  if (reviewOutput.status !== 'success' || reviewOutput.review.status !== 'passed') {
    throw new Error('Make PR requires a passed Review input record');
  }
  const developRecord = await loadRequiredDependencyRecord<DevelopOutput>(
    payload.inputRecordRef,
    inputRecord,
    'develop'
  );
  const planRecord = await loadRequiredDependencyRecord<PlanOutput>(
    payload.inputRecordRef,
    inputRecord,
    'plan'
  );
  const developOutput = parseStageOutput('develop', developRecord.output) as DevelopOutput;
  const planOutput = parseStageOutput('plan', planRecord.output) as PlanOutput;
  return {
    runContext,
    plan: requireAcceptedPlan(planOutput),
    development: developOutput.development,
    quality: requirePassedQuality(developOutput),
    review: reviewOutput.review,
    inputRecord: inputRecord as HandoffRecord<ReviewOutput>,
    developRecord,
    planRecord,
  };
}

export async function resolveSyncTrackerStateContext(
  payload: SyncTrackerStateJobData
): Promise<SyncTrackerStateContext> {
  stagePayloadSchemas['sync-tracker-state'].parse(payload);
  const [runContext, inputRecord] = await Promise.all([
    readStableRunContext(payload),
    readValidatedStageInputRecord(payload),
  ]);
  ensureInputStage(inputRecord, 'make-pr');
  const output = parseStageOutput('make-pr', inputRecord.output) as PullRequestOutput;
  if (output.status !== 'pull-request-created') {
    throw new Error('Sync Tracker State requires a pull-request-created input record');
  }
  return {
    runContext,
    pullRequest: output.pullRequest,
    inputRecord: inputRecord as HandoffRecord<PullRequestOutput>,
  };
}
