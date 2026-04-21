import { buildServer, startServer } from './server/index.js';
import { config } from './config/index.js';
import { closeQueue, closeWorker, createWorker } from './jobs/index.js';
let server;
let worker;
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
main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
const signals = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
    process.on(signal, async () => {
        console.log(`Received ${signal}, shutting down gracefully...`);
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
        process.exit(0);
    });
}
