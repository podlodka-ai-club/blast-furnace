import type { QualityGateResult } from '../types/index.js';
export interface DevelopStopHookState {
    attempts: number;
    blockedFailureCount: number;
    active: boolean;
    outputPaths: string[];
    lastQualityResult?: QualityGateResult;
}
export interface PrepareDevelopStopHookOptions {
    runId: string;
    runDir: string;
    workspacePath: string;
    qualityGateCommand?: string;
    qualityGateTimeoutMs: number;
}
export interface PreparedDevelopStopHook {
    runDir: string;
    statePath: string;
    scriptPath: string;
    hookConfigPath: string;
    hookCommand: string;
    hookTimeoutSeconds: number;
    env: NodeJS.ProcessEnv;
    readFinalQualityResult(): Promise<QualityGateResult | undefined>;
}
export interface DevelopStopHookInput {
    statePath: string;
    runDir: string;
    workspacePath: string;
    qualityGateCommand?: string;
    qualityGateTimeoutMs: number;
    hookInput?: {
        stop_hook_active?: boolean;
    };
}
export type StopHookDecision = {
    decision: 'allow';
} | {
    decision: 'block';
    reason: string;
};
export declare function readDevelopStopHookState(statePath: string): Promise<DevelopStopHookState>;
export declare function writeDevelopStopHookState(statePath: string, state: DevelopStopHookState): Promise<void>;
export declare function prepareDevelopStopHook(options: PrepareDevelopStopHookOptions): Promise<PreparedDevelopStopHook>;
export declare function handleDevelopStopHook(input: DevelopStopHookInput): Promise<StopHookDecision>;
