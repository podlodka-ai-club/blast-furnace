import { Queue, QueueEvents } from 'bullmq';
import { config } from '../config/index.js';
export const jobQueue = new Queue('agent-orchestrator', {
    connection: {
        host: config.redis.host,
        port: config.redis.port,
        ...(config.redis.password && { password: config.redis.password }),
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: {
            count: 100,
            age: 24 * 60 * 60,
        },
        removeOnFail: {
            count: 500,
            age: 7 * 24 * 60 * 60,
        },
    },
});
export const queueEvents = new QueueEvents('agent-orchestrator', {
    connection: {
        host: config.redis.host,
        port: config.redis.port,
        ...(config.redis.password && { password: config.redis.password }),
    },
});
export async function closeQueue() {
    await jobQueue.close();
    await queueEvents.close();
}
