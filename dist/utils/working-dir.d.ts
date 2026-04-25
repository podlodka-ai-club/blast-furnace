export declare function createTempWorkingDir(prefix: string): Promise<string>;
export declare function cloneRepoInto(workingDir: string, remoteUrl: string): Promise<void>;
export declare function cleanupWorkingDir(workingDir: string): Promise<void>;
export declare function getRepoRemoteUrl(): string;
