import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
import type { ServerOptions } from '../types/index.js';

export type { ServerOptions };

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger ?? true,
  });

  // Register CORS plugin
  await server.register(cors, {
    origin: true,
    credentials: false,
  });

  // Register health check route
  await server.register(healthRoute);

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