import { readHandoffRecords, readRunSummary, readValidatedStageInputRecord, resolveOrchestrationStorageRoot, } from './orchestration.js';
import { parseStageOutput, stagePayloadSchemas } from './handoff-contracts.js';
function assertObject(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
}
function assertStableRunContext(value) {
    assertObject(value, 'stableContext');
    assertObject(value['issue'], 'stableContext.issue');
    assertObject(value['repository'], 'stableContext.repository');
    if (typeof value['branchName'] !== 'string' || value['branchName'].length === 0) {
        throw new Error('stableContext.branchName must be a non-empty string');
    }
    if (typeof value['workspacePath'] !== 'string' || value['workspacePath'].length === 0) {
        throw new Error('stableContext.workspacePath must be a non-empty string');
    }
}
async function readStableRunContext(payload) {
    const root = resolveOrchestrationStorageRoot(payload.inputRecordRef);
    const summary = await readRunSummary(root, payload.runId);
    if (!summary) {
        throw new Error(`Run summary not found for ${payload.runId}`);
    }
    assertStableRunContext(summary.stableContext);
    return summary.stableContext;
}
function ensureInputStage(record, expectedStage, label = 'input record') {
    if (record.fromStage !== expectedStage) {
        throw new Error(`${label} expected stage ${expectedStage} but found ${record.fromStage}`);
    }
}
function findHandoffRecordById(records, recordId) {
    const record = records.find((candidate) => candidate.recordId === recordId);
    if (!record) {
        throw new Error(`Handoff dependency record not found: ${recordId}`);
    }
    return record;
}
function validateDependencyRecord(record, expectedStage) {
    if (record.fromStage !== expectedStage) {
        throw new Error(`Handoff dependency ${record.recordId} expected stage ${expectedStage} but found ${record.fromStage}`);
    }
    parseStageOutput(expectedStage, record.output);
    return record;
}
export async function loadDependencyRecord(inputRecordRef, dependency, expectedStage) {
    const records = await readHandoffRecords(inputRecordRef.handoffPath);
    return validateDependencyRecord(findHandoffRecordById(records, dependency), expectedStage);
}
async function loadRequiredDependencyRecord(inputRecordRef, sourceRecord, expectedStage) {
    if (sourceRecord.dependsOn.length === 0) {
        throw new Error(`Missing required ${expectedStage} dependency`);
    }
    const records = await readHandoffRecords(inputRecordRef.handoffPath);
    const dependencyRecords = sourceRecord.dependsOn.map((recordId) => findHandoffRecordById(records, recordId));
    const matches = dependencyRecords.filter((record) => record.fromStage === expectedStage);
    if (matches.length === 0) {
        if (dependencyRecords.length === 1) {
            return validateDependencyRecord(dependencyRecords[0], expectedStage);
        }
        throw new Error(`Missing required ${expectedStage} dependency`);
    }
    if (matches.length > 1) {
        throw new Error(`Multiple ${expectedStage} dependencies found`);
    }
    return validateDependencyRecord(matches[0], expectedStage);
}
function requireAcceptedPlan(output) {
    if (output.status !== 'success' || output.plan.status !== 'success') {
        throw new Error('accepted plan output is required');
    }
    return output.plan;
}
function requirePassedQuality(output) {
    if (output.status !== 'success' || output.quality.status !== 'passed') {
        throw new Error('review input quality.status must be passed');
    }
    return output.quality;
}
export async function resolveAssessContext(payload) {
    stagePayloadSchemas.assess.parse(payload);
    const [runContext, inputRecord] = await Promise.all([
        readStableRunContext(payload),
        readValidatedStageInputRecord(payload),
    ]);
    ensureInputStage(inputRecord, 'prepare-run');
    const prepareRun = parseStageOutput('prepare-run', inputRecord.output);
    return { runContext, prepareRun, inputRecord };
}
export async function resolvePlanContext(payload) {
    stagePayloadSchemas.plan.parse(payload);
    const [runContext, inputRecord] = await Promise.all([
        readStableRunContext(payload),
        readValidatedStageInputRecord(payload),
    ]);
    ensureInputStage(inputRecord, 'assess');
    const output = parseStageOutput('assess', inputRecord.output);
    return { runContext, assessment: output.assessment, inputRecord: inputRecord };
}
export async function resolveDevelopContext(payload) {
    stagePayloadSchemas.develop.parse(payload);
    const [runContext, inputRecord] = await Promise.all([
        readStableRunContext(payload),
        readValidatedStageInputRecord(payload),
    ]);
    ensureInputStage(inputRecord, 'plan');
    const output = parseStageOutput('plan', inputRecord.output);
    return {
        runContext,
        plan: requireAcceptedPlan(output),
        inputRecord: inputRecord,
    };
}
export async function resolveReviewContext(payload) {
    stagePayloadSchemas.review.parse(payload);
    const [runContext, inputRecord] = await Promise.all([
        readStableRunContext(payload),
        readValidatedStageInputRecord(payload),
    ]);
    ensureInputStage(inputRecord, 'develop');
    const output = parseStageOutput('develop', inputRecord.output);
    const planRecord = await loadRequiredDependencyRecord(payload.inputRecordRef, inputRecord, 'plan');
    const planOutput = parseStageOutput('plan', planRecord.output);
    return {
        runContext,
        plan: requireAcceptedPlan(planOutput),
        development: output.development,
        quality: requirePassedQuality(output),
        inputRecord: inputRecord,
        planRecord,
    };
}
export async function resolveMakePrContext(payload) {
    stagePayloadSchemas['make-pr'].parse(payload);
    const [runContext, inputRecord] = await Promise.all([
        readStableRunContext(payload),
        readValidatedStageInputRecord(payload),
    ]);
    ensureInputStage(inputRecord, 'review');
    const reviewOutput = parseStageOutput('review', inputRecord.output);
    const developRecord = await loadRequiredDependencyRecord(payload.inputRecordRef, inputRecord, 'develop');
    const planRecord = await loadRequiredDependencyRecord(payload.inputRecordRef, inputRecord, 'plan');
    const developOutput = parseStageOutput('develop', developRecord.output);
    const planOutput = parseStageOutput('plan', planRecord.output);
    return {
        runContext,
        plan: requireAcceptedPlan(planOutput),
        development: developOutput.development,
        quality: requirePassedQuality(developOutput),
        review: reviewOutput.review,
        inputRecord: inputRecord,
        developRecord,
        planRecord,
    };
}
export async function resolveSyncTrackerStateContext(payload) {
    stagePayloadSchemas['sync-tracker-state'].parse(payload);
    const [runContext, inputRecord] = await Promise.all([
        readStableRunContext(payload),
        readValidatedStageInputRecord(payload),
    ]);
    ensureInputStage(inputRecord, 'make-pr');
    const output = parseStageOutput('make-pr', inputRecord.output);
    if (output.status !== 'pull-request-created') {
        throw new Error('Sync Tracker State requires a pull-request-created input record');
    }
    return {
        runContext,
        pullRequest: output.pullRequest,
        inputRecord: inputRecord,
    };
}
