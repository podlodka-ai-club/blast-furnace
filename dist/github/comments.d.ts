export interface GitHubIssueComment {
    id: number;
    body: string;
    createdAt: string;
    updatedAt: string;
}
export declare function createIssueComment(issueNumber: number, body: string): Promise<GitHubIssueComment>;
export declare function updateIssueComment(commentId: number, body: string): Promise<GitHubIssueComment>;
export declare function listIssueComments(issueNumber: number): Promise<GitHubIssueComment[]>;
