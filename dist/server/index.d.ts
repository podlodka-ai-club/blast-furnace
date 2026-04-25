import { FastifyInstance } from 'fastify';
import type { ServerOptions } from '../types/index.js';
export type { ServerOptions };
export declare function buildServer(options?: ServerOptions): Promise<FastifyInstance>;
export declare function startServer(server: FastifyInstance, port?: number, host?: string): Promise<void>;
