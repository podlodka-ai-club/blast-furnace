/**
 * GitHub-specific types not covered by existing GitHubIssue/GitHubComment
 * These types represent raw API response structures
 */
/* istanbul ignore file */
// This file contains only TypeScript type definitions with no runtime code

// Branch/Reference types
export interface GitRef {
  ref: string;
  nodeId: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

export interface BranchRefResponse {
  ref: GitRef['ref'];
  nodeId: GitRef['nodeId'];
  object: GitRef['object'];
}

// Pull Request types
export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
  user: {
    login: string;
    id: number;
  };
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  draft: boolean;
}
