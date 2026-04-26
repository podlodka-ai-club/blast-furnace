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
export declare const WORKFLOW_STAGES: readonly ["intake", "prepare-run", "assess", "plan", "develop", "quality-gate", "review", "make-pr", "sync-tracker-state"];
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
export interface RunSummaryData {
    runId: RunId;
    status: string;
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
export interface AppConfig {
    env: string;
    port: number;
    redis: RedisConfig;
    github: GitHubConfig;
    codex: CodexConfig;
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
export interface QualityGateResult {
    status: 'passed';
    summary: string;
}
export interface ReviewResult {
    status: 'stubbed';
    summary: string;
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
export interface AssessJobData extends StageJobPayload<'assess'>, PreparedRunFields {
}
export interface PlanJobData extends StageJobPayload<'plan'>, PreparedRunFields {
    assessment: AssessmentResult;
}
export interface DevelopJobData extends StageJobPayload<'develop'>, PreparedRunFields {
    assessment: AssessmentResult;
    plan: PlanResult;
}
export interface QualityGateJobData extends StageJobPayload<'quality-gate'>, PreparedRunFields {
    assessment: AssessmentResult;
    plan: PlanResult;
    development: DevelopmentResult;
}
export interface ReviewJobData extends StageJobPayload<'review'>, PreparedRunFields {
    assessment: AssessmentResult;
    plan: PlanResult;
    development: DevelopmentResult;
    quality: QualityGateResult;
}
export interface MakePrJobData extends StageJobPayload<'make-pr'> {
    issue: GitHubIssue;
    repository: RepositoryIdentity;
    branchName: string;
    workspacePath: string;
    development: DevelopmentResult;
    quality: QualityGateResult;
    review: ReviewResult;
}
export interface SyncTrackerStateJobData extends StageJobPayload<'sync-tracker-state'> {
    issue: GitHubIssue;
    repository: RepositoryIdentity;
    branchName: string;
    workspacePath: string;
    pullRequest: PullRequestResponse;
}
