import { githubClient } from './client.js';
import { config } from '../config/index.js';
export const REWORK_LABEL = 'rework';
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
function userLogin(user) {
    if (typeof user === 'object' && user !== null && 'login' in user && typeof user.login === 'string') {
        return user.login;
    }
    return '';
}
function userType(user) {
    if (typeof user === 'object' && user !== null && 'type' in user && typeof user.type === 'string') {
        return user.type;
    }
    return '';
}
function numberOrUndefined(value) {
    return typeof value === 'number' ? value : undefined;
}
function booleanValue(value) {
    return typeof value === 'boolean' ? value : false;
}
function isNotFoundError(error) {
    return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}
export async function getPullRequestState(pullNumber) {
    const response = await githubClient.pulls.get({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: pullNumber,
    });
    const data = response.data;
    const head = data['head'];
    const headRepo = head['repo'];
    const headRepoOwner = headRepo?.['owner'];
    const labels = Array.isArray(data['labels']) ? data['labels'] : [];
    return {
        number: Number(data['number']),
        state: String(data['state']),
        merged: Boolean(data['merged']),
        htmlUrl: String(data['html_url']),
        head: {
            owner: String(headRepoOwner?.['login'] ?? ''),
            repo: String(headRepo?.['name'] ?? ''),
            branch: String(head['ref']),
            sha: String(head['sha']),
        },
        labels: labels
            .map((label) => typeof label === 'object' && label !== null && 'name' in label ? label.name : undefined)
            .filter((label) => typeof label === 'string'),
    };
}
export async function removeReworkLabelFromPullRequest(pullNumber) {
    try {
        await githubClient.issues.removeLabel({
            owner: config.github.owner,
            repo: config.github.repo,
            issue_number: pullNumber,
            name: REWORK_LABEL,
        });
    }
    catch (error) {
        if (!isNotFoundError(error)) {
            throw error;
        }
    }
}
export async function listPullRequestReviewComments(pullNumber) {
    const response = await githubClient.pulls.listReviewComments({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: pullNumber,
    });
    return response.data.map((comment) => {
        const raw = comment;
        const result = {
            id: Number(raw['id']),
            authorLogin: userLogin(raw['user']),
            authorType: userType(raw['user']),
            body: typeof raw['body'] === 'string' ? raw['body'] : '',
            createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : '',
            outdated: booleanValue(raw['outdated']),
            resolved: booleanValue(raw['resolved'] ?? raw['is_resolved']),
            deleted: raw['deleted'] === true || raw['deleted_at'] !== undefined,
        };
        if (typeof raw['path'] === 'string')
            result.path = raw['path'];
        const line = numberOrUndefined(raw['line']);
        if (line !== undefined)
            result.line = line;
        const originalLine = numberOrUndefined(raw['original_line']);
        if (originalLine !== undefined)
            result.originalLine = originalLine;
        return result;
    });
}
export async function listPullRequestComments(pullNumber) {
    const response = await githubClient.issues.listComments({
        owner: config.github.owner,
        repo: config.github.repo,
        issue_number: pullNumber,
    });
    return response.data.map((comment) => {
        const raw = comment;
        return {
            id: Number(raw['id']),
            authorLogin: userLogin(raw['user']),
            authorType: userType(raw['user']),
            body: typeof raw['body'] === 'string' ? raw['body'] : '',
            createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : '',
        };
    });
}
