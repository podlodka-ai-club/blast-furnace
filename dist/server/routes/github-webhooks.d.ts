import { FastifyInstance, FastifyPluginOptions } from 'fastify';
interface GitHubWebhooksRouteOptions extends FastifyPluginOptions {
    skipSignatureValidation?: boolean;
}
export declare function githubWebhooksRoute(server: FastifyInstance, options: GitHubWebhooksRouteOptions): Promise<void>;
export default githubWebhooksRoute;
