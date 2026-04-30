import { describe, expect, it, vi, afterEach } from 'vitest';
import { createIssueComment, listIssueComments, updateIssueComment } from '../github/comments.js';
import { GitHubTrackerClient } from './github.js';
import { createInitialStatusMetadata } from './status.js';
import { renderTrackerCommentMarker } from './markers.js';

vi.mock('../github/comments.js', () => ({
  createIssueComment: vi.fn(),
  updateIssueComment: vi.fn(),
  listIssueComments: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    github: {
      owner: 'owner',
      repo: 'repo',
      token: 'token',
    },
  },
}));

const marker = renderTrackerCommentMarker({
  kind: 'orchestrator-status',
  runId: 'run-123',
  owner: 'owner',
  repo: 'repo',
  issue: 42,
});

function input(externalId?: string) {
  return {
    runId: 'run-123',
    issueNumber: 42,
    repository: { owner: 'owner', repo: 'repo' },
    status: {
      ...createInitialStatusMetadata('2026-04-30T10:00:00.000Z'),
      ...(externalId !== undefined && { externalId }),
    },
  };
}

describe('GitHubTrackerClient', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('updates a persisted comment when its marker is valid', async () => {
    vi.mocked(listIssueComments).mockResolvedValue([
      { id: 7, body: `${marker}\nold`, createdAt: '2026-04-30T10:00:00.000Z', updatedAt: '2026-04-30T10:00:00.000Z' },
    ]);
    vi.mocked(updateIssueComment).mockResolvedValue({
      id: 7,
      body: `${marker}\nnew`,
      createdAt: '2026-04-30T10:00:00.000Z',
      updatedAt: '2026-04-30T10:05:00.000Z',
    });

    await expect(new GitHubTrackerClient().createOrUpdateStatusComment(input('7'))).resolves.toMatchObject({
      externalId: '7',
      provider: 'github',
    });
    expect(updateIssueComment).toHaveBeenCalledWith(7, expect.stringContaining(marker));
    expect(createIssueComment).not.toHaveBeenCalled();
  });

  it('recovers by the newest matching marker when the persisted comment is invalid', async () => {
    vi.mocked(listIssueComments).mockResolvedValue([
      { id: 7, body: 'user edited without marker', createdAt: '2026-04-30T10:00:00.000Z', updatedAt: '2026-04-30T10:00:00.000Z' },
      { id: 8, body: `${marker}\nolder`, createdAt: '2026-04-30T10:01:00.000Z', updatedAt: '2026-04-30T10:01:00.000Z' },
      { id: 9, body: `${marker}\nnewer`, createdAt: '2026-04-30T10:02:00.000Z', updatedAt: '2026-04-30T10:02:00.000Z' },
    ]);
    vi.mocked(updateIssueComment).mockResolvedValue({
      id: 9,
      body: `${marker}\nupdated`,
      createdAt: '2026-04-30T10:02:00.000Z',
      updatedAt: '2026-04-30T10:06:00.000Z',
    });

    await new GitHubTrackerClient().createOrUpdateStatusComment(input('7'));

    expect(updateIssueComment).toHaveBeenCalledWith(9, expect.stringContaining(marker));
    expect(createIssueComment).not.toHaveBeenCalled();
  });

  it('creates a replacement when no valid marker exists', async () => {
    vi.mocked(listIssueComments).mockResolvedValue([
      { id: 7, body: 'no marker', createdAt: '2026-04-30T10:00:00.000Z', updatedAt: '2026-04-30T10:00:00.000Z' },
    ]);
    vi.mocked(createIssueComment).mockResolvedValue({
      id: 10,
      body: `${marker}\ncreated`,
      createdAt: '2026-04-30T10:03:00.000Z',
      updatedAt: '2026-04-30T10:03:00.000Z',
    });

    await expect(new GitHubTrackerClient().createOrUpdateStatusComment(input('7'))).resolves.toMatchObject({
      externalId: '10',
    });
  });

  it('surfaces non-404 provider errors', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 403 });
    vi.mocked(listIssueComments).mockRejectedValue(err);

    await expect(new GitHubTrackerClient().createOrUpdateStatusComment(input('7'))).rejects.toThrow('rate limited');
  });
});
