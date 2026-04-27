export declare function createGitCommandEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function createTempWorkingDir(prefix: string): Promise<string>;
export declare function cloneRepoInto(workingDir: string, remoteUrl: string, timeoutMs?: number): Promise<void>;
export declare function cleanupWorkingDir(workingDir: string): Promise<void>;
export declare function getRepoRemoteUrl(): string;
