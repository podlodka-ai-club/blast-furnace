import type { HandoffRecord, InputRecordRef, StageHandoffJobPayload, StageJobPayload, WorkflowStage } from '../types/index.js';
type DownstreamStage = Exclude<WorkflowStage, 'intake' | 'prepare-run'>;
export declare function validateInputRecordRef(value: unknown): asserts value is InputRecordRef;
export declare function createForwardStagePayload<TStage extends DownstreamStage>(source: StageJobPayload, nextStage: TStage, inputRecordRef: InputRecordRef, stageAttempt?: number): StageHandoffJobPayload<TStage>;
export declare function validateStagePayload<TStage extends DownstreamStage>(expectedStage: TStage, payload: unknown): asserts payload is StageHandoffJobPayload<TStage>;
export declare function validateStageInputRecord(payload: StageHandoffJobPayload<DownstreamStage>, record: HandoffRecord): void;
export {};
