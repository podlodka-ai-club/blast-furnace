import { describe, expect, it, vi, afterEach } from 'vitest';
import { githubClient } from './client.js';
import { createIssueComment, listIssueComments, updateIssueComment } from './comments.js';

vi.mock('./client.js', () => ({
  githubClient: {
    issues: {
      createComment: vi.fn(),
      updateComment: vi.fn(),
      listComments: vi.fn(),
    },
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    github: {
      owner: 'test-owner',
      repo: 'test-repo',
      token: 'test-token',
    },
  },
}));

describe('GitHub issue comments', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('creates issue comments in the configured repository', async () => {
    vi.mocked(githubClient.issues.createComment).mockResolvedValue({
      data: {
        id: 123,
        body: 'body',
        created_at: '2026-04-30T10:00:00.000Z',
        updated_at: '2026-04-30T10:00:00.000Z',
      },
    } as Awaited<ReturnType<typeof githubClient.issues.createComment>>);

    await expect(createIssueComment(42, 'body')).resolves.toEqual({
      id: 123,
      body: 'body',
      createdAt: '2026-04-30T10:00:00.000Z',
      updatedAt: '2026-04-30T10:00:00.000Z',
    });
    expect(githubClient.issues.createComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      body: 'body',
    });
  });

  it('updates issue comments in the configured repository', async () => {
    vi.mocked(githubClient.issues.updateComment).mockResolvedValue({
      data: {
        id: 123,
        body: 'updated',
        created_at: '2026-04-30T10:00:00.000Z',
        updated_at: '2026-04-30T10:05:00.000Z',
      },
    } as Awaited<ReturnType<typeof githubClient.issues.updateComment>>);

    await expect(updateIssueComment(123, 'updated')).resolves.toMatchObject({
      id: 123,
      body: 'updated',
      updatedAt: '2026-04-30T10:05:00.000Z',
    });
    expect(githubClient.issues.updateComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 123,
      body: 'updated',
    });
  });

  it('lists issue comments in the configured repository', async () => {
    vi.mocked(githubClient.issues.listComments).mockResolvedValue({
      data: [
        {
          id: 123,
          body: 'one',
          created_at: '2026-04-30T10:00:00.000Z',
          updated_at: '2026-04-30T10:01:00.000Z',
        },
      ],
    } as Awaited<ReturnType<typeof githubClient.issues.listComments>>);

    await expect(listIssueComments(42)).resolves.toEqual([
      {
        id: 123,
        body: 'one',
        createdAt: '2026-04-30T10:00:00.000Z',
        updatedAt: '2026-04-30T10:01:00.000Z',
      },
    ]);
    expect(githubClient.issues.listComments).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
    });
  });
});
