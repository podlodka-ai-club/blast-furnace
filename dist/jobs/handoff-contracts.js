import { validateHandoffRecord } from './orchestration.js';
import { validateInputRecordRef, validateStagePayload } from './stage-payloads.js';
function assertObject(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
}
function requireString(value, field) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
        throw new Error(`${field} must be a non-empty string`);
    }
}
function requireNumber(value, field) {
    if (!Number.isInteger(value[field])) {
        throw new Error(`${field} must be an integer`);
    }
}
function requireObject(value, field) {
    assertObject(value[field], field);
}
function requirePreparedFields(value) {
    requireString(value, 'runId');
    requireString(value, 'branchName');
    requireString(value, 'workspacePath');
    requireNumber(value, 'stageAttempt');
    requireNumber(value, 'reworkAttempt');
    requireObject(value, 'issue');
    requireObject(value, 'repository');
}
function requireStatus(value, expected) {
    if (value['status'] !== expected) {
        throw new Error(`status must be ${expected}`);
    }
}
function parsePreparedOutput(value, label, status = 'success') {
    assertObject(value, label);
    requireStatus(value, status);
    requirePreparedFields(value);
    return value;
}
function parseAssessOutput(value) {
    const parsed = parsePreparedOutput(value, 'assess output');
    requireObject(parsed, 'assessment');
    return parsed;
}
function parsePlanOutput(value) {
    const parsed = parseAssessOutput(value);
    requireObject(parsed, 'plan');
    return parsed;
}
function parseDevelopOutput(value) {
    const parsed = parsePlanOutput(value);
    requireObject(parsed, 'development');
    return parsed;
}
function parseQualityGateOutput(value) {
    const parsed = parseDevelopOutput(value);
    requireObject(parsed, 'quality');
    return parsed;
}
function parseReviewOutput(value) {
    const parsed = parseQualityGateOutput(value);
    requireObject(parsed, 'review');
    return parsed;
}
function parseMakePrOutput(value) {
    assertObject(value, 'make-pr output');
    requirePreparedFields(value);
    requireObject(value, 'development');
    requireObject(value, 'quality');
    requireObject(value, 'review');
    if (value['status'] === 'pull-request-created') {
        requireObject(value, 'pullRequest');
        return value;
    }
    if (value['status'] === 'no-changes') {
        return value;
    }
    throw new Error('make-pr status must be pull-request-created or no-changes');
}
function parseSyncTrackerStateOutput(value) {
    const parsed = parsePreparedOutput(value, 'sync-tracker-state output', 'tracker-synced');
    requireObject(parsed, 'pullRequest');
    if (!Array.isArray(parsed['trackerLabels'])) {
        throw new Error('trackerLabels must be an array');
    }
    return parsed;
}
export const inputRecordRefSchema = {
    parse(value) {
        validateInputRecordRef(value);
        return value;
    },
};
export const runSummaryPointerSchema = inputRecordRefSchema;
export const handoffRecordSchema = {
    parse(value) {
        assertObject(value, 'handoff record');
        validateHandoffRecord(value);
        return value;
    },
};
function payloadSchema(stage) {
    return {
        parse(value) {
            validateStagePayload(stage, value);
            return value;
        },
    };
}
export const stagePayloadSchemas = {
    assess: payloadSchema('assess'),
    plan: payloadSchema('plan'),
    develop: payloadSchema('develop'),
    'quality-gate': payloadSchema('quality-gate'),
    review: payloadSchema('review'),
    'make-pr': payloadSchema('make-pr'),
    'sync-tracker-state': payloadSchema('sync-tracker-state'),
};
export const stageOutputSchemas = {
    'prepare-run': {
        parse: (value) => parsePreparedOutput(value, 'prepare-run output'),
    },
    assess: {
        parse: parseAssessOutput,
    },
    plan: {
        parse: parsePlanOutput,
    },
    develop: {
        parse: parseDevelopOutput,
    },
    'quality-gate': {
        parse: parseQualityGateOutput,
    },
    review: {
        parse: parseReviewOutput,
    },
    'make-pr': {
        parse: parseMakePrOutput,
    },
    'sync-tracker-state': {
        parse: parseSyncTrackerStateOutput,
    },
};
export function parseStageOutput(stage, value) {
    return stageOutputSchemas[stage].parse(value);
}
