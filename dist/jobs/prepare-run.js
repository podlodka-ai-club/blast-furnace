import { randomUUID } from 'node:crypto';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getRef, pushBranch, deleteBranch } from '../github/branches.js';
import { cloneRepoInto, cleanupWorkingDir, createTempWorkingDir, getRepoRemoteUrl } from '../utils/working-dir.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { resolveRunLogPath, scheduleNextJob, writeArtifactFile, writeRunSummary, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
export function createPrepareRunPayload(input) {
    const runId = input.runId ?? randomUUID();
    return {
        taskId: input.taskId ?? `prepare-run-${input.issue.id}-${runId}`,
        type: 'prepare-run',
        runId,
        stage: 'prepare-run',
        stageAttempt: 1,
        reworkAttempt: 0,
        issue: input.issue,
        repository: input.repository,
    };
}
function slugify(text) {
    let slug = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
    if (slug.length > 50) {
        const lastHyphen = slug.lastIndexOf('-', 50);
        slug = lastHyphen > 0 ? slug.slice(0, lastHyphen) : slug.slice(0, 50);
    }
    slug = slug.replace(/-+$/, '');
    return slug || 'issue';
}
function validateBranchName(branchName) {
    if (!branchName || branchName.includes('..') || branchName.startsWith('-') || /\s/.test(branchName)) {
        throw new Error(`Invalid branch name: ${branchName}`);
    }
}
export function prepareIssueBranchName(issue) {
    const branchName = `issue-${issue.number}-${slugify(issue.title)}`;
    validateBranchName(branchName);
    return branchName;
}
function execGitCommand(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            }
            else {
                reject(new Error(`git command failed: ${stderr}`));
            }
        });
        child.on('error', reject);
    });
}
async function fetchBranchWithRetry(branchName, cwd, logger, maxRetries = 3) {
    const remoteUrl = getRepoRemoteUrl();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await execGitCommand(['fetch', remoteUrl, `heads/${branchName}`], cwd);
            return;
        }
        catch (err) {
            if (attempt === maxRetries)
                throw err;
            const delay = Math.pow(2, attempt - 1) * 1000;
            logger.warn(`Fetch attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}
async function checkoutPreparedBranch(branchName, workspacePath, logger) {
    await fetchBranchWithRetry(branchName, workspacePath, logger);
    const branchExists = await execGitCommand(['rev-parse', '--verify', '--quiet', branchName], workspacePath)
        .then(() => true)
        .catch(() => false);
    if (branchExists) {
        await execGitCommand(['checkout', branchName], workspacePath);
    }
    else {
        await execGitCommand(['checkout', '-b', branchName, '--track', `origin/${branchName}`], workspacePath);
    }
    await execGitCommand(['reset', '--hard', `origin/${branchName}`], workspacePath);
}
async function cleanupPrepareRunFailure(state, logger) {
    if (state.cleaned)
        return;
    state.cleaned = true;
    if (state.workspacePath) {
        try {
            logger.info(`Cleaning up prepared workspace: ${state.workspacePath}`);
            await cleanupWorkingDir(state.workspacePath);
        }
        catch (err) {
            logger.error(`Failed to clean up prepared workspace ${state.workspacePath}: ${err}`);
        }
    }
    if (state.branchCreated && state.branchName) {
        try {
            await deleteBranch(state.branchName);
            logger.info(`Cleaned up orphaned branch ${state.branchName}`);
        }
        catch (err) {
            logger.error(`Failed to clean up orphaned branch ${state.branchName}: ${err}`);
        }
    }
}
export async function runPrepareRunWork(job, logger = createJobLogger(job), state = {
    branchName: null,
    branchCreated: false,
    workspacePath: null,
    cleaned: false,
}) {
    const { issue, repository, runId, stageAttempt } = job.data;
    const branchName = prepareIssueBranchName(issue);
    state.branchName = branchName;
    logger.info(`Preparing run ${runId} for issue #${issue.number} on branch ${branchName}`);
    logger.info(`Issue body: ${issue.body ?? '(no body)'}`);
    await job.updateProgress?.({ step: 'creating-workspace', runId });
    const workspacePath = await createTempWorkingDir('prepare-run');
    state.workspacePath = workspacePath;
    let sha;
    try {
        await job.updateProgress?.({ step: 'fetching-main-ref', runId });
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
        branchExists = false;
    }
    if (branchExists) {
        logger.info(`Branch ${branchName} already exists, reusing it`);
    }
    else {
        logger.info(`Creating branch: ${branchName}`);
        await job.updateProgress?.({ step: 'creating-branch', branch: branchName, runId });
        await pushBranch(branchName, sha);
        state.branchCreated = true;
    }
    await job.updateProgress?.({ step: 'verifying-branch', branch: branchName, runId });
    const verifySha = await getRef(branchName);
    logger.info(`Branch ${branchName} verified (SHA: ${verifySha})`);
    const remoteUrl = getRepoRemoteUrl();
    logger.info(`Cloning repository into prepared workspace: ${workspacePath}`);
    await cloneRepoInto(workspacePath, remoteUrl);
    logger.info(`Checking out prepared branch: ${branchName}`);
    await checkoutPreparedBranch(branchName, workspacePath, logger);
    const runLogPath = resolveRunLogPath(workspacePath, runId);
    await mkdir(dirname(runLogPath), { recursive: true });
    await writeFile(runLogPath, '', { flag: 'a' });
    await writeRunSummary(workspacePath, {
        runId,
        status: 'running',
        stages: {
            'prepare-run': {
                attempts: stageAttempt,
                status: 'running',
            },
        },
    });
    await writeArtifactFile(workspacePath, {
        runId,
        stageName: 'prepare-run',
        attempt: stageAttempt,
        artifactName: 'base-context.json',
    }, {
        runId,
        issue,
        repository,
        branchName,
        workspacePath,
    });
    const assessJobData = createForwardStagePayload(job.data, 'assess', {
        branchName,
        workspacePath,
    });
    return {
        assessJobData,
        runLogPath,
    };
}
export async function runPrepareRunFlow(job) {
    const logger = createJobLogger(job);
    const state = {
        branchName: null,
        branchCreated: false,
        workspacePath: null,
        cleaned: false,
    };
    let handoffCompleted = false;
    try {
        const result = await runPrepareRunWork(job, logger, state);
        await job.updateProgress?.({ step: 'enqueueing-assess', issue: result.assessJobData.issue.number });
        await scheduleNextJob(jobQueue, 'assess', result.assessJobData);
        handoffCompleted = true;
        logger.info(`Assess job enqueued for branch: ${result.assessJobData.branchName}`);
    }
    catch (err) {
        if (!handoffCompleted) {
            await cleanupPrepareRunFailure(state, logger);
        }
        throw err;
    }
}
export const prepareRunHandler = runPrepareRunFlow;
