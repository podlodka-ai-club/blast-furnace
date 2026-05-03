import type { AssessOutput, DevelopOutput, HandoffRecord, InputRecordRef, MakePrOutput, PlanOutput, PrReworkIntakeOutput, PrepareRunOutput, ReviewOutput, StageHandoffJobPayload, SyncTrackerStateOutput, WorkflowStage } from '../types/index.js';
export interface RuntimeSchema<T> {
    parse(value: unknown): T;
}
declare function parseAssessOutput(value: unknown): AssessOutput;
declare function parsePlanOutput(value: unknown): PlanOutput;
declare function parseDevelopOutput(value: unknown): DevelopOutput;
declare function parseReviewOutput(value: unknown): ReviewOutput;
declare function parseMakePrOutput(value: unknown): MakePrOutput;
declare function parseSyncTrackerStateOutput(value: unknown): SyncTrackerStateOutput;
declare function parsePrReworkIntakeOutput(value: unknown): PrReworkIntakeOutput;
export declare const inputRecordRefSchema: RuntimeSchema<InputRecordRef>;
export declare const runSummaryPointerSchema: RuntimeSchema<InputRecordRef>;
export declare const handoffRecordSchema: RuntimeSchema<HandoffRecord>;
export declare const stagePayloadSchemas: {
    readonly assess: RuntimeSchema<StageHandoffJobPayload<"assess">>;
    readonly plan: RuntimeSchema<StageHandoffJobPayload<"plan">>;
    readonly develop: RuntimeSchema<StageHandoffJobPayload<"develop">>;
    readonly review: RuntimeSchema<StageHandoffJobPayload<"review">>;
    readonly 'make-pr': RuntimeSchema<StageHandoffJobPayload<"make-pr">>;
    readonly 'sync-tracker-state': RuntimeSchema<StageHandoffJobPayload<"sync-tracker-state">>;
    readonly 'pr-rework-intake': RuntimeSchema<StageHandoffJobPayload<"pr-rework-intake">>;
};
export declare const stageOutputSchemas: {
    readonly 'prepare-run': {
        readonly parse: (value: unknown) => PrepareRunOutput;
    };
    readonly assess: {
        readonly parse: typeof parseAssessOutput;
    };
    readonly plan: {
        readonly parse: typeof parsePlanOutput;
    };
    readonly develop: {
        readonly parse: typeof parseDevelopOutput;
    };
    readonly review: {
        readonly parse: typeof parseReviewOutput;
    };
    readonly 'make-pr': {
        readonly parse: typeof parseMakePrOutput;
    };
    readonly 'sync-tracker-state': {
        readonly parse: typeof parseSyncTrackerStateOutput;
    };
    readonly 'pr-rework-intake': {
        readonly parse: typeof parsePrReworkIntakeOutput;
    };
};
export declare function parseStageOutput(stage: Exclude<WorkflowStage, 'intake'>, value: unknown): unknown;
export {};
