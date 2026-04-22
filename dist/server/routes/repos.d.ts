import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import Redis from 'ioredis';
import type { GitHubRepo } from '../../types/index.js';
interface RepoRouteOptions extends FastifyPluginOptions {
    redisClient?: Redis;
}
export declare function setRedisClient(client: Redis): void;
export declare function addRepo(owner: string, repo: string): Promise<{
    added: boolean;
    repo?: GitHubRepo;
}>;
export declare function listRepos(): Promise<GitHubRepo[]>;
export declare function removeRepo(owner: string, repo: string): Promise<boolean>;
export declare function repoExists(owner: string, repo: string): Promise<boolean>;
export declare function reposRoute(server: FastifyInstance, options: RepoRouteOptions): Promise<void>;
export default reposRoute;
