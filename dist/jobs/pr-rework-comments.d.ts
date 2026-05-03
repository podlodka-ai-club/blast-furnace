import type { PullRequestComment, PullRequestReviewComment } from '../github/pullRequests.js';
export interface BuildPrReworkCommentsMarkdownInput {
    reviewComments: PullRequestReviewComment[];
    pullRequestComments: PullRequestComment[];
    blastFurnaceLogin?: string;
    since?: string;
    until?: string;
}
export declare function buildPrReworkCommentsMarkdown(input: BuildPrReworkCommentsMarkdownInput): string;
