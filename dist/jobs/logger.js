import { createLogger } from '../utils/logger.js';
export function createJobLogger(job) {
    const jobId = job.id ?? 'unknown';
    const taskId = job.data?.taskId ?? 'unknown';
    const logger = createLogger({ jobId, taskId, component: 'worker' });
    return {
        info(message) {
            logger.info(message);
        },
        error(message) {
            logger.error(message);
        },
        warn(message) {
            logger.warn(message);
        },
        debug(message) {
            logger.debug(message);
        },
    };
}
