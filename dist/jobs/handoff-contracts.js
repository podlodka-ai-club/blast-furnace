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
function requireStageMetadata(value) {
    requireString(value, 'runId');
    requireNumber(value, 'stageAttempt');
    requireNumber(value, 'reworkAttempt');
}
function requireStatus(value, expected) {
    if (value['status'] !== expected) {
        throw new Error(`status must be ${expected}`);
    }
}
const STABLE_CONTEXT_FIELDS = ['issue', 'repository', 'branchName', 'workspacePath'];
function rejectFields(value, label, fields) {
    for (const field of fields) {
        if (field in value) {
            throw new Error(`${label} must not include ${field}`);
        }
    }
}
function parseAssessOutput(value) {
    assertObject(value, 'assess output');
    rejectFields(value, 'assess output', [
        ...STABLE_CONTEXT_FIELDS,
        'plan',
        'development',
        'quality',
        'review',
        'pullRequest',
        'trackerLabels',
    ]);
    requireStatus(value, 'success');
    requireStageMetadata(value);
    requireObject(value, 'assessment');
    const parsed = value;
    return parsed;
}
function parsePlanOutput(value) {
    assertObject(value, 'plan output');
    rejectFields(value, 'plan output', [
        ...STABLE_CONTEXT_FIELDS,
        'assessment',
        'development',
        'quality',
        'review',
        'pullRequest',
        'trackerLabels',
    ]);
    requireStageMetadata(value);
    if (!['success', 'validation-failed'].includes(String(value['status']))) {
        throw new Error('plan status must be success or validation-failed');
    }
    const plan = value['plan'];
    requireObject(value, 'plan');
    assertObject(plan, 'plan');
    if (!['success', 'validation-failed'].includes(String(plan['status']))) {
        throw new Error('plan.status must be success or validation-failed');
    }
    requireString(plan, 'summary');
    requireString(plan, 'content');
    if (plan['status'] === 'validation-failed') {
        requireString(plan, 'failureReason');
    }
    if (value['status'] === 'success' && plan['status'] !== 'success') {
        throw new Error('successful plan output requires plan.status success');
    }
    if (value['status'] === 'validation-failed' && plan['status'] !== 'validation-failed') {
        throw new Error('validation-failed plan output requires plan.status validation-failed');
    }
    return value;
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
    assertObject(value, 'develop output');
    rejectFields(value, 'develop output', [
        ...STABLE_CONTEXT_FIELDS,
        'assessment',
        'plan',
        'review',
        'pullRequest',
        'trackerLabels',
    ]);
    requireStageMetadata(value);
    if (!['success', 'quality-failed', 'quality-timed-out', 'quality-misconfigured'].includes(String(value['status']))) {
        throw new Error('develop status must be success, quality-failed, quality-timed-out, or quality-misconfigured');
    }
    requireObject(value, 'development');
    requireObject(value, 'quality');
    const quality = parseQualityGateResult(value['quality']);
    const parsed = value;
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
    if (quality.status === 'passed' && quality.outputPath !== undefined) {
        throw new Error('passed quality output must not include outputPath');
    }
    return parsed;
}
function parseReviewOutput(value) {
    assertObject(value, 'review output');
    rejectFields(value, 'review output', [
        ...STABLE_CONTEXT_FIELDS,
        'assessment',
        'plan',
        'development',
        'quality',
        'pullRequest',
        'trackerLabels',
    ]);
    requireStageMetadata(value);
    if (!['success', 'review-failed', 'review-malformed', 'review-exhausted'].includes(String(value['status']))) {
        throw new Error('review status must be success, review-failed, review-malformed, or review-exhausted');
    }
    requireObject(value, 'review');
    const review = value['review'];
    assertObject(review, 'review');
    const outputStatus = value['status'];
    const reviewStatus = review['status'];
    if (outputStatus === 'success') {
        if (reviewStatus !== 'passed' || review['summary'] !== 'Review Success') {
            throw new Error('successful review output requires review.status passed and summary Review Success');
        }
    }
    else if (outputStatus === 'review-failed') {
        if (reviewStatus !== 'failed') {
            throw new Error('review-failed output requires review.status failed');
        }
        requireString(review, 'content');
    }
    else if (outputStatus === 'review-malformed') {
        if (reviewStatus !== 'malformed') {
            throw new Error('review-malformed output requires review.status malformed');
        }
        requireStringValue(review, 'rawResponse');
    }
    else if (outputStatus === 'review-exhausted') {
        if (reviewStatus !== 'exhausted') {
            throw new Error('review-exhausted output requires review.status exhausted');
        }
        requireString(review, 'content');
    }
    requireString(review, 'summary');
    return value;
}
function parseMakePrOutput(value) {
    assertObject(value, 'make-pr output');
    rejectFields(value, 'make-pr output', [
        ...STABLE_CONTEXT_FIELDS,
        'assessment',
        'plan',
        'development',
        'quality',
        'review',
        'trackerLabels',
    ]);
    requireStageMetadata(value);
    if (value['status'] === 'pull-request-created') {
        requireObject(value, 'pullRequest');
        return value;
    }
    if (value['status'] === 'no-changes') {
        if ('pullRequest' in value) {
            throw new Error('no-changes make-pr output must not include pullRequest');
        }
        return value;
    }
    throw new Error('make-pr status must be pull-request-created or no-changes');
}
function parseSyncTrackerStateOutput(value) {
    assertObject(value, 'sync-tracker-state output');
    rejectFields(value, 'sync-tracker-state output', [
        ...STABLE_CONTEXT_FIELDS,
        'assessment',
        'plan',
        'development',
        'quality',
        'review',
        'pullRequest',
    ]);
    requireStatus(value, 'tracker-synced');
    requireStageMetadata(value);
    if (!Array.isArray(value['trackerLabels'])) {
        throw new Error('trackerLabels must be an array');
    }
    return value;
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
        parse: (value) => {
            assertObject(value, 'prepare-run output');
            rejectFields(value, 'prepare-run output', [
                ...STABLE_CONTEXT_FIELDS,
                'assessment',
                'plan',
                'development',
                'quality',
                'review',
                'pullRequest',
                'trackerLabels',
            ]);
            requireStatus(value, 'success');
            requireStageMetadata(value);
            return value;
        },
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
