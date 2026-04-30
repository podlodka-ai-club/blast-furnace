import type { Job } from 'bullmq';
import type { AssessJobData, AssessOutput, PlanJobData } from '../types/index.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveAssessContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
import { statusItem, updateRunStatus } from './status.js';

const STUB_ASSESSMENT = {
  status: 'stubbed',
  summary: 'Assessment deferred for this iteration.',
} as const;

export async function runAssessWork(job: Job<AssessJobData>): Promise<PlanJobData> {
  stagePayloadSchemas.assess.parse(job.data);
  await resolveAssessContext(job.data);
  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: 'Blast Furnace is assessing the issue',
    focus: 'Current focus: Assess issue',
    items: [statusItem('assess', 1, 'in-progress', 'Assess issue', 'In progress')],
  });
  const output = stageOutputSchemas.assess.parse({
    status: 'success',
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    assessment: STUB_ASSESSMENT,
  }) as AssessOutput;
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'assess',
    toStage: 'plan',
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: [job.data.inputRecordRef],
    status: 'success',
    output,
  });
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: 'Blast Furnace is planning the solution',
    focus: 'Current focus: Plan solution',
    items: [
      statusItem('assess', 1, 'completed', 'Assess issue'),
      statusItem('plan', 1, 'pending', 'Plan solution'),
    ],
  });

  return createForwardStagePayload(job.data, 'plan', inputRecordRef) as PlanJobData;
}

export async function runAssessFlow(job: Job<AssessJobData>): Promise<void> {
  const logger = createJobLogger(job);

  const planJobData = await runAssessWork(job);
  logger.info(`Assessing run ${job.data.runId}`);
  await scheduleNextJob(jobQueue, 'plan', planJobData);
  logger.info(`Plan job enqueued for run: ${job.data.runId}`);
}

export const assessHandler = runAssessFlow;
