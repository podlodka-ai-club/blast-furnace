import type { AssessJobData, AssessOutput, DevelopJobData, DevelopOutput, DevelopmentResult, HandoffRecord, HandoffRecordDependency, InputRecordRef, MakePrJobData, PlanJobData, PlanOutput, PlanResult, PullRequestOutput, QualityGateResult, ReviewJobData, ReviewOutput, ReviewResult, StableRunContext, SyncTrackerStateJobData, WorkflowStage } from '../types/index.js';
export interface AssessContext {
    runContext: StableRunContext;
    prepareRun: unknown;
    inputRecord: HandoffRecord;
}
export interface PlanContext {
    runContext: StableRunContext;
    assessment: AssessOutput['assessment'];
    inputRecord: HandoffRecord<AssessOutput>;
}
export interface DevelopContext {
    runContext: StableRunContext;
    plan: Extract<PlanResult, {
        status: 'success';
    }>;
    inputRecord: HandoffRecord<PlanOutput>;
}
export interface ReviewContext {
    runContext: StableRunContext;
    plan: Extract<PlanResult, {
        status: 'success';
    }>;
    development: DevelopmentResult;
    quality: QualityGateResult & {
        status: 'passed';
    };
    inputRecord: HandoffRecord<DevelopOutput>;
    planRecord: HandoffRecord<PlanOutput>;
}
export interface MakePrContext {
    runContext: StableRunContext;
    plan: Extract<PlanResult, {
        status: 'success';
    }>;
    development: DevelopmentResult;
    quality: QualityGateResult & {
        status: 'passed';
    };
    review: ReviewResult;
    inputRecord: HandoffRecord<ReviewOutput>;
    developRecord: HandoffRecord<DevelopOutput>;
    planRecord: HandoffRecord<PlanOutput>;
}
export interface SyncTrackerStateContext {
    runContext: StableRunContext;
    pullRequest: PullRequestOutput['pullRequest'];
    inputRecord: HandoffRecord<PullRequestOutput>;
}
export declare function loadDependencyRecord<TOutput>(inputRecordRef: InputRecordRef, dependency: HandoffRecordDependency, expectedStage: Exclude<WorkflowStage, 'intake'>): Promise<HandoffRecord<TOutput>>;
export declare function resolveAssessContext(payload: AssessJobData): Promise<AssessContext>;
export declare function resolvePlanContext(payload: PlanJobData): Promise<PlanContext>;
export declare function resolveDevelopContext(payload: DevelopJobData): Promise<DevelopContext>;
export declare function resolveReviewContext(payload: ReviewJobData): Promise<ReviewContext>;
export declare function resolveMakePrContext(payload: MakePrJobData): Promise<MakePrContext>;
export declare function resolveSyncTrackerStateContext(payload: SyncTrackerStateJobData): Promise<SyncTrackerStateContext>;
