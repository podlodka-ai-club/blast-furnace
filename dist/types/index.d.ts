import type { PullRequestResponse } from '../github/pullRequests.js';
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
export type PipelineStage = 'fetch' | 'analyze' | 'execute' | 'report';
export interface StageResult {
    stage: PipelineStage;
    success: boolean;
    data?: unknown;
    error?: string;
    durationMs?: number;
}
export type RunId = string;
export declare const WORKFLOW_STAGES: readonly ["intake", "prepare-run", "assess", "plan", "develop", "review", "make-pr", "sync-tracker-state"];
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
export interface HandoffRecordDependency {
    recordId: string;
    sequence: number;
    stage: WorkflowStage;
}
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
    dependsOn: HandoffRecordDependency | null;
    status: HandoffStatus;
    output: TOutput;
    nextInput: StageJobPayload | null;
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
    stages: Record<string, RunStageSummary>;
    createdAt?: string;
    updatedAt?: string;
}
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
export interface AppConfig {
    env: string;
    port: number;
    redis: RedisConfig;
    github: GitHubConfig;
    codex: CodexConfig;
    qualityGate: QualityGateConfig;
}
export interface ServerOptions {
    logger?: boolean;
}
export interface HealthResponse {
    status: 'ok';
    timestamp: string;
    uptime?: number;
}
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
export interface StageHandoffJobPayload<TStage extends Exclude<WorkflowStage, 'intake' | 'prepare-run'>> extends StageJobPayload<TStage> {
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
export interface PlanResult {
    status: 'stubbed';
    summary: string;
}
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
export interface ReviewResult {
    status: 'stubbed';
    summary: string;
}
export interface PrepareRunOutput extends PreparedRunFields {
    status: 'success';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
}
export interface AssessOutput extends PreparedRunFields {
    status: 'success';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    assessment: AssessmentResult;
}
export interface PlanOutput extends PreparedRunFields {
    status: 'success';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    assessment: AssessmentResult;
    plan: PlanResult;
}
export interface DevelopOutput extends PreparedRunFields {
    status: 'success' | 'quality-failed' | 'quality-timed-out' | 'quality-misconfigured';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    assessment: AssessmentResult;
    plan: PlanResult;
    development: DevelopmentResult;
    quality: QualityGateResult;
}
export interface ReviewOutput extends PreparedRunFields {
    status: 'success';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    assessment: AssessmentResult;
    plan: PlanResult;
    development: DevelopmentResult;
    quality: QualityGateResult;
    review: ReviewResult;
}
export interface PullRequestOutput extends PreparedRunFields {
    status: 'pull-request-created';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    development: DevelopmentResult;
    quality: QualityGateResult;
    review: ReviewResult;
    pullRequest: PullRequestResponse;
}
export interface NoChangeOutput extends PreparedRunFields {
    status: 'no-changes';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    development: DevelopmentResult;
    quality: QualityGateResult;
    review: ReviewResult;
}
export type MakePrOutput = PullRequestOutput | NoChangeOutput;
export interface SyncTrackerStateOutput extends PreparedRunFields {
    status: 'tracker-synced';
    runId: RunId;
    stageAttempt: number;
    reworkAttempt: number;
    pullRequest: PullRequestResponse;
    trackerLabels: string[];
}
export interface IntakeJobData extends StageJobPayload<'intake'> {
    lastPollTimestamp?: string;
    owner?: string;
    repo?: string;
}
export interface PrepareRunJobData extends StageJobPayload<'prepare-run'> {
    issue: GitHubIssue;
    repository: RepositoryIdentity;
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
