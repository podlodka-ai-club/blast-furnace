import { FastifyInstance, FastifyPluginOptions } from 'fastify';
interface HealthRouteOptions extends FastifyPluginOptions {
    startTime?: number;
}
export declare function healthRoute(server: FastifyInstance, options: HealthRouteOptions): Promise<void>;
export default healthRoute;
