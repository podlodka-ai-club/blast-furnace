import type { GitHubIssue } from '../types/index.js';
export interface IssueFilters {
    labels?: string;
    state?: 'open' | 'closed' | 'all';
    assignee?: string;
    since?: string;
    milestone?: number;
    owner?: string;
    repo?: string;
}
export declare function fetchIssues(filters?: IssueFilters): Promise<GitHubIssue[]>;
