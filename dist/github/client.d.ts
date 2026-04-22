import { Octokit } from '@octokit/rest';
export type GitHubClient = InstanceType<typeof Octokit>;
export declare function createGitHubClient(): GitHubClient;
export declare const githubClient: GitHubClient;
