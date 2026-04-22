import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
import { githubWebhooksRoute } from './routes/github-webhooks.js';
import { config } from '../config/index.js';
import type { ServerOptions } from '../types/index.js';

export type { ServerOptions };

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger ?? true,
  });

  // Add content type parser to preserve raw body for webhook signature validation
  // GitHub computes HMAC over the exact raw bytes, so we need to preserve them
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, rawBody, done) => {
      // Store raw body on request for webhook signature validation
      (request as unknown as { rawBody: Buffer }).rawBody = rawBody;
      try {
        const json = JSON.parse(rawBody.toString('utf-8'));
        done(null, json);
      } catch {
        // Create error with statusCode for proper 400 response
        const error = new Error('Invalid JSON payload');
        (error as Error & { statusCode: number }).statusCode = 400;
        done(error, undefined);
      }
    }
  );

  // Register CORS plugin - origin defaults to true for development
  // Set CORS_ORIGIN environment variable to comma-separated list of allowed origins
  // Use CORS_ORIGIN=* for wildcard (all origins allowed)
  const corsOrigin = process.env['CORS_ORIGIN'] ?? true;
  let originArray: boolean | string[];
  if (corsOrigin === '*') {
    originArray = true;
  } else if (typeof corsOrigin === 'string') {
    originArray = corsOrigin.split(',').map((s) => s.trim());
  } else {
    originArray = corsOrigin;
  }

  await server.register(cors, {
    origin: originArray,
    credentials: false,
  });

  // Register health check route with server start time for accurate uptime
  const startTime = Date.now();
  await server.register(healthRoute, { startTime });

  // Register GitHub webhooks route when webhook strategy is configured
  if (config.github.issueStrategy === 'webhook') {
    await server.register(githubWebhooksRoute);
  }

  return server;
}

export async function startServer(server: FastifyInstance, port: number = 3000, host: string = '0.0.0.0'): Promise<void> {
  try {
    await server.listen({ port, host });
    server.log.info(`Server listening on ${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    throw err;
  }
}