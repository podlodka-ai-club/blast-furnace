import { FastifyInstance, FastifyPluginOptions } from 'fastify';
interface ReposUIOptions extends FastifyPluginOptions {
    apiBaseUrl?: string;
}
export declare function reposUIRoute(server: FastifyInstance, options: ReposUIOptions): Promise<void>;
export default reposUIRoute;
