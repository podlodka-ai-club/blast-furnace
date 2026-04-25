import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { createJobLogger } from './logger.js';
export function createWorker(processor, options = {}) {
    const worker = new Worker('agent-orchestrator', processor, {
        connection: {
            host: config.redis.host,
            port: config.redis.port,
            ...(config.redis.password !== undefined && { password: config.redis.password }),
        },
        concurrency: options.concurrency ?? 5,
        stalledInterval: 60000,
    });
    worker.on('active', (job) => {
        const logger = createJobLogger(job);
        logger.info(`Job ${job.id} started processing`);
    });
    worker.on('completed', (job) => {
        const logger = createJobLogger(job);
        logger.info(`Job ${job.id} completed successfully`);
    });
    worker.on('failed', (job, err) => {
        if (!job)
            return;
        const logger = createJobLogger(job);
        logger.error(`Job ${job.id} failed: ${err.message}`);
    });
    worker.on('progress', (job, progress) => {
        try {
            const logger = createJobLogger(job);
            logger.info(`Job ${job.id} progress: ${JSON.stringify(progress)}`);
        }
        catch (err) {
            const logger = createLogger({ component: 'worker' });
            logger.warn(`Job ${job?.id} progress serialization error: ${err}`);
        }
    });
    worker.on('stalled', (jobId) => {
        const logger = createLogger({ component: 'worker', jobId });
        logger.warn(`Job ${jobId} stalled and will be retried`);
    });
    worker.on('error', (err) => {
        const logger = createLogger({ component: 'worker' });
        logger.error(`Worker error: ${err.message}`);
    });
    return worker;
}
export async function closeWorker(worker) {
    await worker.close();
}
