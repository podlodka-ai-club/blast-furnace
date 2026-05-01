import type { Job } from 'bullmq';
import type { PrReworkIntakeJobData, SyncTrackerStateJobData, SyncTrackerStateOutput } from '../types/index.js';
import { moveIssueToInReview } from '../github/issue-labels.js';
import { removeReworkLabelFromPullRequest } from '../github/pullRequests.js';
import { assertConfiguredRepository } from '../github/repository.js';
import { cleanupWorkingDir } from '../utils/working-dir.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveSyncTrackerStateContext, type SyncTrackerStateContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import {
  appendHandoffRecordAndUpdateSummary,
  readRunSummary,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { jobQueue } from './queue.js';
import { createForwardStagePayload } from './stage-payloads.js';
import { statusItem, updateRunStatus } from './status.js';

async function readSyncTrackerStateInput(job: Job<SyncTrackerStateJobData>): Promise<SyncTrackerStateContext> {
  stagePayloadSchemas['sync-tracker-state'].parse(job.data);
  return resolveSyncTrackerStateContext(job.data);
}

export async function runSyncTrackerStateWork(
  job: Job<SyncTrackerStateJobData>,
  logger = createJobLogger(job),
  context?: SyncTrackerStateContext
): Promise<SyncTrackerStateContext['pullRequest']> {
  const resolvedContext = context ?? await readSyncTrackerStateInput(job);
  const { issue, repository, branchName } = resolvedContext.runContext;
  const { pullRequest } = resolvedContext;
  assertConfiguredRepository(repository);
  const isReworkFinalization = job.data.reworkAttempt > 0;

  logger.info(`Synchronizing tracker state for PR #${pullRequest.number} on branch ${branchName}`);
  let trackerLabels: string[] = [];
  const trackerWarnings: string[] = [];
  if (isReworkFinalization) {
    try {
      await removeReworkLabelFromPullRequest(pullRequest.number);
      logger.info(`Removed Rework label from PR #${pullRequest.number}`);
    } catch (err) {
      trackerWarnings.push(`Removing the \`Rework\` label from pull request #${pullRequest.number} failed.`);
      logger.warn(`Failed to remove Rework label from PR #${pullRequest.number}: ${err}`);
    }
  }

  try {
    trackerLabels = await moveIssueToInReview(issue.number);
    logger.info(`Issue #${issue.number} labels updated: ${trackerLabels.join(', ')}`);
  } catch (err) {
    trackerWarnings.push(
      `Pull request #${pullRequest.number} was ${isReworkFinalization ? 'finalized' : 'created'}, but moving the issue to \`in review\` failed.`
    );
    logger.warn(`Failed to update labels for issue #${issue.number}: ${err}`);
  }
  const trackerWarning = trackerWarnings.length > 0 ? trackerWarnings.join(' ') : undefined;

  const output = stageOutputSchemas['sync-tracker-state'].parse({
    status: 'tracker-synced',
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    trackerLabels,
    ...(trackerWarning !== undefined && { trackerWarning }),
  }) as SyncTrackerStateOutput;
  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'sync-tracker-state',
    toStage: 'pr-rework-intake',
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: [job.data.inputRecordRef],
    status: 'success',
    output,
  });
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: isReworkFinalization
      ? 'Blast Furnace finalized PR rework'
      : 'Blast Furnace created a pull request',
    focus: isReworkFinalization
      ? `Result: Pull request #${pullRequest.number} updated`
      : `Result: Pull request #${pullRequest.number} created`,
    note: trackerWarning,
    items: [
      statusItem(
        'draft-pr-and-in-review',
        1,
        'completed',
        'Make PR',
        trackerWarning
          ? 'PR tracker synchronization warning'
          : 'PR ready for review'
      ),
    ],
  }, logger);

  return pullRequest;
}

async function enqueuePrReworkIntake(job: Job<SyncTrackerStateJobData>): Promise<void> {
  const root = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  const summary = await readRunSummary(root, job.data.runId);
  const inputRecordRef = summary?.latestHandoffRecord;
  if (!inputRecordRef || inputRecordRef.stage !== 'sync-tracker-state') {
    throw new Error('Sync Tracker State handoff record not found for PR Rework Intake');
  }
  const payload = createForwardStagePayload(
    job.data,
    'pr-rework-intake',
    inputRecordRef,
    job.data.stageAttempt
  ) as PrReworkIntakeJobData;
  await scheduleNextJob(jobQueue, 'pr-rework-intake', payload);
}

export async function runSyncTrackerStateFlow(job: Job<SyncTrackerStateJobData>): Promise<void> {
  const logger = createJobLogger(job);
  let workspacePath: string | null = null;
  let shouldEnqueuePrReworkIntake = false;

  try {
    const context = await readSyncTrackerStateInput(job);
    workspacePath = context.runContext.workspacePath;
    await runSyncTrackerStateWork(job, logger, context);
    shouldEnqueuePrReworkIntake = true;
  } finally {
    if (workspacePath) {
      logger.info(`Cleaning up temp working directory: ${workspacePath}`);
      await cleanupWorkingDir(workspacePath);
    }
  }

  if (shouldEnqueuePrReworkIntake) {
    await enqueuePrReworkIntake(job);
  }
}

export const syncTrackerStateHandler = runSyncTrackerStateFlow;
