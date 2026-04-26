import { moveIssueToInReview } from '../github/issue-labels.js';
import { assertConfiguredRepository } from '../github/repository.js';
import { cleanupWorkingDir } from '../utils/working-dir.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { appendHandoffRecordAndUpdateSummary, readValidatedStageInputRecord, } from './orchestration.js';
async function readSyncTrackerStateInput(job) {
    stagePayloadSchemas['sync-tracker-state'].parse(job.data);
    const inputRecord = await readValidatedStageInputRecord(job.data);
    const makePrOutput = stageOutputSchemas['make-pr'].parse(inputRecord.output);
    if (makePrOutput.status !== 'pull-request-created') {
        throw new Error('Sync Tracker State requires a pull-request-created input record');
    }
    return makePrOutput;
}
export async function runSyncTrackerStateWork(job, logger = createJobLogger(job), context) {
    const { issue, repository, branchName, workspacePath, pullRequest } = context ?? await readSyncTrackerStateInput(job);
    assertConfiguredRepository(repository);
    logger.info(`Synchronizing tracker state for PR #${pullRequest.number} on branch ${branchName}`);
    let trackerLabels = [];
    try {
        trackerLabels = await moveIssueToInReview(issue.number);
        logger.info(`Issue #${issue.number} labels updated: ${trackerLabels.join(', ')}`);
    }
    catch (err) {
        logger.warn(`Failed to update labels for issue #${issue.number}: ${err}`);
    }
    const output = stageOutputSchemas['sync-tracker-state'].parse({
        ...(context ?? await readSyncTrackerStateInput(job)),
        status: 'tracker-synced',
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        trackerLabels,
    });
    await appendHandoffRecordAndUpdateSummary(workspacePath, {
        runId: job.data.runId,
        fromStage: 'sync-tracker-state',
        toStage: null,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: job.data.inputRecordRef,
        status: 'success',
        output,
    }, 'completed');
    return pullRequest;
}
export async function runSyncTrackerStateFlow(job) {
    const logger = createJobLogger(job);
    let workspacePath = null;
    try {
        const context = await readSyncTrackerStateInput(job);
        workspacePath = context.workspacePath;
        await runSyncTrackerStateWork(job, logger, context);
    }
    finally {
        if (workspacePath) {
            logger.info(`Cleaning up temp working directory: ${workspacePath}`);
            await cleanupWorkingDir(workspacePath);
        }
    }
}
export const syncTrackerStateHandler = runSyncTrackerStateFlow;
