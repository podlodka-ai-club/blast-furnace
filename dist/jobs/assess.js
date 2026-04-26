import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
const STUB_ASSESSMENT = {
    status: 'stubbed',
    summary: 'Assessment deferred for this iteration.',
};
export async function runAssessWork(job) {
    return createForwardStagePayload(job.data, 'plan', {
        assessment: STUB_ASSESSMENT,
    });
}
export async function runAssessFlow(job) {
    const logger = createJobLogger(job);
    logger.info(`Assessing issue #${job.data.issue.number} for run ${job.data.runId}`);
    const planJobData = await runAssessWork(job);
    await scheduleNextJob(jobQueue, 'plan', planJobData);
    logger.info(`Plan job enqueued for branch: ${planJobData.branchName}`);
}
export const assessHandler = runAssessFlow;
