import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
const STUB_PLAN = {
    status: 'stubbed',
    summary: 'Planning deferred for this iteration.',
};
export async function runPlanWork(job) {
    return createForwardStagePayload(job.data, 'develop', {
        plan: STUB_PLAN,
    });
}
export async function runPlanFlow(job) {
    const logger = createJobLogger(job);
    logger.info(`Planning issue #${job.data.issue.number} on branch ${job.data.branchName}`);
    const developJobData = await runPlanWork(job);
    await scheduleNextJob(jobQueue, 'develop', developJobData);
    logger.info(`Develop job enqueued for branch: ${developJobData.branchName}`);
}
export const processPlan = runPlanFlow;
export const planHandler = processPlan;
