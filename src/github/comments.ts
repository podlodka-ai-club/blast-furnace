import { githubClient } from './client.js';
import { config } from '../config/index.js';

export interface GitHubIssueComment {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

function mapComment(data: {
  id: number;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
}): GitHubIssueComment {
  return {
    id: data.id,
    body: data.body ?? '',
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? data.created_at ?? '',
  };
}

export async function createIssueComment(issueNumber: number, body: string): Promise<GitHubIssueComment> {
  const response = await githubClient.issues.createComment({
    owner: config.github.owner,
    repo: config.github.repo,
    issue_number: issueNumber,
    body,
  });
  return mapComment(response.data);
}

export async function updateIssueComment(commentId: number, body: string): Promise<GitHubIssueComment> {
  const response = await githubClient.issues.updateComment({
    owner: config.github.owner,
    repo: config.github.repo,
    comment_id: commentId,
    body,
  });
  return mapComment(response.data);
}

export async function listIssueComments(issueNumber: number): Promise<GitHubIssueComment[]> {
  const response = await githubClient.issues.listComments({
    owner: config.github.owner,
    repo: config.github.repo,
    issue_number: issueNumber,
  });
  return response.data.map(mapComment);
}
