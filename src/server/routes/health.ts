import { FastifyInstance, FastifyPluginOptions } from 'fastify';

interface HealthRouteOptions extends FastifyPluginOptions {
  startTime?: number;
}

export async function healthRoute(
  server: FastifyInstance,
  options: HealthRouteOptions
): Promise<void> {
  const startTime = options.startTime ?? Date.now();

  server.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async (_request, _reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });
}

export default healthRoute;