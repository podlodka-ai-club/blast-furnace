import type { AssessJobData, AssessOutput, DevelopJobData, DevelopOutput, DevelopmentResult, HandoffRecord, HandoffRecordDependency, InputRecordRef, MakePrOutput, MakePrJobData, PlanJobData, PlanOutput, PlanResult, PrepareRunOutput, PrReworkIntakeOutput, PullRequestIdentity, QualityGateResult, ReviewJobData, ReviewOutput, ReviewResult, StableRunContext, SyncTrackerStateJobData, WorkflowStage } from '../types/index.js';
export interface AssessContext {
    runContext: StableRunContext;
    prepareRun: unknown;
    inputRecord: HandoffRecord;
}
export interface PlanContext {
    runContext: StableRunContext;
    inputKind: 'assess' | 'pr-rework';
    assessment?: AssessOutput['assessment'];
    inputRecord: HandoffRecord<AssessOutput> | HandoffRecord<PrepareRunOutput>;
    prReworkRecord?: HandoffRecord<PrReworkIntakeOutput>;
    latestPlanRecord?: HandoffRecord<PlanOutput>;
    latestPlan?: Extract<PlanResult, {
        status: 'success';
    }>;
    commentsMarkdown?: string;
}
export interface DevelopContext {
    runContext: StableRunContext;
    inputKind: 'plan' | 'review-rework' | 'human-pr-rework';
    plan: Extract<PlanResult, {
        status: 'success';
    }>;
    reviewFailureContent?: string;
    inputRecord: HandoffRecord<PlanOutput> | HandoffRecord<ReviewOutput> | HandoffRecord<PrepareRunOutput>;
    prReworkRecord?: HandoffRecord<PrReworkIntakeOutput>;
    planRecord: HandoffRecord<PlanOutput>;
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
    pullRequest: PullRequestIdentity;
    inputRecord: HandoffRecord<MakePrOutput>;
}
export declare function loadDependencyRecord<TOutput>(inputRecordRef: InputRecordRef, dependency: HandoffRecordDependency, expectedStage: Exclude<WorkflowStage, 'intake'>): Promise<HandoffRecord<TOutput>>;
export declare function resolveAssessContext(payload: AssessJobData): Promise<AssessContext>;
export declare function resolvePlanContext(payload: PlanJobData): Promise<PlanContext>;
export declare function resolveDevelopContext(payload: DevelopJobData): Promise<DevelopContext>;
export declare function resolveReviewContext(payload: ReviewJobData): Promise<ReviewContext>;
export declare function resolveMakePrContext(payload: MakePrJobData): Promise<MakePrContext>;
export declare function resolveSyncTrackerStateContext(payload: SyncTrackerStateJobData): Promise<SyncTrackerStateContext>;
