const BUSINESS_PAYLOAD_FIELDS = [
    'issue',
    'repository',
    'branchName',
    'workspacePath',
    'assessment',
    'plan',
    'development',
    'quality',
    'review',
    'pullRequest',
];
function assertObject(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
}
export function validateInputRecordRef(value) {
    assertObject(value, 'inputRecordRef');
    for (const field of ['runDir', 'handoffPath', 'recordId', 'stage']) {
        if (typeof value[field] !== 'string' || value[field].length === 0) {
            throw new Error(`inputRecordRef.${field} must be a non-empty string`);
        }
    }
    if (!Number.isInteger(value['sequence']) || Number(value['sequence']) < 1) {
        throw new Error('inputRecordRef.sequence must be a positive integer');
    }
}
export function createForwardStagePayload(source, nextStage, inputRecordRef, stageAttempt = 1) {
    return {
        taskId: source.taskId,
        type: nextStage,
        runId: source.runId,
        stage: nextStage,
        stageAttempt,
        reworkAttempt: source.reworkAttempt,
        inputRecordRef,
    };
}
export function validateStagePayload(expectedStage, payload) {
    assertObject(payload, 'stage payload');
    if (payload['type'] !== expectedStage) {
        throw new Error(`type mismatch: expected ${expectedStage}`);
    }
    if (payload['stage'] !== expectedStage) {
        throw new Error(`stage mismatch: expected ${expectedStage}`);
    }
    if (typeof payload['runId'] !== 'string' || payload['runId'].length === 0) {
        throw new Error('stage payload runId must be a non-empty string');
    }
    if (!Number.isInteger(payload['stageAttempt']) || Number(payload['stageAttempt']) < 1) {
        throw new Error('stageAttempt must be a positive integer');
    }
    if (!Number.isInteger(payload['reworkAttempt']) || Number(payload['reworkAttempt']) < 0) {
        throw new Error('reworkAttempt must be a non-negative integer');
    }
    validateInputRecordRef(payload['inputRecordRef']);
    for (const field of BUSINESS_PAYLOAD_FIELDS) {
        if (field in payload) {
            throw new Error(`stage payload must not include ${field}`);
        }
    }
}
export function validateStageInputRecord(payload, record) {
    if (record.runId !== payload.runId) {
        throw new Error(`runId mismatch: expected ${payload.runId}, got ${record.runId}`);
    }
    if (record.toStage !== payload.stage) {
        throw new Error(`toStage mismatch: expected ${payload.stage}, got ${record.toStage ?? 'null'}`);
    }
    if (record.stageAttempt !== payload.stageAttempt) {
        throw new Error(`stageAttempt mismatch: expected ${payload.stageAttempt}, got ${record.stageAttempt}`);
    }
    if (record.reworkAttempt !== payload.reworkAttempt) {
        throw new Error(`reworkAttempt mismatch: expected ${payload.reworkAttempt}, got ${record.reworkAttempt}`);
    }
}
