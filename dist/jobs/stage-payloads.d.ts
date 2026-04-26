import type { StageJobPayload, WorkflowStage } from '../types/index.js';
type ForwardPayload<TStage extends WorkflowStage, TSource extends StageJobPayload, TExtra extends Record<string, unknown>> = Omit<TSource, 'type' | 'stage' | 'stageAttempt'> & StageJobPayload<TStage> & TExtra;
export declare function createForwardStagePayload<TStage extends WorkflowStage, TSource extends StageJobPayload, TExtra extends Record<string, unknown>>(source: TSource, nextStage: TStage, extra: TExtra, stageAttempt?: number): ForwardPayload<TStage, TSource, TExtra>;
export {};
