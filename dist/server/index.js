import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
export async function buildServer(options = {}) {
    const server = Fastify({
        logger: options.logger ?? true,
    });
    await server.register(cors, {
        origin: true,
        credentials: false,
    });
    await server.register(healthRoute);
    return server;
}
export async function startServer(server, port = 3000, host = '0.0.0.0') {
    try {
        await server.listen({ port, host });
        server.log.info(`Server listening on ${host}:${port}`);
    }
    catch (err) {
        server.log.error(err);
        throw err;
    }
}
