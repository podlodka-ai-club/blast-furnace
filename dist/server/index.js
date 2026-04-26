import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
import { reposRoute } from './routes/repos.js';
import { reposUIRoute } from './routes/repos-ui.js';
export async function buildServer(options = {}) {
    const server = Fastify({
        logger: options.logger ?? true,
    });
    const corsOrigin = process.env['CORS_ORIGIN'] ?? true;
    let originArray;
    if (corsOrigin === '*') {
        originArray = true;
    }
    else if (typeof corsOrigin === 'string') {
        originArray = corsOrigin.split(',').map((s) => s.trim());
    }
    else {
        originArray = corsOrigin;
    }
    await server.register(cors, {
        origin: originArray,
        credentials: false,
    });
    const startTime = Date.now();
    await server.register(healthRoute, { startTime });
    await server.register(reposRoute);
    await server.register(async (instance) => {
        await instance.register(reposUIRoute);
    }, { prefix: '/repos/manage' });
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
