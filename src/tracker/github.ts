import { config } from '../config/index.js';
import {
  createIssueComment,
  listIssueComments,
  updateIssueComment,
  type GitHubIssueComment,
} from '../github/comments.js';
import type { RepositoryIdentity, RunStatusMetadata } from '../types/index.js';
import { extractSingleTrackerMarker, markerMatches, type TrackerCommentMarker } from './markers.js';
import { renderStatusComment } from './render.js';

export interface CreateOrUpdateStatusCommentInput {
  runId: string;
  issueNumber: number;
  repository: RepositoryIdentity;
  status: RunStatusMetadata;
}

export interface TrackerClient {
  createOrUpdateStatusComment(input: CreateOrUpdateStatusCommentInput): Promise<RunStatusMetadata>;
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && err.status === 404;
}

function expectedMarker(input: CreateOrUpdateStatusCommentInput): TrackerCommentMarker {
  return {
    kind: 'orchestrator-status',
    runId: input.runId,
    owner: input.repository.owner,
    repo: input.repository.repo,
    issue: input.issueNumber,
  };
}

function matchingComment(comments: GitHubIssueComment[], marker: TrackerCommentMarker): GitHubIssueComment | null {
  const matches = comments
    .filter((comment) => markerMatches(extractSingleTrackerMarker(comment.body), marker))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  return matches[0] ?? null;
}

export class GitHubTrackerClient implements TrackerClient {
  async createOrUpdateStatusComment(input: CreateOrUpdateStatusCommentInput): Promise<RunStatusMetadata> {
    if (input.repository.owner !== config.github.owner || input.repository.repo !== config.github.repo) {
      throw new Error('Tracker status repository must match configured GitHub repository');
    }

    const marker = expectedMarker(input);
    const body = renderStatusComment(input);
    let comment: GitHubIssueComment | null = null;
    const externalId = input.status.externalId;
    const issueComments = await listIssueComments(input.issueNumber);

    if (externalId) {
      const existing = issueComments.find((candidate) => candidate.id === Number(externalId));
      if (existing && markerMatches(extractSingleTrackerMarker(existing.body), marker)) {
        try {
          comment = await updateIssueComment(Number(externalId), body);
        } catch (err) {
          if (!isNotFoundError(err)) {
            throw err;
          }
        }
      }
    }

    if (!comment) {
      const recovered = matchingComment(issueComments, marker);
      comment = recovered
        ? await updateIssueComment(recovered.id, body)
        : await createIssueComment(input.issueNumber, body);
    }

    const now = new Date().toISOString();
    return {
      ...input.status,
      provider: 'github',
      kind: 'orchestrator-status',
      externalId: String(comment.id),
      createdAt: input.status.createdAt ?? (comment.createdAt || now),
      updatedAt: comment.updatedAt || now,
    };
  }
}

class NoopTrackerClient implements TrackerClient {
  async createOrUpdateStatusComment(input: CreateOrUpdateStatusCommentInput): Promise<RunStatusMetadata> {
    const now = new Date().toISOString();
    return {
      ...input.status,
      provider: 'github',
      kind: 'orchestrator-status',
      externalId: input.status.externalId ?? 'test-status-comment',
      createdAt: input.status.createdAt ?? now,
      updatedAt: now,
    };
  }
}

export const trackerClient: TrackerClient = process.env['VITEST']
  ? new NoopTrackerClient()
  : new GitHubTrackerClient();
