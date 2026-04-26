import type { RepositoryIdentity } from '../types/index.js';
export declare function getConfiguredRepository(): RepositoryIdentity;
export declare function isConfiguredRepository(repository: RepositoryIdentity): boolean;
export declare function assertConfiguredRepository(repository: RepositoryIdentity): void;
