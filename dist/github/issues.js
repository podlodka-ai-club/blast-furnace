import { githubClient } from './client.js';
import { config } from '../config/index.js';
function mapGitHubIssueResponse(issue) {
    return {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        state: issue.state === 'open' || issue.state === 'closed' ? issue.state : 'open',
        labels: issue.labels?.map((label) => (typeof label === 'string' ? label : label?.name)).filter((l) => l !== undefined) ?? [],
        assignee: issue.assignee?.login ?? null,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
    };
}
function isPullRequestIssue(issue) {
    return 'pull_request' in issue && issue.pull_request !== undefined;
}
export async function fetchIssues(filters = {}) {
    const { labels, state, assignee, since, milestone, owner, repo } = filters;
    const response = await githubClient.issues.listForRepo({
        owner: owner ?? config.github.owner,
        repo: repo ?? config.github.repo,
        labels,
        state: state ?? 'open',
        assignee,
        since: since ? (() => {
            const d = new Date(since);
            return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
        })() : undefined,
        milestone: milestone !== undefined ? String(milestone) : undefined,
    });
    return response.data
        .filter((issue) => !isPullRequestIssue(issue))
        .map(mapGitHubIssueResponse);
}
