import { describe, it, expect } from 'vitest';
import type {
  TaskData,
  TaskStatus,
  TaskResult,
  PipelineStage,
  StageResult,
  AgentConfig,
  AgentResult,
  GitHubIssue,
  GitHubComment,
  GitHubRepo,
  RepoListResponse,
  AppConfig,
  RedisConfig,
  GitHubConfig,
  ServerOptions,
  HealthResponse,
  JobPayload,
  GitHubWebhookEvent,
  GitHubIssueEventPayload,
  IssueProcessorJobData,
  IssueWatcherJobData,
  RepoWatcherJobData,
  CodexProviderJobData,
} from './index.js';

describe('types', () => {
  describe('TaskData', () => {
    it('should accept valid task data', () => {
      const task: TaskData = {
        taskId: 'task-123',
        type: 'analyze',
        payload: { key: 'value' },
      };
      expect(task.taskId).toBe('task-123');
      expect(task.type).toBe('analyze');
      expect(task.payload).toEqual({ key: 'value' });
    });

    it('should allow optional payload', () => {
      const task: TaskData = {
        taskId: 'task-123',
        type: 'analyze',
      };
      expect(task.payload).toBeUndefined();
    });
  });

  describe('TaskStatus', () => {
    it('should accept all valid statuses', () => {
      const statuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'failed'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('TaskResult', () => {
    it('should accept valid task result', () => {
      const result: TaskResult = {
        taskId: 'task-123',
        status: 'completed',
        result: { output: 'done' },
        completedAt: '2024-01-01T00:00:00.000Z',
      };
      expect(result.status).toBe('completed');
      expect(result.result).toEqual({ output: 'done' });
    });

    it('should allow error status with error message', () => {
      const result: TaskResult = {
        taskId: 'task-123',
        status: 'failed',
        error: 'Something went wrong',
      };
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Something went wrong');
    });
  });

  describe('PipelineStage', () => {
    it('should accept all valid stages', () => {
      const stages: PipelineStage[] = ['fetch', 'analyze', 'execute', 'report'];
      expect(stages).toHaveLength(4);
    });
  });

  describe('StageResult', () => {
    it('should accept valid stage result', () => {
      const result: StageResult = {
        stage: 'fetch',
        success: true,
        data: { issues: [] },
        durationMs: 100,
      };
      expect(result.stage).toBe('fetch');
      expect(result.success).toBe(true);
      expect(result.durationMs).toBe(100);
    });
  });

  describe('AgentConfig', () => {
    it('should accept valid agent config', () => {
      const config: AgentConfig = {
        name: 'test-agent',
        enabled: true,
        maxRetries: 3,
        timeoutMs: 5000,
      };
      expect(config.name).toBe('test-agent');
      expect(config.enabled).toBe(true);
    });
  });

  describe('AgentResult', () => {
    it('should accept valid agent result', () => {
      const result: AgentResult = {
        agentName: 'test-agent',
        success: true,
        output: 'processed',
        durationMs: 200,
      };
      expect(result.agentName).toBe('test-agent');
      expect(result.success).toBe(true);
    });
  });

  describe('GitHubIssue', () => {
    it('should accept valid GitHub issue', () => {
      const issue: GitHubIssue = {
        id: 1,
        number: 42,
        title: 'Test issue',
        body: 'Issue body',
        state: 'open',
        labels: ['bug', 'priority'],
        assignee: 'username',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      };
      expect(issue.number).toBe(42);
      expect(issue.state).toBe('open');
      expect(issue.labels).toHaveLength(2);
    });

    it('should allow null body', () => {
      const issue: GitHubIssue = {
        id: 1,
        number: 42,
        title: 'Test issue',
        body: null,
        state: 'open',
        labels: [],
        assignee: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      };
      expect(issue.body).toBeNull();
      expect(issue.assignee).toBeNull();
    });
  });

  describe('GitHubComment', () => {
    it('should accept valid GitHub comment', () => {
      const comment: GitHubComment = {
        id: 1,
        body: 'Comment body',
        user: 'username',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(comment.body).toBe('Comment body');
    });
  });

  describe('GitHubRepo', () => {
    it('should accept valid GitHub repo', () => {
      const repo: GitHubRepo = {
        owner: 'owner',
        repo: 'repo',
        addedAt: '2024-01-01T00:00:00.000Z',
      };
      expect(repo.owner).toBe('owner');
      expect(repo.repo).toBe('repo');
      expect(repo.addedAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should store repo with all required fields', () => {
      const repo: GitHubRepo = {
        owner: 'my-org',
        repo: 'my-repo',
        addedAt: '2024-06-15T10:30:00.000Z',
      };
      expect(repo.owner).toBe('my-org');
      expect(repo.repo).toBe('my-repo');
    });
  });

  describe('RepoListResponse', () => {
    it('should accept valid repo list response', () => {
      const response: RepoListResponse = {
        repos: [
          {
            owner: 'owner1',
            repo: 'repo1',
            addedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            owner: 'owner2',
            repo: 'repo2',
            addedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
        total: 2,
      };
      expect(response.repos).toHaveLength(2);
      expect(response.total).toBe(2);
    });

    it('should allow empty repos list', () => {
      const response: RepoListResponse = {
        repos: [],
        total: 0,
      };
      expect(response.repos).toHaveLength(0);
      expect(response.total).toBe(0);
    });
  });

  describe('AppConfig', () => {
    it('should accept valid app config', () => {
      const config: AppConfig = {
        env: 'production',
        port: 8080,
        redis: {
          host: 'redis.example.com',
          port: 6379,
        },
        github: {
          token: 'ghp_token',
          owner: 'owner',
          repo: 'repo',
        },
      };
      expect(config.env).toBe('production');
      expect(config.redis.host).toBe('redis.example.com');
      expect(config.github.token).toBe('ghp_token');
    });
  });

  describe('RedisConfig', () => {
    it('should accept valid redis config', () => {
      const config: RedisConfig = {
        host: 'localhost',
        port: 6379,
      };
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
    });
  });

  describe('GitHubConfig', () => {
    it('should accept valid github config', () => {
      const config: GitHubConfig = {
        token: 'token',
        owner: 'owner',
        repo: 'repo',
      };
      expect(config.token).toBe('token');
    });
  });

  describe('ServerOptions', () => {
    it('should accept valid server options', () => {
      const options: ServerOptions = {
        logger: true,
      };
      expect(options.logger).toBe(true);
    });

    it('should allow optional logger', () => {
      const options: ServerOptions = {};
      expect(options.logger).toBeUndefined();
    });
  });

  describe('HealthResponse', () => {
    it('should accept valid health response', () => {
      const response: HealthResponse = {
        status: 'ok',
        timestamp: '2024-01-01T00:00:00.000Z',
        uptime: 3600,
      };
      expect(response.status).toBe('ok');
      expect(response.uptime).toBe(3600);
    });
  });

  describe('JobPayload', () => {
    it('should accept valid job payload', () => {
      const payload: JobPayload = {
        taskId: 'task-123',
        type: 'process',
        payload: { data: 'value' },
      };
      expect(payload.taskId).toBe('task-123');
      expect(payload.type).toBe('process');
    });
  });

  describe('GitHubWebhookEvent', () => {
    it('should accept valid webhook event', () => {
      const event: GitHubWebhookEvent = {
        action: 'opened',
        issue: {
          id: 1,
          number: 42,
          title: 'Test issue',
          body: 'Issue body',
          state: 'open',
          labels: ['bug'],
          assignee: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        repository: {
          id: 123,
          name: 'test-repo',
          fullName: 'owner/test-repo',
        },
        sender: {
          login: 'username',
        },
      };
      expect(event.action).toBe('opened');
      expect(event.issue.number).toBe(42);
      expect(event.repository.fullName).toBe('owner/test-repo');
    });
  });

  describe('GitHubIssueEventPayload', () => {
    it('should accept valid issue event payload', () => {
      const payload: GitHubIssueEventPayload = {
        action: 'opened',
        issue: {
          id: 1,
          number: 42,
          title: 'Test issue',
          body: 'Issue body',
          state: 'open',
          labels: [],
          assignee: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      };
      expect(payload.action).toBe('opened');
      expect(payload.issue.title).toBe('Test issue');
    });

    it('should accept closed action', () => {
      const payload: GitHubIssueEventPayload = {
        action: 'closed',
        issue: {
          id: 1,
          number: 42,
          title: 'Test issue',
          body: null,
          state: 'closed',
          labels: [],
          assignee: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      };
      expect(payload.action).toBe('closed');
      expect(payload.issue.state).toBe('closed');
    });
  });

  describe('IssueProcessorJobData', () => {
    it('should accept valid issue processor job data', () => {
      const jobData: IssueProcessorJobData = {
        taskId: 'task-123',
        type: 'issue-processor',
        issue: {
          id: 1,
          number: 42,
          title: 'Test issue',
          body: 'Issue body',
          state: 'open',
          labels: ['enhancement'],
          assignee: 'user',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      };
      expect(jobData.taskId).toBe('task-123');
      expect(jobData.type).toBe('issue-processor');
      expect(jobData.issue.number).toBe(42);
    });

    it('should allow optional payload', () => {
      const jobData: IssueProcessorJobData = {
        taskId: 'task-123',
        type: 'issue-processor',
        issue: {
          id: 1,
          number: 42,
          title: 'Test issue',
          body: null,
          state: 'open',
          labels: [],
          assignee: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      };
      expect(jobData.payload).toBeUndefined();
    });
  });

  describe('IssueWatcherJobData', () => {
    it('should accept valid issue watcher job data', () => {
      const jobData: IssueWatcherJobData = {
        taskId: 'task-456',
        type: 'issue-watcher',
        lastPollTimestamp: '2024-01-01T00:00:00.000Z',
      };
      expect(jobData.taskId).toBe('task-456');
      expect(jobData.type).toBe('issue-watcher');
      expect(jobData.lastPollTimestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should allow optional lastPollTimestamp', () => {
      const jobData: IssueWatcherJobData = {
        taskId: 'task-456',
        type: 'issue-watcher',
      };
      expect(jobData.lastPollTimestamp).toBeUndefined();
    });

    it('should accept optional owner and repo for targeted polling', () => {
      const jobData: IssueWatcherJobData = {
        taskId: 'task-456',
        type: 'issue-watcher',
        owner: 'my-org',
        repo: 'my-repo',
      };
      expect(jobData.owner).toBe('my-org');
      expect(jobData.repo).toBe('my-repo');
    });

    it('should allow owner without repo and vice versa', () => {
      const jobDataWithOwner: IssueWatcherJobData = {
        taskId: 'task-456',
        type: 'issue-watcher',
        owner: 'my-org',
      };
      expect(jobDataWithOwner.owner).toBe('my-org');
      expect(jobDataWithOwner.repo).toBeUndefined();

      const jobDataWithRepo: IssueWatcherJobData = {
        taskId: 'task-456',
        type: 'issue-watcher',
        repo: 'my-repo',
      };
      expect(jobDataWithRepo.owner).toBeUndefined();
      expect(jobDataWithRepo.repo).toBe('my-repo');
    });
  });

  describe('RepoWatcherJobData', () => {
    it('should accept valid repo watcher job data', () => {
      const jobData: RepoWatcherJobData = {
        taskId: 'task-789',
        type: 'repo-watcher',
      };
      expect(jobData.taskId).toBe('task-789');
      expect(jobData.type).toBe('repo-watcher');
    });

    it('should allow optional payload', () => {
      const jobData: RepoWatcherJobData = {
        taskId: 'task-789',
        type: 'repo-watcher',
        payload: { key: 'value' },
      };
      expect(jobData.payload).toEqual({ key: 'value' });
    });
  });

  describe('CodexProviderJobData', () => {
    it('should accept valid codex provider job data', () => {
      const jobData: CodexProviderJobData = {
        taskId: 'task-789',
        type: 'codex-provider',
        issue: {
          id: 1,
          number: 42,
          title: 'Test issue',
          body: 'Issue body',
          state: 'open',
          labels: ['enhancement'],
          assignee: 'user',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        branchName: 'feature/codex-42',
      };
      expect(jobData.taskId).toBe('task-789');
      expect(jobData.type).toBe('codex-provider');
      expect(jobData.issue.number).toBe(42);
      expect(jobData.branchName).toBe('feature/codex-42');
    });

    it('should allow optional payload', () => {
      const jobData: CodexProviderJobData = {
        taskId: 'task-789',
        type: 'codex-provider',
        issue: {
          id: 1,
          number: 42,
          title: 'Test issue',
          body: null,
          state: 'open',
          labels: [],
          assignee: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        branchName: 'feature/codex-42',
      };
      expect(jobData.payload).toBeUndefined();
    });
  });
});
