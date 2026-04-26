import type { Job } from 'bullmq';
import type { AssessJobData, AssessOutput, PlanJobData } from '../types/index.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  readValidatedStageInputRecord,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';

const STUB_ASSESSMENT = {
  status: 'stubbed',
  summary: 'Assessment deferred for this iteration.',
} as const;

export async function runAssessWork(job: Job<AssessJobData>): Promise<PlanJobData> {
  stagePayloadSchemas.assess.parse(job.data);
  const inputRecord = await readValidatedStageInputRecord(job.data);
  const prepared = stageOutputSchemas['prepare-run'].parse(inputRecord.output);
  const output = stageOutputSchemas.assess.parse({
    ...prepared,
    status: 'success',
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    assessment: STUB_ASSESSMENT,
  }) as AssessOutput;
  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'assess',
    toStage: 'plan',
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: job.data.inputRecordRef,
    status: 'success',
    output,
  });

  return createForwardStagePayload(job.data, 'plan', inputRecordRef) as PlanJobData;
}

export async function runAssessFlow(job: Job<AssessJobData>): Promise<void> {
  const logger = createJobLogger(job);

  const planJobData = await runAssessWork(job);
  const outputRecord = await readValidatedStageInputRecord(planJobData);
  const output = stageOutputSchemas.assess.parse(outputRecord.output);
  logger.info(`Assessing issue #${output.issue.number} for run ${job.data.runId}`);
  await scheduleNextJob(jobQueue, 'plan', planJobData);
  logger.info(`Plan job enqueued for branch: ${output.branchName}`);
}

export const assessHandler = runAssessFlow;
