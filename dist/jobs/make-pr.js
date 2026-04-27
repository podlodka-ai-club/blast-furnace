import { spawn } from 'child_process';
import { createPullRequest } from '../github/pullRequests.js';
import { assertConfiguredRepository } from '../github/repository.js';
import { cleanupWorkingDir, getRepoRemoteUrl } from '../utils/working-dir.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, readValidatedStageInputRecord, resolveOrchestrationStorageRoot, scheduleNextJob, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
const TARGET_REPO_PATHS = [
    '.',
    ':(exclude).orchestrator',
    ':(exclude).orchestrator/**',
    ':(exclude).codex',
    ':(exclude).codex/**',
];
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
async function pushWithRetry(remoteUrl, branchName, cwd, logger, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await execGitCommand(['push', remoteUrl, branchName], cwd);
            return;
        }
        catch (err) {
            if (attempt === maxRetries)
                throw err;
            const delay = Math.pow(2, attempt - 1) * 1000;
            logger.warn(`Push attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}
function sanitizeForGit(text, maxLength = 200) {
    return text.replace(/[\r\n]/g, ' ').slice(0, maxLength);
}
function parseGitStatusPaths(status) {
    const paths = new Set();
    for (const line of status.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        const statusCode = line.slice(0, 2);
        const rawPath = (line[2] === ' ' ? line.slice(3) : line.slice(2).trimStart()).trim();
        if (!rawPath)
            continue;
        if ((statusCode.includes('R') || statusCode.includes('C')) && rawPath.includes(' -> ')) {
            const [fromPath, toPath] = rawPath.split(' -> ');
            if (fromPath)
                paths.add(fromPath);
            if (toPath)
                paths.add(toPath);
            continue;
        }
        paths.add(rawPath);
    }
    return [...paths];
}
export async function runMakePrWork(job, logger = createJobLogger(job)) {
    stagePayloadSchemas['make-pr'].parse(job.data);
    const inputRecord = await readValidatedStageInputRecord(job.data);
    const reviewed = stageOutputSchemas.review.parse(inputRecord.output);
    const { issue, repository, branchName, workspacePath } = reviewed;
    assertConfiguredRepository(repository);
    logger.info(`Finalizing issue #${issue.number} on branch ${branchName}`);
    const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    const status = await execGitCommand(['status', '--porcelain', '--untracked-files=all', '--', ...TARGET_REPO_PATHS], workspacePath);
    if (!status) {
        logger.info('No changes detected, skipping commit, push, pull request, and tracker synchronization');
        const output = stageOutputSchemas['make-pr'].parse({
            ...reviewed,
            status: 'no-changes',
            runId: job.data.runId,
            stageAttempt: job.data.stageAttempt,
            reworkAttempt: job.data.reworkAttempt,
        });
        if (output.status !== 'no-changes') {
            throw new Error('Expected no-changes make-pr output');
        }
        await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
            runId: job.data.runId,
            fromStage: 'make-pr',
            toStage: null,
            stageAttempt: job.data.stageAttempt,
            reworkAttempt: job.data.reworkAttempt,
            dependsOn: job.data.inputRecordRef,
            status: 'success',
            output,
        }, 'completed');
        return { status: 'no-changes', output };
    }
    logger.info('Changes detected, committing...');
    const changedPaths = parseGitStatusPaths(status);
    if (changedPaths.length === 0) {
        throw new Error('Detected git status output but could not parse changed target paths');
    }
    await execGitCommand(['add', '-A', '--', ...changedPaths], workspacePath);
    const sanitizedTitle = sanitizeForGit(issue.title);
    const commitResult = await execGitCommand(['commit', '-m', `Processed issue #${issue.number} via codex: ${sanitizedTitle}`], workspacePath);
    logger.info(`Changes committed: ${commitResult}`);
    logger.info('Pushing changes to remote branch...');
    await pushWithRetry(getRepoRemoteUrl(), branchName, workspacePath, logger);
    logger.info(`Changes pushed to ${branchName}`);
    logger.info('Creating pull request...');
    const prResult = await createPullRequest({
        title: `Process issue #${issue.number}: ${sanitizedTitle}`,
        head: branchName,
        base: 'main',
        body: `Closes #${issue.number}`,
    });
    logger.info(`Pull request created: ${prResult.htmlUrl}`);
    const output = stageOutputSchemas['make-pr'].parse({
        ...reviewed,
        status: 'pull-request-created',
        pullRequest: prResult,
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
    });
    if (output.status !== 'pull-request-created') {
        throw new Error('Expected pull-request-created make-pr output');
    }
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId: job.data.runId,
        fromStage: 'make-pr',
        toStage: 'sync-tracker-state',
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: job.data.inputRecordRef,
        status: 'success',
        output,
    });
    return {
        status: 'pull-request-created',
        output,
        syncTrackerStateJobData: createForwardStagePayload(job.data, 'sync-tracker-state', inputRecordRef),
    };
}
export async function runMakePrFlow(job) {
    const logger = createJobLogger(job);
    try {
        const result = await runMakePrWork(job, logger);
        if (result.status === 'no-changes') {
            logger.info(`Cleaning up temp working directory: ${result.output.workspacePath}`);
            await cleanupWorkingDir(result.output.workspacePath);
            return;
        }
        await scheduleNextJob(jobQueue, 'sync-tracker-state', result.syncTrackerStateJobData);
    }
    catch (err) {
        logger.error(`Make PR operation failed: ${err}`);
        throw err;
    }
}
export const processMakePr = runMakePrFlow;
export const makePrHandler = processMakePr;
