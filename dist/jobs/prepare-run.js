import { randomUUID } from 'node:crypto';
import { spawn } from 'child_process';
import { getRef, pushBranch, deleteBranch } from '../github/branches.js';
import { assertConfiguredRepository, isConfiguredRepository } from '../github/repository.js';
import { cloneRepoInto, cleanupWorkingDir, createGitCommandEnv, createTempWorkingDir, getRepoRemoteUrl, } from '../utils/working-dir.js';
import { stageOutputSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, createRunFileSet, initializeRunSummary, readHandoffRecord, readRunSummary, resolveOrchestrationStorageRoot, scheduleNextJob, updateRunSummary, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
import { statusItem, updateRunStatus } from './status.js';
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
        const child = spawn('git', args, { cwd, env: createGitCommandEnv() });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeoutMs = Number(process.env['GIT_COMMAND_TIMEOUT_MS'] ?? 120000);
        const commandTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
        const settle = (fn) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            fn();
        };
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            settle(() => reject(new Error(`git command timed out after ${commandTimeoutMs}ms`)));
        }, commandTimeoutMs);
        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('close', (code) => {
            if (code === 0) {
                settle(() => resolve(stdout.trim()));
            }
            else {
                settle(() => reject(new Error(`git command failed: ${stderr}`)));
            }
        });
        child.on('error', (err) => {
            settle(() => reject(err));
        });
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
async function checkoutReworkBranch(branchName, expectedSha, workspacePath, logger) {
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
    await execGitCommand(['reset', '--hard', expectedSha], workspacePath);
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
function assertObject(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
}
function readReworkContext(record) {
    if (record.fromStage !== 'pr-rework-intake') {
        throw new Error('Rework Prepare Run input must be produced by pr-rework-intake');
    }
    assertObject(record.output, 'PR Rework Intake output');
    if (record.output['status'] !== 'rework-needed') {
        throw new Error('Rework Prepare Run input must have rework-needed status');
    }
    const selectedNextStage = record.output['selectedNextStage'];
    if (selectedNextStage !== 'plan' && selectedNextStage !== 'develop') {
        throw new Error('PR Rework Intake selectedNextStage must be plan or develop');
    }
    const pullRequestHead = record.output['pullRequestHead'];
    assertObject(pullRequestHead, 'pullRequestHead');
    for (const field of ['owner', 'repo', 'branch', 'sha']) {
        if (typeof pullRequestHead[field] !== 'string' || pullRequestHead[field].length === 0) {
            throw new Error(`pullRequestHead.${field} must be a non-empty string`);
        }
    }
    return {
        selectedNextStage,
        pullRequestHead: {
            owner: String(pullRequestHead['owner']),
            repo: String(pullRequestHead['repo']),
            branch: String(pullRequestHead['branch']),
            sha: String(pullRequestHead['sha']),
        },
    };
}
async function runPrepareRunReworkWork(job, logger, state) {
    if (!job.data.inputRecordRef) {
        throw new Error('Rework Prepare Run requires an input handoff record reference');
    }
    const inputRecord = await readHandoffRecord(job.data.inputRecordRef);
    const reworkContext = readReworkContext(inputRecord);
    const headRepository = {
        owner: reworkContext.pullRequestHead.owner,
        repo: reworkContext.pullRequestHead.repo,
    };
    if (!isConfiguredRepository(headRepository)) {
        throw new Error('Rework pull request head repository mismatch');
    }
    assertConfiguredRepository(job.data.repository);
    const branchName = reworkContext.pullRequestHead.branch;
    state.branchName = branchName;
    const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    const workspacePath = await createTempWorkingDir('prepare-run');
    state.workspacePath = workspacePath;
    logger.info(`Preparing rework run ${job.data.runId} from PR branch ${branchName}`);
    await cloneRepoInto(workspacePath, getRepoRemoteUrl());
    await checkoutReworkBranch(branchName, reworkContext.pullRequestHead.sha, workspacePath, logger);
    await updateRunSummary(orchestrationRoot, job.data.runId, (summary) => ({
        ...summary,
        status: 'running',
        currentStage: 'prepare-run',
        stageAttempt: 1,
        reworkAttempt: job.data.reworkAttempt,
        stableContext: {
            issue: summary.stableContext?.issue ?? job.data.issue,
            repository: summary.stableContext?.repository ?? job.data.repository,
            branchName,
            workspacePath,
        },
        stages: {
            ...summary.stages,
            'prepare-run': {
                attempts: 1,
                status: 'running',
            },
        },
    }));
    const output = stageOutputSchemas['prepare-run'].parse({
        status: 'success',
        runId: job.data.runId,
        stageAttempt: 1,
        reworkAttempt: job.data.reworkAttempt,
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId: job.data.runId,
        fromStage: 'prepare-run',
        toStage: reworkContext.selectedNextStage,
        stageAttempt: 1,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: [job.data.inputRecordRef],
        status: 'success',
        output,
    });
    return {
        nextJobData: createForwardStagePayload(job.data, reworkContext.selectedNextStage, inputRecordRef, 1),
    };
}
export async function runPrepareRunWork(job, logger = createJobLogger(job), state = {
    branchName: null,
    branchCreated: false,
    workspacePath: null,
    cleaned: false,
}) {
    if (job.data.inputRecordRef) {
        return runPrepareRunReworkWork(job, logger, state);
    }
    const { issue, repository, runId, stageAttempt } = job.data;
    assertConfiguredRepository(repository);
    const branchName = prepareIssueBranchName(issue);
    state.branchName = branchName;
    logger.info(`Preparing run ${runId} for issue #${issue.number} on branch ${branchName}`);
    logger.info(`Issue body: ${issue.body ?? '(no body)'}`);
    await job.updateProgress?.({ step: 'creating-workspace', runId });
    const workspacePath = await createTempWorkingDir('prepare-run');
    state.workspacePath = workspacePath;
    const orchestrationRoot = resolveOrchestrationStorageRoot();
    const runStartedAt = new Date().toISOString();
    if (!await readRunSummary(orchestrationRoot, runId)) {
        const runFileSet = createRunFileSet(orchestrationRoot, runId, new Date(runStartedAt));
        await initializeRunSummary(orchestrationRoot, runFileSet, {
            runId,
            status: 'running',
            currentStage: 'prepare-run',
            runStartedAt,
            stageAttempt,
            reworkAttempt: job.data.reworkAttempt,
            latestHandoffRecord: null,
            initialContext: { issue, repository },
            stages: {},
        });
    }
    await updateRunStatus(orchestrationRoot, runId, {
        heading: 'Blast Furnace is preparing the workspace',
        focus: 'Current focus: Prepare run',
        items: [statusItem('prepare-run', 1, 'in-progress', 'Prepare run', 'Preparing workspace')],
    }, logger);
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
    await updateRunSummary(orchestrationRoot, runId, (summary) => ({
        ...summary,
        status: 'running',
        currentStage: 'prepare-run',
        stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        initialContext: summary.initialContext ?? { issue, repository },
        stableContext: {
            issue,
            repository,
            branchName,
            workspacePath,
        },
        stages: {
            ...summary.stages,
            'prepare-run': {
                attempts: stageAttempt,
                status: 'running',
            },
        },
    }));
    const output = stageOutputSchemas['prepare-run'].parse({
        status: 'success',
        runId,
        stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId,
        fromStage: 'prepare-run',
        toStage: 'assess',
        stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: [],
        status: 'success',
        output,
    });
    await updateRunStatus(orchestrationRoot, runId, {
        heading: 'Blast Furnace is assessing the issue',
        focus: 'Current focus: Assess issue',
        items: [
            statusItem('prepare-run', 1, 'completed', 'Prepare run'),
            statusItem('assess', 1, 'pending', 'Assess issue'),
        ],
    }, logger);
    const assessJobData = createForwardStagePayload(job.data, 'assess', inputRecordRef);
    return {
        assessJobData,
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
        const nextJobData = result.nextJobData ?? result.assessJobData;
        if (!nextJobData) {
            throw new Error('Prepare Run did not produce a next job payload');
        }
        await job.updateProgress?.({ step: `enqueueing-${nextJobData.stage}`, issue: job.data.issue.number });
        await scheduleNextJob(jobQueue, nextJobData.stage, nextJobData);
        handoffCompleted = true;
        logger.info(`${nextJobData.stage} job enqueued for run: ${nextJobData.runId}`);
    }
    catch (err) {
        if (!handoffCompleted) {
            try {
                await updateRunStatus(resolveOrchestrationStorageRoot(), job.data.runId, {
                    heading: 'Blast Furnace stopped during preparation',
                    focus: 'Final state: Prepare run failed',
                    items: [
                        statusItem('prepare-run', 1, 'failed', 'Prepare run', 'Preparation failed'),
                        statusItem('assess', 1, 'skipped', 'Assess issue'),
                        statusItem('plan', 1, 'skipped', 'Plan solution'),
                        statusItem('develop', 1, 'skipped', 'Develop changes'),
                        statusItem('quality-gate', 1, 'skipped', 'Quality Gate'),
                        statusItem('review', 1, 'skipped', 'Code Review'),
                        statusItem('draft-pr-and-in-review', 1, 'skipped', 'Make PR'),
                    ],
                }, logger);
            }
            catch {
            }
            await cleanupPrepareRunFailure(state, logger);
        }
        throw err;
    }
}
export const prepareRunHandler = runPrepareRunFlow;
