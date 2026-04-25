import { Octokit } from '@octokit/rest';
import { config } from '../config/index.js';
export function createGitHubClient() {
    return new Octokit({
        auth: config.github.token,
    });
}
export const githubClient = createGitHubClient();
