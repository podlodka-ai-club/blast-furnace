import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
import type { ServerOptions } from '../types/index.js';

export type { ServerOptions };

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger ?? true,
  });

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
