export function createForwardStagePayload(source, nextStage, extra, stageAttempt = 1) {
    return {
        ...source,
        ...extra,
        type: nextStage,
        stage: nextStage,
        stageAttempt,
        runId: source.runId,
        reworkAttempt: source.reworkAttempt,
    };
}
