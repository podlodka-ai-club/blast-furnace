import type { createJobLogger } from './logger.js';
export interface CodexCliArgsOptions {
    cliCmd: string;
    cliArgs: string[];
    prompt: string;
    model: string;
    resumeLastSession?: boolean;
    outputLastMessagePath?: string;
    enableHooks?: boolean;
    bypassSandbox?: boolean;
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}
export interface RunCodexSessionOptions {
    prompt: string;
    workspacePath: string;
    logger: ReturnType<typeof createJobLogger>;
    resumeLastSession?: boolean;
    outputLastMessage?: boolean;
    enableHooks?: boolean;
    bypassSandbox?: boolean;
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    env?: NodeJS.ProcessEnv;
    logPrefix: string;
    timeoutLabel: string;
}
export interface RunCodexSessionResult {
    cliCmd: string;
    cliArgs: string[];
    output: string;
}
export declare function buildCodexSessionArgs(options: CodexCliArgsOptions): string[];
export declare function stripAnsi(value: string): string;
export declare function runCodexSession(options: RunCodexSessionOptions): Promise<RunCodexSessionResult>;
