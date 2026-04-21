import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function healthRoute(
  server: FastifyInstance,
  _options: FastifyPluginOptions
): Promise<void> {
  server.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, _reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });
}

export default healthRoute;