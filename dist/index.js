import { buildServer, startServer } from './server/index.js';
import { config } from './config/index.js';
import { closeQueue, closeWorker, createWorker } from './jobs/index.js';
let server;
let worker;
let isShuttingDown = false;
async function placeholderProcessor(_job) {
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
    worker = createWorker(placeholderProcessor);
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
    try {
        if (server) {
            await server.close();
        }
    }
    catch (err) {
        console.error('Error closing server:', err);
    }
    try {
        if (worker) {
            await closeWorker(worker);
        }
    }
    catch (err) {
        console.error('Error closing worker:', err);
    }
    try {
        await closeQueue();
    }
    catch (err) {
        console.error('Error closing queue:', err);
    }
    clearTimeout(timeout);
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
