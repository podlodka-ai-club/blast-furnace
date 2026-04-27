import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, readValidatedStageInputRecord, scheduleNextJob, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
const STUB_PLAN = {
    status: 'stubbed',
    summary: 'Planning deferred for this iteration.',
};
export async function runPlanWork(job) {
    stagePayloadSchemas.plan.parse(job.data);
    const inputRecord = await readValidatedStageInputRecord(job.data);
    const assessed = stageOutputSchemas.assess.parse(inputRecord.output);
    const output = stageOutputSchemas.plan.parse({
        ...assessed,
        status: 'success',
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        plan: STUB_PLAN,
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(output.workspacePath, {
        runId: job.data.runId,
        fromStage: 'plan',
        toStage: 'develop',
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: job.data.inputRecordRef,
        status: 'success',
        output,
    });
    return createForwardStagePayload(job.data, 'develop', inputRecordRef);
}
export async function runPlanFlow(job) {
    const logger = createJobLogger(job);
    const developJobData = await runPlanWork(job);
    const outputRecord = await readValidatedStageInputRecord(developJobData);
    const output = stageOutputSchemas.plan.parse(outputRecord.output);
    logger.info(`Planning issue #${output.issue.number} on branch ${output.branchName}`);
    await scheduleNextJob(jobQueue, 'develop', developJobData);
    logger.info(`Develop job enqueued for branch: ${output.branchName}`);
}
export const processPlan = runPlanFlow;
export const planHandler = processPlan;
