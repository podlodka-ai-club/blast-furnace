import { githubClient } from './client.js';
import { config } from '../config/index.js';
export async function createPullRequest(options) {
    const { title, head, base, body = '', draft = false } = options;
    if (!title.trim() || !head.trim() || !base.trim()) {
        throw new Error('PR title, head, and base must be non-empty');
    }
    const response = await githubClient.pulls.create({
        owner: config.github.owner,
        repo: config.github.repo,
        title,
        head,
        base,
        body,
        draft,
    });
    return {
        number: response.data.number,
        htmlUrl: response.data.html_url,
    };
}
