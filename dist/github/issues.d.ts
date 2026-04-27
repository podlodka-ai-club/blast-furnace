import type { GitHubIssue } from '../types/index.js';
export interface IssueFilters {
    labels?: string;
    state?: 'open' | 'closed' | 'all';
    assignee?: string;
    since?: string;
    milestone?: number;
}
export declare function fetchIssues(filters?: IssueFilters): Promise<GitHubIssue[]>;
