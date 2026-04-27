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
function requireStringValue(value, field) {
    if (typeof value[field] !== 'string') {
        throw new Error(`${field} must be a string`);
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
function parsePreparedFields(value, label) {
    assertObject(value, label);
    requirePreparedFields(value);
    return value;
}
function parseAssessOutput(value) {
    const parsed = parsePreparedOutput(value, 'assess output');
    requireObject(parsed, 'assessment');
    return parsed;
}
function parsePlanOutput(value) {
    const parsed = parsePreparedFields(value, 'plan output');
    if (!['success', 'validation-failed'].includes(String(parsed.status))) {
        throw new Error('plan status must be success or validation-failed');
    }
    requireObject(parsed, 'assessment');
    const plan = parsed['plan'];
    requireObject(parsed, 'plan');
    assertObject(plan, 'plan');
    if (!['success', 'validation-failed'].includes(String(plan['status']))) {
        throw new Error('plan.status must be success or validation-failed');
    }
    requireString(plan, 'summary');
    requireString(plan, 'content');
    if (plan['status'] === 'validation-failed') {
        requireString(plan, 'failureReason');
    }
    return parsed;
}
function parsePlanFields(value) {
    const parsed = parsePreparedFields(value, 'stage output');
    requireObject(parsed, 'assessment');
    requireObject(parsed, 'plan');
    return parsed;
}
function parseQualityGateResult(value) {
    assertObject(value, 'quality');
    if (!['passed', 'failed', 'misconfigured', 'timed-out'].includes(String(value['status']))) {
        throw new Error('quality.status must be passed, failed, misconfigured, or timed-out');
    }
    requireStringValue(value, 'command');
    requireNumber(value, 'attempts');
    requireNumber(value, 'durationMs');
    requireString(value, 'summary');
    if (value['exitCode'] !== undefined) {
        requireNumber(value, 'exitCode');
    }
    if (value['outputPath'] !== undefined) {
        requireString(value, 'outputPath');
    }
    return value;
}
function parseDevelopOutput(value) {
    const parsed = parsePlanFields(value);
    if (!['success', 'quality-failed', 'quality-timed-out', 'quality-misconfigured'].includes(String(parsed.status))) {
        throw new Error('develop status must be success, quality-failed, quality-timed-out, or quality-misconfigured');
    }
    requireObject(parsed, 'development');
    requireObject(parsed, 'quality');
    const quality = parseQualityGateResult(parsed['quality']);
    const expectedQualityStatusByDevelopStatus = {
        success: 'passed',
        'quality-failed': 'failed',
        'quality-timed-out': 'timed-out',
        'quality-misconfigured': 'misconfigured',
    };
    const expectedQualityStatus = expectedQualityStatusByDevelopStatus[parsed.status];
    if (quality.status !== expectedQualityStatus) {
        throw new Error(`develop ${parsed.status} requires quality.status ${expectedQualityStatus}`);
    }
    return parsed;
}
function parseReviewOutput(value) {
    const parsed = parseDevelopOutput(value);
    if (parsed.quality.status !== 'passed') {
        throw new Error('review input quality.status must be passed');
    }
    requireStatus(parsed, 'success');
    requireObject(parsed, 'review');
    return parsed;
}
function parseMakePrOutput(value) {
    assertObject(value, 'make-pr output');
    requirePreparedFields(value);
    requireObject(value, 'development');
    requireObject(value, 'quality');
    const quality = parseQualityGateResult(value['quality']);
    if (quality.status !== 'passed') {
        throw new Error('make-pr input quality.status must be passed');
    }
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
