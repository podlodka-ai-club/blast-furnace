import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { IssueProcessorJobData } from '../types/index.js';

// Use vi.hoisted to avoid hoisting issues with vi.mock
const { mockGetRef, mockPushBranch, mockCreatePullRequest, mockCreateJobLogger } = vi.hoisted(() => ({
  mockGetRef: vi.fn(),
  mockPushBranch: vi.fn(),
  mockCreatePullRequest: vi.fn(),
  mockCreateJobLogger: vi.fn(),
}));

// Mock the GitHub modules
vi.mock('../github/branches.js', () => ({
  getRef: mockGetRef,
  pushBranch: mockPushBranch,
}));

vi.mock('../github/pullRequests.js', () => ({
  createPullRequest: mockCreatePullRequest,
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
      mockCreatePullRequest.mockResolvedValue({ number: 1, htmlUrl: 'https://github.com/test/test/pull/1' });

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
      mockGetRef.mockResolvedValue('abc123');
      mockPushBranch.mockResolvedValue();
      mockCreatePullRequest.mockResolvedValue({ number: 1, htmlUrl: 'https://github.com/test/test/pull/1' });

      const mockJob = createMockJob({ title: 'Test Issue Title' });
      await processIssue(mockJob);

      expect(mockGetRef).toHaveBeenCalledWith('main');
      expect(mockPushBranch).toHaveBeenCalledWith('issue-42-test-issue-title', 'abc123');
    });

    it('should create PR with issue data', async () => {
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
      mockCreatePullRequest.mockResolvedValue({ number: 5, htmlUrl: 'https://github.com/test/test/pull/5' });

      const mockJob = createMockJob({
        title: 'Test Issue',
        body: 'PR body from issue',
        labels: ['enhancement'],
      });
      await processIssue(mockJob);

      expect(mockCreatePullRequest).toHaveBeenCalledWith({
        title: 'Test Issue',
        head: 'issue-42-test-issue',
        base: 'main',
        body: 'PR body from issue',
      });
      expect(mockInfo).toHaveBeenCalledWith('Created PR #5: https://github.com/test/test/pull/5');
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
      mockCreatePullRequest.mockResolvedValue({ number: 1, htmlUrl: 'https://github.com/test/test/pull/1' });

      const mockJob = createMockJob({ body: null });
      await processIssue(mockJob);

      expect(mockInfo).toHaveBeenCalledWith('Issue body: (no body)');
      expect(mockCreatePullRequest).toHaveBeenCalledWith({
        title: 'Test Issue',
        head: 'issue-42-test-issue',
        base: 'main',
        body: '',
      });
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
      mockGetRef.mockResolvedValue('abc123');
      mockPushBranch.mockResolvedValue();
      mockCreatePullRequest.mockResolvedValue({ number: 1, htmlUrl: 'https://github.com/test/test/pull/1' });

      const mockJob = createMockJob({ title: 'Fix: "Awesome" bug #1 & other stuff!' });
      await processIssue(mockJob);

      // Special chars like # and & are removed by slugify, leaving only alphanumeric and hyphens
      expect(mockPushBranch).toHaveBeenCalledWith('issue-42-fix-awesome-bug-1-other-stuff', 'abc123');
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
      mockGetRef.mockResolvedValue('abc123');
      mockPushBranch.mockResolvedValue();
      mockCreatePullRequest.mockResolvedValue({ number: 1, htmlUrl: 'https://github.com/test/test/pull/1' });

      const mockJob = createMockJob({ title: 'My   Multiple   Spaces' });
      await processIssue(mockJob);

      expect(mockPushBranch).toHaveBeenCalledWith('issue-42-my-multiple-spaces', 'abc123');
    });
  });

  describe('issueProcessorHandler', () => {
    it('should export a function', async () => {
      const { issueProcessorHandler } = await import('./issue-processor.js');
      expect(typeof issueProcessorHandler).toBe('function');
    });
  });
});