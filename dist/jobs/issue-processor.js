import { createJobLogger } from './logger.js';
import { getRef, pushBranch, deleteBranch } from '../github/branches.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';
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
export async function runIssueProcessorWork(job, logger = createJobLogger(job)) {
    const { issue } = job.data;
    logger.info(`Processing issue #${issue.number}: ${issue.title}`);
    logger.info(`Issue body: ${issue.body ?? '(no body)'}`);
    const branchName = `issue-${issue.number}-${slugify(issue.title)}`;
    let sha;
    try {
        await job.updateProgress({ step: 'fetching-main-ref' });
        sha = await getRef('main');
    }
    catch (err) {
        logger.error(`Failed to get ref for main: ${err}`);
        throw err;
    }
    let branchExists = false;
    try {
        await getRef(branchName);
        branchExists = true;
    }
    catch {
    }
    if (branchExists) {
        logger.info(`Branch ${branchName} already exists, skipping creation`);
    }
    else {
        logger.info(`Creating branch: ${branchName}`);
        try {
            await job.updateProgress({ step: 'creating-branch', branch: branchName });
            await pushBranch(branchName, sha);
        }
        catch (err) {
            logger.error(`Failed to push branch ${branchName}: ${err}`);
            throw err;
        }
    }
    try {
        await job.updateProgress({ step: 'verifying-branch', branch: branchName });
        const verifySha = await getRef(branchName);
        logger.info(`Branch ${branchName} created successfully (SHA: ${verifySha})`);
        return {
            taskId: job.data.taskId,
            type: 'plan',
            issue,
            branchName,
        };
    }
    catch (err) {
        try {
            await deleteBranch(branchName);
            logger.info(`Cleaned up orphaned branch ${branchName}`);
        }
        catch (cleanupErr) {
            logger.error(`Failed to clean up orphaned branch ${branchName}: ${cleanupErr}`);
        }
        throw err;
    }
}
export async function runIssueProcessorFlow(job) {
    const logger = createJobLogger(job);
    const planJobData = await runIssueProcessorWork(job, logger);
    try {
        await job.updateProgress({ step: 'enqueueing-plan', issue: planJobData.issue.number });
        logger.info(`Enqueueing plan job for issue #${planJobData.issue.number}`);
        await scheduleNextJob(jobQueue, 'plan', planJobData);
        logger.info(`Plan job enqueued for branch: ${planJobData.branchName}`);
    }
    catch (err) {
        try {
            await deleteBranch(planJobData.branchName);
            logger.info(`Cleaned up orphaned branch ${planJobData.branchName}`);
        }
        catch (cleanupErr) {
            logger.error(`Failed to clean up orphaned branch ${planJobData.branchName}: ${cleanupErr}`);
        }
        throw err;
    }
}
export const processIssue = runIssueProcessorFlow;
export const issueProcessorHandler = processIssue;
