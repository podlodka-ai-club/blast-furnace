export declare const REWORK_LABEL = "rework";
export interface CreatePullRequestOptions {
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
}
export interface PullRequestResponse {
    number: number;
    htmlUrl: string;
}
export interface PullRequestState {
    number: number;
    state: string;
    merged: boolean;
    htmlUrl: string;
    head: {
        owner: string;
        repo: string;
        branch: string;
        sha: string;
    };
    labels: string[];
}
export interface PullRequestReviewComment {
    id: number;
    authorLogin: string;
    authorType: string;
    body: string;
    createdAt: string;
    path?: string;
    line?: number;
    originalLine?: number;
    outdated: boolean;
    resolved: boolean;
    deleted: boolean;
}
export interface PullRequestComment {
    id: number;
    authorLogin: string;
    authorType: string;
    body: string;
    createdAt: string;
}
export declare function createPullRequest(options: CreatePullRequestOptions): Promise<PullRequestResponse>;
export declare function getPullRequestState(pullNumber: number): Promise<PullRequestState>;
export declare function removeReworkLabelFromPullRequest(pullNumber: number): Promise<void>;
export declare function listPullRequestReviewComments(pullNumber: number): Promise<PullRequestReviewComment[]>;
export declare function listPullRequestComments(pullNumber: number): Promise<PullRequestComment[]>;
