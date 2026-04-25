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
export type StageName = 'issue-processor' | 'plan' | 'codex-provider' | 'review' | 'make-pr' | 'check-pr' | string;
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
export interface GitHubRepo {
    owner: string;
    repo: string;
    addedAt: string;
}
export interface RepoListResponse {
    repos: GitHubRepo[];
    total: number;
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
    issueStrategy: 'polling' | 'webhook';
    pollIntervalMs: number;
    webhookSecret?: string;
}
export interface CodexConfig {
    cliPath: string;
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
export interface GitHubWebhookEvent {
    action: string;
    issue: GitHubIssue;
    repository: {
        id: number;
        name: string;
        fullName: string;
    };
    sender: {
        login: string;
    };
}
export interface GitHubIssueEventPayload {
    action: 'opened' | 'closed' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'synchronize';
    issue: GitHubIssue;
}
export interface IssueProcessorJobData extends JobPayload {
    type: 'issue-processor';
    issue: GitHubIssue;
}
export interface IssueWatcherJobData extends JobPayload {
    type: 'issue-watcher';
    lastPollTimestamp?: string;
    owner?: string;
    repo?: string;
}
export interface RepoWatcherJobData extends JobPayload {
    type: 'repo-watcher';
}
export interface CodexProviderJobData extends JobPayload {
    type: 'codex-provider';
    issue: GitHubIssue;
    branchName: string;
}
export interface PlanJobData extends JobPayload {
    type: 'plan';
    issue: GitHubIssue;
    branchName: string;
}
export interface ReviewJobData extends JobPayload {
    type: 'review';
    issue: GitHubIssue;
    branchName: string;
    repoPath: string;
}
export interface MakePrJobData extends JobPayload {
    type: 'make-pr';
    issue: GitHubIssue;
    branchName: string;
    repoPath: string;
}
export interface CheckPrJobData extends JobPayload {
    type: 'check-pr';
    issue: GitHubIssue;
    branchName: string;
    repoPath: string;
    pullRequest: PullRequestResponse;
}
