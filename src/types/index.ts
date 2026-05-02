// Shared TypeScript interfaces for Agent Orchestrator
/* istanbul ignore file */
// This file contains only TypeScript type definitions with no runtime code

import type { PullRequestResponse } from '../github/pullRequests.js';

// Task types
export interface TaskData {
  taskId: string;
  type: string;
  payload?: Record<string, unknown>;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  completedAt?: string;
}

// Pipeline types
export type PipelineStage = 'fetch' | 'analyze' | 'execute' | 'report';

export interface StageResult {
  stage: PipelineStage;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

// Orchestration infrastructure types
export type RunId = string;
export const WORKFLOW_STAGES = [
  'intake',
  'prepare-run',
  'assess',
  'plan',
  'develop',
  'review',
  'make-pr',
  'sync-tracker-state',
  'pr-rework-intake',
] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export type StageName = WorkflowStage;
export type AttemptNumber = number;

export interface StageAttemptLocation {
  runId: RunId;
  stageName: StageName;
  attempt: AttemptNumber;
}

export interface ArtifactLocation extends StageAttemptLocation {
  artifactName: string;
}

export interface ArtifactMetadata extends ArtifactLocation {
  path: string;
  createdAt: string;
}

export interface EventMetadata {
  runId: RunId;
  eventName: string;
  path: string;
  createdAt: string;
}

export interface RunStageSummary {
  attempts: number;
  status: string;
  updatedAt?: string;
}

export interface RunFileSet {
  runId: RunId;
  timestampPrefix: string;
  runDirectory: string;
  runSummaryPath: string;
  handoffLedgerPath: string;
}

export interface InputRecordRef {
  runDir: string;
  handoffPath: string;
  recordId: string;
  sequence: number;
  stage: WorkflowStage;
}

export type HandoffRecordDependency = string;

export type HandoffStatus = 'success' | 'failure' | 'blocked' | 'clarify' | 'rework-needed';

export interface HandoffRecord<TOutput = unknown> {
  recordId: string;
  sequence: number;
  runId: RunId;
  createdAt: string;
  fromStage: WorkflowStage;
  toStage: WorkflowStage | null;
  stageAttempt: number;
  reworkAttempt: number;
  dependsOn: HandoffRecordDependency[];
  status: HandoffStatus;
  output: TOutput;
}

export interface StableRunContext {
  issue: GitHubIssue;
  repository: RepositoryIdentity;
  branchName: string;
  workspacePath: string;
}

export interface InitialRunContext {
  issue: GitHubIssue;
  repository: RepositoryIdentity;
}

export type TrackerCommentKind = 'orchestrator-status' | 'orchestrator-plan' | 'orchestrator-rework-start';
export type TrackerProvider = 'github' | string;
export type StatusItemState = 'pending' | 'in-progress' | 'completed' | 'retrying' | 'blocked' | 'failed' | 'skipped';
// Tracker presentation row kind. Workflow routing must use WorkflowStage, queue payloads, and handoff records.
export type StatusItemStage =
  | 'task-pickup'
  | 'human-review'
  | 'prepare-run'
  | 'assess'
  | 'plan'
  | 'develop'
  | 'quality-gate'
  | 'review'
  | 'review-feedback-loop'
  | 'draft-pr-and-in-review';

export interface StatusChecklistItem {
  id: string;
  stage: StatusItemStage;
  attempt: number;
  reworkAttempt?: number;
  state: StatusItemState;
  label: string;
  detail?: string;
}

export interface RunStatusMetadata {
  provider: TrackerProvider;
  kind: TrackerCommentKind;
  externalId?: string;
  checklist: StatusChecklistItem[];
  pickedUpAt: string;
  lastChangedAt: string;
  heading?: string;
  focus?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunSummaryData {
  runId: RunId;
  status: string;
  currentStage?: WorkflowStage | null;
  runStartedAt?: string;
  timestampPrefix?: string;
  runDirectory?: string;
  runSummaryPath?: string;
  handoffLedgerPath?: string;
  stageAttempt?: number;
  reworkAttempt?: number;
  latestHandoffRecord?: InputRecordRef | null;
  pendingNextStage?: PendingNextStage | null;
  prReworkIntakeInProgress?: PrReworkIntakeInProgress | null;
  initialContext?: InitialRunContext;
  stableContext?: StableRunContext;
  trackerStatus?: RunStatusMetadata;
  stages: Record<string, RunStageSummary>;
  createdAt?: string;
  updatedAt?: string;
}

export interface PendingNextStage {
  stage: WorkflowStage;
  inputRecordRef: InputRecordRef;
  stageAttempt: number;
  reworkAttempt: number;
}

export interface PrReworkIntakeInProgress {
  action: string;
  inputRecordId: string;
}

// Agent types
export interface AgentConfig {
  name: string;
  enabled: boolean;
  maxRetries: number;
  timeoutMs: number;
}

export interface AgentResult {
  agentName: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

// GitHub types
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: string[];
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: string;
  createdAt: string;
}

// Config types
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  pollIntervalMs: number;
}

export interface CodexConfig {
  cliPath: string;
  model: string;
  timeoutMs: number;
}

export interface QualityGateConfig {
  testCommand?: string;
  testTimeoutMs: number;
}

export interface ReviewConfig {
  attemptLimit: number;
}

export interface ReworkConfig {
  maxHumanReworkAttempts: number;
}

export interface AppConfig {
  env: string;
  port: number;
  redis: RedisConfig;
  github: GitHubConfig;
  codex: CodexConfig;
  qualityGate: QualityGateConfig;
  review: ReviewConfig;
  rework: ReworkConfig;
}

// Server types
export interface ServerOptions {
  logger?: boolean;
}

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
  uptime?: number;
}

// Job types (for BullMQ)
export interface JobPayload {
  taskId: string;
  type: string;
  payload?: Record<string, unknown>;
}

export interface StageJobPayload<TStage extends WorkflowStage = WorkflowStage> extends JobPayload {
  type: TStage;
  runId: RunId;
  stage: TStage;
  stageAttempt: number;
  reworkAttempt: number;
}

export interface StageHandoffJobPayload<TStage extends Exclude<WorkflowStage, 'intake' | 'prepare-run'>>
  extends StageJobPayload<TStage> {
  inputRecordRef: InputRecordRef;
}

export interface RepositoryIdentity {
  owner: string;
  repo: string;
}

export interface AssessmentResult {
  status: 'stubbed';
  summary: string;
}

export interface SuccessfulPlanResult {
  status: 'success';
  summary: string;
  content: string;
}

export interface ValidationFailedPlanResult {
  status: 'validation-failed';
  summary: string;
  content: string;
  failureReason: string;
}

export type PlanResult = SuccessfulPlanResult | ValidationFailedPlanResult;

export interface DevelopmentResult {
  status: 'completed';
  summary: string;
}

export type QualityGateStatus = 'passed' | 'failed' | 'misconfigured' | 'timed-out';

export interface QualityGateResult {
  status: QualityGateStatus;
  command: string;
  exitCode?: number;
  attempts: number;
  durationMs: number;
  summary: string;
  outputPath?: string;
}

export type ReviewOutputStatus = 'success' | 'review-failed' | 'review-malformed' | 'review-exhausted';

export type ReviewResult =
  | {
    status: 'passed';
    summary: 'Review Success';
  }
  | {
    status: 'failed';
    summary: string;
    content: string;
  }
  | {
    status: 'malformed';
    summary: string;
    rawResponse: string;
  }
  | {
    status: 'exhausted';
    summary: string;
    content: string;
  };

export interface PrepareRunOutput {
  status: 'success';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
}

export interface AssessOutput {
  status: 'success';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  assessment: AssessmentResult;
}

export interface PlanOutput {
  status: 'success' | 'validation-failed';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  plan: PlanResult;
}

export interface DevelopOutput {
  status: 'success' | 'quality-failed' | 'quality-timed-out' | 'quality-misconfigured';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  development: DevelopmentResult;
  quality: QualityGateResult;
}

export interface ReviewOutput {
  status: ReviewOutputStatus;
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  review: ReviewResult;
}

export interface PullRequestOutput {
  status: 'pull-request-created';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  pullRequest: PullRequestResponse;
}

export interface NoChangeOutput {
  status: 'no-changes';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  pullRequest?: PullRequestIdentity;
}

export interface PullRequestCreationFailureOutput {
  status: 'pull-request-already-exists' | 'pull-request-creation-failed';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  errorMessage: string;
}

export type MakePrOutput = PullRequestOutput | NoChangeOutput | PullRequestCreationFailureOutput;

export interface SyncTrackerStateOutput {
  status: 'tracker-synced';
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  trackerLabels: string[];
  trackerWarning?: string;
}

export interface PullRequestIdentity {
  number: number;
  htmlUrl: string;
}

export interface PullRequestHeadIdentity extends RepositoryIdentity {
  branch: string;
  sha: string;
}

export type PrReworkIntakeOutput =
  | {
    status: 'rework-needed';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    pullRequest: PullRequestIdentity;
    commentsMarkdown: string;
    routeAnalysis: string;
    selectedNextStage: 'plan' | 'develop';
    pullRequestHead: PullRequestHeadIdentity;
    latestPlanRecordId: string;
  }
  | {
    status: 'pull-request-merged' | 'pull-request-closed-without-merge' | 'no-comments-found';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    pullRequest: PullRequestIdentity;
  }
  | {
    status: 'too-many-reworks';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    pullRequest: PullRequestIdentity;
    commentsMarkdown?: string;
  };

// Job data types for the target workflow stages
export interface IntakeJobData extends StageJobPayload<'intake'> {
  lastPollTimestamp?: string;
  owner?: string;
  repo?: string;
}

export interface PrepareRunJobData extends StageJobPayload<'prepare-run'> {
  issue: GitHubIssue;
  repository: RepositoryIdentity;
  inputRecordRef?: InputRecordRef;
}

export interface PreparedRunFields {
  issue: GitHubIssue;
  repository: RepositoryIdentity;
  branchName: string;
  workspacePath: string;
}

export type AssessJobData = StageHandoffJobPayload<'assess'>;

export type PlanJobData = StageHandoffJobPayload<'plan'>;

export type DevelopJobData = StageHandoffJobPayload<'develop'>;

export type ReviewJobData = StageHandoffJobPayload<'review'>;

export type MakePrJobData = StageHandoffJobPayload<'make-pr'>;

export type SyncTrackerStateJobData = StageHandoffJobPayload<'sync-tracker-state'>;

export type PrReworkIntakeJobData = StageHandoffJobPayload<'pr-rework-intake'>;
