import { buildServer, startServer } from './server/index.js';

const server = await buildServer({ logger: true });
await startServer(server);