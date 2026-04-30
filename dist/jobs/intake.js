import Redis from 'ioredis';
import { config } from '../config/index.js';
import { fetchIssues } from '../github/issues.js';
import { READY_LABEL } from '../github/issue-labels.js';
import { getConfiguredRepository } from '../github/repository.js';
import { jobQueue } from './queue.js';
import { createPrepareRunPayload } from './prepare-run.js';
import { createJobLogger } from './logger.js';
import { createRunFileSet, findActiveRunForIssue, initializeRunSummary, readRunSummary, resolveOrchestrationStorageRoot, } from './orchestration.js';
import { statusItem, updateRunStatus } from './status.js';
const LAST_POLL_KEY = 'github:intake:last-poll';
const LEGACY_LAST_POLL_KEY = 'github:issue-watcher:last-poll';
const PROCESSING_LOCK_TTL_SECONDS = Math.max(Math.ceil((config.codex?.timeoutMs ?? 300000) / 1000) * 2, Math.ceil(config.github.pollIntervalMs / 1000) * 2);
const redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password !== undefined && { password: config.redis.password }),
});
function processingLockKey(repository, issue) {
    return `github:intake:processing:${repository.owner}:${repository.repo}:${issue.number}`;
}
async function claimIssueForProcessing(repository, issue, runId) {
    const lockKey = processingLockKey(repository, issue);
    const result = await redisClient.set(lockKey, runId, 'EX', PROCESSING_LOCK_TTL_SECONDS, 'NX');
    return {
        claimed: result === 'OK',
        lockKey,
    };
}
export async function startIntake() {
    let connectionEstablishedByThisCall = false;
    if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
        await redisClient.connect();
        connectionEstablishedByThisCall = true;
    }
    try {
        const now = Date.now();
        const intakeJobData = {
            taskId: `intake-${now}`,
            type: 'intake',
            runId: `intake-${now}`,
            stage: 'intake',
            stageAttempt: 1,
            reworkAttempt: 0,
        };
        await jobQueue.add('intake', intakeJobData, {
            repeat: {
                every: config.github.pollIntervalMs,
            },
            jobId: 'intake-repeatable',
        });
    }
    catch (err) {
        if (connectionEstablishedByThisCall) {
            await redisClient.quit();
        }
        throw err;
    }
}
export async function intakeHandler(job) {
    const logger = createJobLogger(job);
    const storedTimestamp = await redisClient.get(LAST_POLL_KEY) ?? await redisClient.get(LEGACY_LAST_POLL_KEY);
    let sinceTimestamp;
    if (storedTimestamp) {
        const date = new Date(storedTimestamp);
        if (!Number.isNaN(date.getTime())) {
            sinceTimestamp = date.toISOString();
        }
    }
    const repository = getConfiguredRepository();
    const issues = await fetchIssues({
        labels: READY_LABEL,
        state: 'open',
        since: sinceTimestamp,
    });
    let eligibleIssueCount = 0;
    for (const issue of issues) {
        const orchestrationRoot = resolveOrchestrationStorageRoot();
        const activeRun = await findActiveRunForIssue(orchestrationRoot, repository, issue.number);
        if (activeRun) {
            logger.info(`Skipping issue #${issue.number}; active run ${activeRun.runId} is already processing it`);
            continue;
        }
        const payload = createPrepareRunPayload({ issue, repository });
        const claim = await claimIssueForProcessing(repository, issue, payload.runId);
        if (!claim.claimed) {
            continue;
        }
        eligibleIssueCount += 1;
        try {
            const runStartedAt = new Date().toISOString();
            if (!await readRunSummary(orchestrationRoot, payload.runId)) {
                const runFileSet = createRunFileSet(orchestrationRoot, payload.runId, new Date(runStartedAt));
                await initializeRunSummary(orchestrationRoot, runFileSet, {
                    runId: payload.runId,
                    status: 'running',
                    currentStage: 'prepare-run',
                    runStartedAt,
                    stageAttempt: payload.stageAttempt,
                    reworkAttempt: payload.reworkAttempt,
                    latestHandoffRecord: null,
                    initialContext: {
                        issue,
                        repository,
                    },
                    stages: {
                        intake: {
                            attempts: 1,
                            status: 'success',
                            updatedAt: runStartedAt,
                        },
                    },
                });
            }
            await updateRunStatus(orchestrationRoot, payload.runId, {
                heading: 'Blast Furnace is starting work',
                focus: 'Current focus: Prepare run',
                items: [
                    statusItem('task-pickup', 1, 'completed', 'Task picked up'),
                    statusItem('prepare-run', 1, 'pending', 'Prepare run'),
                ],
            }, logger);
            await jobQueue.add('prepare-run', payload);
        }
        catch (err) {
            await redisClient.del(claim.lockKey);
            throw err;
        }
    }
    logger.info(`GitHub intake fetched ${issues.length} issue(s); ${eligibleIssueCount} issue(s) eligible for processing`);
    await redisClient.set(LAST_POLL_KEY, new Date().toISOString());
}
export async function closeIntakeRedis() {
    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
        await redisClient.quit();
    }
}
