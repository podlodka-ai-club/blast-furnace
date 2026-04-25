import { describe, it, expect, vi } from 'vitest';
import { githubClient } from './client.js';
import { IN_REVIEW_LABEL, READY_LABEL, moveIssueToInReview } from './issue-labels.js';

vi.mock('./client.js', () => ({
  githubClient: {
    issues: {
      listLabelsOnIssue: vi.fn(),
      setLabels: vi.fn(),
    },
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

describe('issue labels', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should replace ready with in review and preserve other labels', async () => {
    vi.mocked(githubClient.issues.listLabelsOnIssue).mockResolvedValue({
      data: [
        { name: READY_LABEL },
        { name: 'bug' },
      ],
    } as Awaited<ReturnType<typeof githubClient.issues.listLabelsOnIssue>>);

    vi.mocked(githubClient.issues.setLabels).mockResolvedValue({
      data: [],
    } as Awaited<ReturnType<typeof githubClient.issues.setLabels>>);

    const labels = await moveIssueToInReview(42);

    expect(githubClient.issues.listLabelsOnIssue).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
    });
    expect(githubClient.issues.setLabels).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      labels: ['bug', IN_REVIEW_LABEL],
    });
    expect(labels).toEqual(['bug', IN_REVIEW_LABEL]);
  });

  it('should avoid duplicate in review labels', async () => {
    vi.mocked(githubClient.issues.listLabelsOnIssue).mockResolvedValue({
      data: [
        { name: READY_LABEL },
        { name: IN_REVIEW_LABEL },
      ],
    } as Awaited<ReturnType<typeof githubClient.issues.listLabelsOnIssue>>);

    vi.mocked(githubClient.issues.setLabels).mockResolvedValue({
      data: [],
    } as Awaited<ReturnType<typeof githubClient.issues.setLabels>>);

    const labels = await moveIssueToInReview(7);

    expect(githubClient.issues.setLabels).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 7,
      labels: [IN_REVIEW_LABEL],
    });
    expect(labels).toEqual([IN_REVIEW_LABEL]);
  });
});
