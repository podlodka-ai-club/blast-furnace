import { createJobLogger } from './logger.js';
import { getRef, pushBranch } from '../github/branches.js';
import { jobQueue } from './queue.js';
function slugify(text) {
    let slug = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
    if (slug.length > 50) {
        const lastHyphen = slug.lastIndexOf('-', 50);
        if (lastHyphen > 0) {
            slug = slug.slice(0, lastHyphen);
        }
        else {
            slug = slug.slice(0, 50);
        }
    }
    slug = slug.replace(/-+$/, '');
    return slug || 'issue';
}
export async function processIssue(job) {
    const logger = createJobLogger(job);
    const { issue } = job.data;
    logger.info(`Processing issue #${issue.number}: ${issue.title}`);
    logger.info(`Issue body: ${issue.body ?? '(no body)'}`);
    const branchName = `issue-${issue.number}-${slugify(issue.title)}`;
    logger.info(`Creating branch: ${branchName}`);
    let sha;
    try {
        sha = await getRef('main');
    }
    catch (err) {
        logger.error(`Failed to get ref for main: ${err}`);
        throw err;
    }
    try {
        await pushBranch(branchName, sha);
    }
    catch (err) {
        logger.error(`Failed to push branch ${branchName}: ${err}`);
        throw err;
    }
    try {
        const verifySha = await getRef(branchName);
        logger.info(`Branch ${branchName} created successfully (SHA: ${verifySha})`);
    }
    catch (err) {
        logger.error(`Branch ${branchName} was not found after creation: ${err}`);
        throw new Error(`Branch ${branchName} verification failed`);
    }
    logger.info(`Enqueueing codex provider job for issue #${issue.number}`);
    const codexJobData = {
        taskId: job.data.taskId,
        type: 'codex-provider',
        issue,
        branchName,
    };
    try {
        await jobQueue.add('codex-provider', codexJobData);
        logger.info(`Codex provider job enqueued for branch: ${branchName}`);
    }
    catch (err) {
        logger.error(`Failed to enqueue codex provider job for issue #${issue.number}: ${err}`);
        throw err;
    }
}
export const issueProcessorHandler = processIssue;
