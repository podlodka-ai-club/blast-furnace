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
export declare function createPullRequest(options: CreatePullRequestOptions): Promise<PullRequestResponse>;
