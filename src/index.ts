import { buildServer, startServer } from './server/index.js';
import { config } from './config/index.js';
import { closeQueue } from './jobs/index.js';

async function main(): Promise<void> {
  const server = await buildServer({ logger: true });
  await startServer(server, config.port);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Handle shutdown signals
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down...`);
    await closeQueue();
    process.exit(0);
  });
}