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
}
export interface GitHubConfig {
    token: string;
    owner: string;
    repo: string;
}
export interface AppConfig {
    env: string;
    port: number;
    redis: RedisConfig;
    github: GitHubConfig;
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
