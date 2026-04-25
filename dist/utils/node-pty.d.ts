export interface WarnLogger {
    warn(message: string): void;
}
export declare function getNodePtySpawnHelperPath(): string | null;
export declare function ensureExecutable(filePath: string, logger?: WarnLogger): Promise<boolean>;
export declare function ensureNodePtySpawnHelperExecutable(logger?: WarnLogger): Promise<void>;
