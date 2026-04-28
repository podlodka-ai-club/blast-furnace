import type { QualityGateResult, QualityGateStatus } from '../types/index.js';
export interface QualityGateRunOptions {
    command?: string;
    timeoutMs: number;
    workspacePath: string;
    runDir: string;
    attempt: number;
    env?: NodeJS.ProcessEnv;
}
export interface QualityGateSummaryInput {
    command: string;
    status: QualityGateStatus;
    exitCode?: number;
    durationMs: number;
    stdout: string;
    stderr: string;
}
export declare function extractFailingTestNames(output: string, maxNames?: number): string[];
export declare function summarizeQualityGateOutput(input: QualityGateSummaryInput): string;
export declare function runQualityGate(options: QualityGateRunOptions): Promise<QualityGateResult>;
