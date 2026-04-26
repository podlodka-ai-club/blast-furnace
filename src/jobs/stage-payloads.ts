import type { StageJobPayload, WorkflowStage } from '../types/index.js';

type ForwardPayload<TStage extends WorkflowStage, TSource extends StageJobPayload, TExtra extends Record<string, unknown>> =
  Omit<TSource, 'type' | 'stage' | 'stageAttempt'> &
  StageJobPayload<TStage> &
  TExtra;

export function createForwardStagePayload<
  TStage extends WorkflowStage,
  TSource extends StageJobPayload,
  TExtra extends Record<string, unknown>,
>(
  source: TSource,
  nextStage: TStage,
  extra: TExtra,
  stageAttempt = 1
): ForwardPayload<TStage, TSource, TExtra> {
  return {
    ...source,
    ...extra,
    type: nextStage,
    stage: nextStage,
    stageAttempt,
    runId: source.runId,
    reworkAttempt: source.reworkAttempt,
  } as ForwardPayload<TStage, TSource, TExtra>;
}
