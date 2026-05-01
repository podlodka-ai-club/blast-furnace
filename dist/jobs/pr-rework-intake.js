import { config } from '../config/index.js';
import { createIssueComment } from '../github/comments.js';
import { getPullRequestState, listPullRequestComments, listPullRequestReviewComments, removeReworkLabelFromPullRequest, } from '../github/pullRequests.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { jobQueue } from './queue.js';
import { buildPrReworkCommentsMarkdown } from './pr-rework-comments.js';
import { appendHandoffRecordAndUpdateSummary, readHandoffRecords, readRunSummary, resolveOrchestrationStorageRoot, scheduleNextJob, updateRunSummary, updateRunSummaryPendingNextStage, } from './orchestration.js';
function pullRequestFromRecordOutput(output) {
    if (typeof output === 'object'
        && output !== null
        && 'pullRequest' in output
        && typeof output.pullRequest === 'object'
        && output.pullRequest !== null
        && 'number' in output.pullRequest
        && 'htmlUrl' in output.pullRequest) {
        return {
            number: Number(output.pullRequest.number),
            htmlUrl: String(output.pullRequest.htmlUrl),
        };
    }
    return null;
}
function selectedRoute(analysis) {
    return analysis.split(/\r?\n/, 1)[0] === 'ROUTE: DEVELOP' ? 'develop' : 'plan';
}
async function enqueueNextPoll(job) {
    await jobQueue.add('pr-rework-intake', job.data, { delay: config.github.pollIntervalMs });
}
function createPrepareRunPayload(job, summary, inputRecordRef, stageAttempt, reworkAttempt) {
    if (!summary.stableContext) {
        throw new Error('Run summary must include stable context before Prepare Run recovery');
    }
    return {
        taskId: job.data.taskId,
        type: 'prepare-run',
        runId: job.data.runId,
        stage: 'prepare-run',
        stageAttempt,
        reworkAttempt,
        issue: summary.stableContext.issue,
        repository: summary.stableContext.repository,
        inputRecordRef,
    };
}
async function enqueuePrepareRunAndClearPending(root, job, summary, inputRecordRef, stageAttempt, reworkAttempt) {
    await scheduleNextJob(jobQueue, 'prepare-run', createPrepareRunPayload(job, summary, inputRecordRef, stageAttempt, reworkAttempt));
    await updateRunSummaryPendingNextStage(root, job.data.runId, null);
}
function terminalOutput(job, status, pullRequest, commentsMarkdown) {
    return stageOutputSchemas['pr-rework-intake'].parse({
        status,
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        pullRequest,
        ...(commentsMarkdown !== undefined && { commentsMarkdown }),
    });
}
async function appendTerminal(job, output, runStatus) {
    const root = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    await appendHandoffRecordAndUpdateSummary(root, {
        runId: job.data.runId,
        fromStage: 'pr-rework-intake',
        toStage: null,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: [job.data.inputRecordRef],
        status: output.status === 'pull-request-merged' ? 'success' : 'failure',
        output,
    }, runStatus);
}
async function latestPullRequest(job) {
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    for (const record of [...records].reverse()) {
        const pullRequest = pullRequestFromRecordOutput(record.output);
        if (pullRequest)
            return pullRequest;
    }
    throw new Error('Pull request identity not found in handoff ledger');
}
function isAcceptedPlanRecord(record) {
    const output = record.output;
    return (record.fromStage === 'plan'
        && record.status === 'success'
        && typeof output === 'object'
        && output !== null
        && 'plan' in output
        && typeof output.plan === 'object'
        && output.plan !== null
        && 'status' in output.plan
        && output.plan.status === 'success');
}
async function latestAcceptedPlanRecord(job) {
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    const record = [...records].reverse().find(isAcceptedPlanRecord);
    if (!record) {
        throw new Error('Latest accepted Plan record not found for PR rework');
    }
    return record;
}
function isReworkRouteRecord(record) {
    return record.fromStage === 'pr-rework-intake'
        && record.toStage === 'prepare-run'
        && record.status === 'rework-needed';
}
async function previousReworkRouteRecord(job) {
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    return [...records].reverse().find(isReworkRouteRecord) ?? null;
}
async function recoverPendingNextStage(root, job, summary) {
    const pending = summary.pendingNextStage;
    if (!pending || pending.stage !== 'prepare-run') {
        return false;
    }
    await enqueuePrepareRunAndClearPending(root, job, summary, pending.inputRecordRef, pending.stageAttempt, pending.reworkAttempt);
    return true;
}
async function recoverExistingRouteHandoff(root, job, summary) {
    const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
    const existing = [...records].reverse().find((record) => (record.fromStage === 'pr-rework-intake'
        && record.toStage === 'prepare-run'
        && record.status === 'rework-needed'
        && record.dependsOn.includes(job.data.inputRecordRef.recordId)));
    if (!existing)
        return false;
    await enqueuePrepareRunAndClearPending(root, job, summary, {
        runDir: job.data.inputRecordRef.runDir,
        handoffPath: job.data.inputRecordRef.handoffPath,
        recordId: existing.recordId,
        sequence: existing.sequence,
        stage: 'pr-rework-intake',
    }, existing.stageAttempt, existing.reworkAttempt);
    return true;
}
export async function runPrReworkIntakeWork(job, dependencies = {}) {
    stagePayloadSchemas['pr-rework-intake'].parse(job.data);
    const root = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    const summary = await readRunSummary(root, job.data.runId);
    if (!summary?.stableContext) {
        throw new Error('Run summary must include stable context before PR Rework Intake');
    }
    if (summary.prReworkIntakeInProgress) {
        return;
    }
    if (await recoverPendingNextStage(root, job, summary)) {
        return;
    }
    if (await recoverExistingRouteHandoff(root, job, summary)) {
        return;
    }
    const pullRequest = await latestPullRequest(job);
    const prState = await getPullRequestState(pullRequest.number);
    const pullRequestIdentity = {
        number: pullRequest.number,
        htmlUrl: pullRequest.htmlUrl,
    };
    if (prState.merged) {
        await appendTerminal(job, terminalOutput(job, 'pull-request-merged', pullRequestIdentity), 'completed');
        return;
    }
    if (prState.state === 'closed') {
        await appendTerminal(job, terminalOutput(job, 'pull-request-closed-without-merge', pullRequestIdentity), 'terminated');
        return;
    }
    if (!prState.labels.includes('Rework')) {
        await enqueueNextPoll(job);
        return;
    }
    const nextReworkAttempt = job.data.reworkAttempt + 1;
    if (nextReworkAttempt + 1 > config.rework.maxHumanReworkAttempts) {
        await createIssueComment(summary.stableContext.issue.number, 'Blast Furnace stopped because there were too many reworks.');
        await appendTerminal(job, terminalOutput(job, 'too-many-reworks', pullRequestIdentity), 'terminated');
        return;
    }
    const [reviewComments, pullRequestComments] = await Promise.all([
        listPullRequestReviewComments(pullRequest.number),
        listPullRequestComments(pullRequest.number),
    ]);
    const latestPlan = await latestAcceptedPlanRecord(job);
    const previousRework = await previousReworkRouteRecord(job);
    const commentsMarkdown = buildPrReworkCommentsMarkdown({
        reviewComments,
        pullRequestComments,
        since: previousRework?.createdAt,
    });
    if (commentsMarkdown.length === 0) {
        await removeReworkLabelFromPullRequest(pullRequest.number);
        await createIssueComment(summary.stableContext.issue.number, 'Blast Furnace found the Rework label, but no review comments were found.');
        await appendHandoffRecordAndUpdateSummary(root, {
            runId: job.data.runId,
            fromStage: 'pr-rework-intake',
            toStage: null,
            stageAttempt: job.data.stageAttempt,
            reworkAttempt: job.data.reworkAttempt,
            dependsOn: [job.data.inputRecordRef],
            status: 'success',
            output: terminalOutput(job, 'no-comments-found', pullRequestIdentity),
        }, 'running');
        await enqueueNextPoll(job);
        return;
    }
    const routeAnalysis = await (dependencies.analyzeRoute?.(commentsMarkdown) ?? Promise.resolve('ROUTE: PLAN'));
    const selectedNextStage = selectedRoute(routeAnalysis);
    await updateRunSummary(root, job.data.runId, (current) => ({
        ...current,
        prReworkIntakeInProgress: {
            action: 'rework-route',
            inputRecordId: job.data.inputRecordRef.recordId,
        },
    }));
    const output = stageOutputSchemas['pr-rework-intake'].parse({
        status: 'rework-needed',
        runId: job.data.runId,
        stageAttempt: 1,
        reworkAttempt: nextReworkAttempt,
        pullRequest: pullRequestIdentity,
        commentsMarkdown,
        routeAnalysis,
        selectedNextStage,
        pullRequestHead: prState.head,
        latestPlanRecordId: latestPlan.recordId,
    });
    const handoff = await appendHandoffRecordAndUpdateSummary(root, {
        runId: job.data.runId,
        fromStage: 'pr-rework-intake',
        toStage: 'prepare-run',
        stageAttempt: 1,
        reworkAttempt: nextReworkAttempt,
        dependsOn: [
            job.data.inputRecordRef,
            latestPlan.recordId,
            ...(previousRework ? [previousRework.recordId] : []),
        ],
        status: 'rework-needed',
        output,
    }, 'running');
    await updateRunSummaryPendingNextStage(root, job.data.runId, {
        stage: 'prepare-run',
        inputRecordRef: handoff.inputRecordRef,
        stageAttempt: 1,
        reworkAttempt: nextReworkAttempt,
    });
    await enqueuePrepareRunAndClearPending(root, job, summary, handoff.inputRecordRef, 1, nextReworkAttempt);
    await updateRunSummary(root, job.data.runId, (current) => ({
        ...current,
        prReworkIntakeInProgress: null,
    }));
}
export async function prReworkIntakeHandler(job) {
    await runPrReworkIntakeWork(job);
}
