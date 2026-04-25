import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { IssueProcessorJobData } from '../types/index.js';

// Use vi.hoisted to avoid hoisting issues with vi.mock
const { mockGetRef, mockPushBranch, mockDeleteBranch, mockCreateJobLogger, mockJobQueueAdd } = vi.hoisted(() => ({
  mockGetRef: vi.fn(),
  mockPushBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockCreateJobLogger: vi.fn(),
  mockJobQueueAdd: vi.fn(),
}));

// Mock the GitHub modules
vi.mock('../github/branches.js', () => ({
  getRef: mockGetRef,
  pushBranch: mockPushBranch,
  deleteBranch: mockDeleteBranch,
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
}));

vi.mock('./logger.js', () => ({
  createJobLogger: mockCreateJobLogger,
}));

vi.mock('../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
    },
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

describe('issue processor', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Setup default mock logger
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
  });

  const createMockJob = (issueData: Partial<IssueProcessorJobData['issue']> = {}): Job<IssueProcessorJobData> => {
    return {
      id: 'job-123',
      data: {
        taskId: 'task-456',
        type: 'issue-processor',
        issue: {
          id: 1,
          number: 42,
          title: 'Test Issue',
          body: 'Test body content',
          state: 'open' as const,
          labels: [],
          assignee: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          ...issueData,
        },
      },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job<IssueProcessorJobData>;
  };

  describe('processIssue', () => {
    it('should log issue title and body', async () => {
      const { processIssue } = await import('./issue-processor.js');

      const mockInfo = vi.fn();
      mockCreateJobLogger.mockReturnValue({
        info: mockInfo,
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      mockGetRef.mockResolvedValue('abc123');
      mockPushBranch.mockResolvedValue();
      mockDeleteBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob();
      await processIssue(mockJob);

      expect(mockInfo).toHaveBeenCalledWith('Processing issue #42: Test Issue');
      expect(mockInfo).toHaveBeenCalledWith('Issue body: Test body content');
    });

    it('should create branch with correct name', async () => {
      const { processIssue } = await import('./issue-processor.js');

      const mockInfo = vi.fn();
      mockCreateJobLogger.mockReturnValue({
        info: mockInfo,
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      // First call returns SHA for 'main', second call throws for branch existence check (branch doesn't exist)
      mockGetRef
        .mockResolvedValueOnce('abc123')
        .mockRejectedValueOnce(new Error('Branch not found'));
      mockPushBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob({ title: 'Test Issue Title' });
      await processIssue(mockJob);

      expect(mockGetRef).toHaveBeenCalledWith('main');
      expect(mockPushBranch).toHaveBeenCalledWith('issue-42-test-issue-title', 'abc123');
      expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', expect.objectContaining({
        branchName: 'issue-42-test-issue-title',
      }));
    });

    it('should enqueue plan job with issue data', async () => {
      const { processIssue } = await import('./issue-processor.js');

      const mockInfo = vi.fn();
      mockCreateJobLogger.mockReturnValue({
        info: mockInfo,
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      mockGetRef.mockResolvedValue('abc123');
      mockPushBranch.mockResolvedValue();
      mockDeleteBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob({
        title: 'Test Issue',
        body: 'Issue body content',
        labels: ['enhancement'],
      });
      await processIssue(mockJob);

      expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', {
        taskId: 'task-456',
        type: 'plan',
        issue: {
          id: 1,
          number: 42,
          title: 'Test Issue',
          body: 'Issue body content',
          state: 'open',
          labels: ['enhancement'],
          assignee: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        branchName: 'issue-42-test-issue',
      });
      expect(mockInfo).toHaveBeenCalledWith('Plan job enqueued for branch: issue-42-test-issue');
    });

    it('should handle issue with null body', async () => {
      const { processIssue } = await import('./issue-processor.js');

      const mockInfo = vi.fn();
      mockCreateJobLogger.mockReturnValue({
        info: mockInfo,
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      mockGetRef.mockResolvedValue('abc123');
      mockPushBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob({ body: null });
      await processIssue(mockJob);

      expect(mockInfo).toHaveBeenCalledWith('Issue body: (no body)');
      expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', expect.objectContaining({
        branchName: 'issue-42-test-issue',
      }));
    });

    it('should handle special characters in issue title', async () => {
      const { processIssue } = await import('./issue-processor.js');

      const mockInfo = vi.fn();
      mockCreateJobLogger.mockReturnValue({
        info: mockInfo,
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      // First call returns SHA for 'main', second call throws for branch existence check (branch doesn't exist)
      mockGetRef
        .mockResolvedValueOnce('abc123')
        .mockRejectedValueOnce(new Error('Branch not found'));
      mockPushBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob({ title: 'Fix: "Awesome" bug #1 & other stuff!' });
      await processIssue(mockJob);

      // Special chars like # and & are removed by slugify, leaving only alphanumeric and hyphens
      expect(mockPushBranch).toHaveBeenCalledWith('issue-42-fix-awesome-bug-1-other-stuff', 'abc123');
      expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', expect.objectContaining({
        branchName: 'issue-42-fix-awesome-bug-1-other-stuff',
      }));
    });

    it('should slugify title correctly', async () => {
      const { processIssue } = await import('./issue-processor.js');

      const mockInfo = vi.fn();
      mockCreateJobLogger.mockReturnValue({
        info: mockInfo,
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      // First call returns SHA for 'main', second call throws for branch existence check (branch doesn't exist)
      mockGetRef
        .mockResolvedValueOnce('abc123')
        .mockRejectedValueOnce(new Error('Branch not found'));
      mockPushBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob({ title: 'My   Multiple   Spaces' });
      await processIssue(mockJob);

      expect(mockPushBranch).toHaveBeenCalledWith('issue-42-my-multiple-spaces', 'abc123');
      expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', expect.objectContaining({
        branchName: 'issue-42-my-multiple-spaces',
      }));
    });

    it('should propagate error when getRef fails', async () => {
      const { processIssue } = await import('./issue-processor.js');

      mockCreateJobLogger.mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      mockGetRef.mockRejectedValue(new Error('Ref not found'));

      const mockJob = createMockJob();
      await expect(processIssue(mockJob)).rejects.toThrow('Ref not found');
    });

    it('should propagate error when pushBranch fails', async () => {
      const { processIssue } = await import('./issue-processor.js');

      mockCreateJobLogger.mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      // First call returns SHA for 'main', second call throws for branch existence check (branch doesn't exist)
      mockGetRef
        .mockResolvedValueOnce('abc123')
        .mockRejectedValueOnce(new Error('Branch not found'));
      mockPushBranch.mockRejectedValue(new Error('Push failed'));

      const mockJob = createMockJob();
      await expect(processIssue(mockJob)).rejects.toThrow('Push failed');
    });

    it('should propagate error when jobQueue.add fails', async () => {
      const { processIssue } = await import('./issue-processor.js');

      mockCreateJobLogger.mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      mockGetRef.mockResolvedValue('abc123');
      mockPushBranch.mockResolvedValue();
      mockJobQueueAdd.mockRejectedValue(new Error('Queue add failed'));

      const mockJob = createMockJob();
      await expect(processIssue(mockJob)).rejects.toThrow('Queue add failed');
    });

    it('should expose work that returns plan data without enqueueing', async () => {
      const { runIssueProcessorWork } = await import('./issue-processor.js');

      const mockInfo = vi.fn();
      mockCreateJobLogger.mockReturnValue({
        info: mockInfo,
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      mockGetRef
        .mockResolvedValueOnce('abc123')
        .mockRejectedValueOnce(new Error('Branch not found'))
        .mockResolvedValueOnce('def456');
      mockPushBranch.mockResolvedValue();
      mockDeleteBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob({ title: 'Flow Work Split' });
      const result = await runIssueProcessorWork(mockJob);

      expect(result).toEqual({
        taskId: 'task-456',
        type: 'plan',
        issue: mockJob.data.issue,
        branchName: 'issue-42-flow-work-split',
      });
      expect(mockJobQueueAdd).not.toHaveBeenCalled();
    });

    it('should expose flow that schedules the plan transition', async () => {
      const { runIssueProcessorFlow } = await import('./issue-processor.js');

      mockCreateJobLogger.mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      mockGetRef
        .mockResolvedValueOnce('abc123')
        .mockRejectedValueOnce(new Error('Branch not found'))
        .mockResolvedValueOnce('def456');
      mockPushBranch.mockResolvedValue();
      mockDeleteBranch.mockResolvedValue();
      mockJobQueueAdd.mockResolvedValue();

      const mockJob = createMockJob({ title: 'Flow Schedules Plan' });
      await runIssueProcessorFlow(mockJob);

      expect(mockJobQueueAdd).toHaveBeenCalledWith('plan', {
        taskId: 'task-456',
        type: 'plan',
        issue: mockJob.data.issue,
        branchName: 'issue-42-flow-schedules-plan',
      });
    });
  });

  describe('issueProcessorHandler', () => {
    it('should export a function', async () => {
      const { issueProcessorHandler } = await import('./issue-processor.js');
      expect(typeof issueProcessorHandler).toBe('function');
    });
  });
});
