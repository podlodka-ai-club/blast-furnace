import { buildServer, startServer } from './server/index.js';
import { config } from './config/index.js';
import { closeQueue, closeWorker, createWorker } from './jobs/index.js';
import { intakeHandler, startIntake, closeIntakeRedis } from './jobs/intake.js';
import { prepareRunHandler } from './jobs/prepare-run.js';
import { assessHandler } from './jobs/assess.js';
import { planHandler } from './jobs/plan.js';
import { developHandler } from './jobs/develop.js';
import { reviewHandler } from './jobs/review.js';
import { makePrHandler } from './jobs/make-pr.js';
import { syncTrackerStateHandler } from './jobs/sync-tracker-state.js';
import { prReworkIntakeHandler } from './jobs/pr-rework-intake.js';
let server;
let worker;
let isShuttingDown = false;
export async function multiHandler(job) {
    switch (job.data.type) {
        case 'intake':
            return intakeHandler(job);
        case 'prepare-run':
            return prepareRunHandler(job);
        case 'assess':
            return assessHandler(job);
        case 'plan':
            return planHandler(job);
        case 'develop':
            return developHandler(job);
        case 'review':
            return reviewHandler(job);
        case 'make-pr':
            return makePrHandler(job);
        case 'sync-tracker-state':
            return syncTrackerStateHandler(job);
        case 'pr-rework-intake':
            return prReworkIntakeHandler(job);
        default:
            throw new Error(`Unknown job type: ${job.data.type}`);
    }
}
async function main() {
    if (!config.github.token) {
        throw new Error('GITHUB_TOKEN environment variable is required');
    }
    if (!config.github.owner) {
        throw new Error('GITHUB_OWNER environment variable is required');
    }
    if (!config.github.repo) {
        throw new Error('GITHUB_REPO environment variable is required');
    }
    server = await buildServer({ logger: true });
    await startServer(server, config.port);
    await startIntake();
    worker = createWorker(multiHandler);
}
async function shutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    const timeout = setTimeout(() => {
        console.error('Shutdown timeout exceeded, forcing exit');
        process.exit(1);
    }, 10000);
    timeout.unref();
    let shutdownError;
    try {
        if (server) {
            await server.close();
        }
    }
    catch (err) {
        shutdownError = err instanceof Error ? err : new Error(String(err));
        console.error('Error closing server:', shutdownError);
    }
    try {
        if (worker) {
            await closeWorker(worker);
        }
    }
    catch (err) {
        shutdownError = err instanceof Error ? err : new Error(String(err));
        console.error('Error closing worker:', shutdownError);
    }
    try {
        await closeQueue();
    }
    catch (err) {
        shutdownError = err instanceof Error ? err : new Error(String(err));
        console.error('Error closing queue:', shutdownError);
    }
    try {
        await closeIntakeRedis();
    }
    catch (err) {
        shutdownError = err instanceof Error ? err : new Error(String(err));
        console.error('Error closing intake Redis:', shutdownError);
    }
    clearTimeout(timeout);
    process.exit(shutdownError ? 1 : 0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
