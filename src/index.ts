import { buildServer, startServer } from './server/index.js';
import { config } from './config/index.js';

const server = await buildServer({ logger: true });
await startServer(server, config.port);