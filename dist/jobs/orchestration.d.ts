import type { ArtifactLocation, ArtifactMetadata, EventMetadata, HandoffRecord, HandoffRecordDependency, HandoffStatus, InputRecordRef, JobPayload, RepositoryIdentity, RunId, RunFileSet, RunSummaryData, StableRunContext, StageHandoffJobPayload, StageAttemptLocation, WorkflowStage } from '../types/index.js';
export interface QueueLike {
    add(name: string, data: JobPayload): Promise<unknown>;
}
export declare function resolveRunDirectory(root: string, runId: RunId): string;
export declare function resolveOrchestrationStorageRoot(ref?: InputRecordRef): string;
export declare function formatRunTimestamp(date?: Date): string;
export declare function createRunFileSet(root: string, runId: RunId, date?: Date): RunFileSet;
export declare function resolveRunFileSet(root: string, runId: RunId, timestampPrefix: string): RunFileSet;
export declare function resolveRunFileSetFromSummary(summary: RunSummaryData): RunFileSet;
export declare function resolveStageAttemptDirectory(root: string, location: StageAttemptLocation): string;
export declare function resolveArtifactPath(root: string, location: ArtifactLocation): string;
export declare function resolveEventPath(root: string, runId: RunId, eventName: string): string;
export declare function resolveRunSummaryPath(root: string, runId: RunId): string;
export declare function writeArtifactFile(root: string, location: ArtifactLocation, data: unknown): Promise<ArtifactMetadata>;
export declare function writeEventFile(root: string, runId: RunId, eventName: string, data: unknown): Promise<EventMetadata>;
export declare function readRunSummary(root: string, runId: RunId): Promise<RunSummaryData | null>;
export declare function findActiveRunForIssue(root: string, repository: RepositoryIdentity, issueNumber: number): Promise<RunSummaryData | null>;
export declare function writeRunSummary(root: string, summary: RunSummaryData): Promise<void>;
export declare function initializeRunSummary(root: string, fileSet: RunFileSet, summary: Omit<RunSummaryData, 'timestampPrefix' | 'runDirectory' | 'runSummaryPath' | 'handoffLedgerPath'>): Promise<RunSummaryData>;
export interface AppendHandoffRecordInput {
    runId: RunId;
    fromStage: WorkflowStage;
    toStage: WorkflowStage | null;
    stageAttempt: number;
    reworkAttempt: number;
    dependsOn?: Array<InputRecordRef | HandoffRecordDependency>;
    status: HandoffStatus;
    output: unknown;
    createdAt?: string;
}
export interface AppendHandoffRecordResult {
    record: HandoffRecord;
    inputRecordRef: InputRecordRef;
}
export declare function readHandoffRecords(handoffPath: string): Promise<HandoffRecord[]>;
export declare function readHandoffRecord(ref: InputRecordRef): Promise<HandoffRecord>;
export declare function appendHandoffRecord(root: string, input: AppendHandoffRecordInput): Promise<AppendHandoffRecordResult>;
type DownstreamStage = Exclude<WorkflowStage, 'intake' | 'prepare-run'>;
export declare function readValidatedStageInputRecord(payload: StageHandoffJobPayload<DownstreamStage>): Promise<HandoffRecord>;
export declare function appendHandoffRecordAndUpdateSummary(root: string, input: AppendHandoffRecordInput, runStatus?: string): Promise<AppendHandoffRecordResult>;
export declare function validateHandoffRecord(record: HandoffRecord): void;
export declare function updateRunSummary(root: string, runId: RunId, update: (summary: RunSummaryData) => RunSummaryData): Promise<RunSummaryData>;
export declare function updateRunSummaryForHandoff(root: string, record: HandoffRecord, ref: InputRecordRef, status?: string): Promise<RunSummaryData>;
export declare function updateStableRunContext(root: string, runId: RunId, stableContext: StableRunContext): Promise<RunSummaryData>;
export declare function scheduleNextJob<TData extends JobPayload>(queue: QueueLike, jobName: TData['type'], data: TData): Promise<unknown>;
export {};
