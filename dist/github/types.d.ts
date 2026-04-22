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
