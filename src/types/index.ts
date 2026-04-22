// Shared TypeScript interfaces for Agent Orchestrator
/* istanbul ignore file */
// This file contains only TypeScript type definitions with no runtime code

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

// GitHub webhook types
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

// Job data types for issue processing
export interface IssueProcessorJobData extends JobPayload {
  type: 'issue-processor';
  issue: GitHubIssue;
}

export interface IssueWatcherJobData extends JobPayload {
  type: 'issue-watcher';
  lastPollTimestamp?: string;
}

export interface CodexProviderJobData extends JobPayload {
  type: 'codex-provider';
  issue: GitHubIssue;
  branchName: string;
}
