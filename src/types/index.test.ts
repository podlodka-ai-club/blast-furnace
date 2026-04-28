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
  AppConfig,
  RedisConfig,
  GitHubConfig,
  ServerOptions,
  HealthResponse,
  JobPayload,
  InputRecordRef,
  WorkflowStage,
  StageJobPayload,
  IntakeJobData,
  PrepareRunJobData,
  AssessJobData,
  DevelopJobData,
  SyncTrackerStateJobData,
  PlanJobData,
  ReviewJobData,
  MakePrJobData,
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
          owner: 'test-owner',
          repo: 'test-repo',
          pollIntervalMs: 60000,
        },
        codex: {
          cliPath: 'npx @openai/codex',
          model: 'gpt-5.4',
          timeoutMs: 300000,
        },
        qualityGate: {
          testCommand: 'npm test',
          testTimeoutMs: 180000,
        },
      };
      expect(config.env).toBe('production');
      expect(config.redis.host).toBe('redis.example.com');
      expect(config.github.token).toBe('ghp_token');
      expect(config.github).not.toHaveProperty('issueStrategy');
      expect(config.github).not.toHaveProperty('webhookSecret');
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
        owner: 'test-owner',
        repo: 'test-repo',
        pollIntervalMs: 60000,
      };
      expect(config.token).toBe('token');
      expect(config.pollIntervalMs).toBe(60000);
      expect(config).not.toHaveProperty('issueStrategy');
      expect(config).not.toHaveProperty('webhookSecret');
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

  describe('WorkflowStage', () => {
    it('should accept all target workflow stage names', () => {
      const stages: WorkflowStage[] = [
        'intake',
        'prepare-run',
        'assess',
        'plan',
        'develop',
        'review',
        'make-pr',
        'sync-tracker-state',
      ];

      expect(stages).toHaveLength(8);
      expect(stages).not.toContain('quality-gate');
    });
  });

  describe('StageJobPayload', () => {
    it('should require run identity, stage, stage attempt, and rework attempt fields', () => {
      const payload: StageJobPayload<'plan'> = {
        taskId: 'task-plan',
        type: 'plan',
        runId: 'run-123',
        stage: 'plan',
        stageAttempt: 1,
        reworkAttempt: 0,
      };

      expect(payload.runId).toBe('run-123');
      expect(payload.stage).toBe('plan');
      expect(payload.stageAttempt).toBe(1);
      expect(payload.reworkAttempt).toBe(0);
    });

    it('should include the stage envelope on every target stage job payload type', () => {
      const inputRecordRef: InputRecordRef = {
        runDir: '/opt/blast-furnace/.orchestrator/runs/2026-04-26_08.07_run-123',
        handoffPath: '/opt/blast-furnace/.orchestrator/runs/2026-04-26_08.07_run-123/2026-04-26_08.07_run-123_handoff.jsonl',
        recordId: '000001_prepare-run_to_assess',
        sequence: 1,
        stage: 'prepare-run',
      };
      const payloads: Array<StageJobPayload<WorkflowStage>> = [
        {
          taskId: 'task-intake',
          type: 'intake',
          runId: 'intake-run',
          stage: 'intake',
          stageAttempt: 1,
          reworkAttempt: 0,
        } satisfies IntakeJobData,
        {
          taskId: 'task-prepare',
          type: 'prepare-run',
          runId: 'run-123',
          stage: 'prepare-run',
          stageAttempt: 1,
          reworkAttempt: 0,
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
          repository: {
            owner: 'test-owner',
            repo: 'test-repo',
          },
        } satisfies PrepareRunJobData,
        {
          taskId: 'task-assess',
          type: 'assess',
          runId: 'run-123',
          stage: 'assess',
          stageAttempt: 1,
          reworkAttempt: 0,
          inputRecordRef,
        } satisfies AssessJobData,
        {
          taskId: 'task-plan',
          type: 'plan',
          runId: 'run-123',
          stage: 'plan',
          stageAttempt: 1,
          reworkAttempt: 0,
          inputRecordRef: {
            ...inputRecordRef,
            recordId: '000002_assess_to_plan',
            sequence: 2,
            stage: 'assess',
          },
        } satisfies PlanJobData,
        {
          taskId: 'task-develop',
          type: 'develop',
          runId: 'run-123',
          stage: 'develop',
          stageAttempt: 1,
          reworkAttempt: 0,
          inputRecordRef: {
            ...inputRecordRef,
            recordId: '000003_plan_to_develop',
            sequence: 3,
            stage: 'plan',
          },
        } satisfies DevelopJobData,
        {
          taskId: 'task-review',
          type: 'review',
          runId: 'run-123',
          stage: 'review',
          stageAttempt: 1,
          reworkAttempt: 0,
          inputRecordRef: {
            ...inputRecordRef,
            recordId: '000004_develop_to_review',
            sequence: 4,
            stage: 'develop',
          },
        } satisfies ReviewJobData,
        {
          taskId: 'task-make-pr',
          type: 'make-pr',
          runId: 'run-123',
          stage: 'make-pr',
          stageAttempt: 1,
          reworkAttempt: 0,
          inputRecordRef: {
            ...inputRecordRef,
            recordId: '000006_review_to_make-pr',
            sequence: 6,
            stage: 'review',
          },
        } satisfies MakePrJobData,
        {
          taskId: 'task-sync',
          type: 'sync-tracker-state',
          runId: 'run-123',
          stage: 'sync-tracker-state',
          stageAttempt: 1,
          reworkAttempt: 0,
          inputRecordRef: {
            ...inputRecordRef,
            recordId: '000007_make-pr_to_sync-tracker-state',
            sequence: 7,
            stage: 'make-pr',
          },
        } satisfies SyncTrackerStateJobData,
      ];

      expect(payloads.map((payload) => payload.stage)).toEqual([
        'intake',
        'prepare-run',
        'assess',
        'plan',
        'develop',
        'review',
        'make-pr',
        'sync-tracker-state',
      ]);
    });
  });
});
