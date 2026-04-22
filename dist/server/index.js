import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
import { githubWebhooksRoute } from './routes/github-webhooks.js';
import { reposRoute } from './routes/repos.js';
import { reposUIRoute } from './routes/repos-ui.js';
import { config } from '../config/index.js';
export async function buildServer(options = {}) {
    const server = Fastify({
        logger: options.logger ?? true,
    });
    server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, rawBody, done) => {
        request.rawBody = rawBody;
        try {
            const json = JSON.parse(rawBody.toString('utf-8'));
            done(null, json);
        }
        catch {
            const error = new Error('Invalid JSON payload');
            error.statusCode = 400;
            done(error, undefined);
        }
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
    if (config.github.issueStrategy === 'webhook') {
        await server.register(githubWebhooksRoute);
    }
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
