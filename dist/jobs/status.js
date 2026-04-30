import { trackerClient } from '../tracker/github.js';
import { createInitialStatusMetadata, makeStatusItem, upsertStatusItems, } from '../tracker/status.js';
import { readRunSummary, writeRunSummary } from './orchestration.js';
function issueAndRepository(summaryIssue, summaryRepository) {
    if (!summaryIssue || !summaryRepository) {
        throw new Error('Run summary must contain issue and repository identity before status update');
    }
    return { issue: summaryIssue, repository: summaryRepository };
}
export async function updateRunStatus(root, runId, update, logger, client = trackerClient) {
    const summary = await readRunSummary(root, runId);
    if (!summary) {
        throw new Error(`Run summary not found for ${runId}`);
    }
    const { issue, repository } = issueAndRepository(summary.initialContext?.issue ?? summary.stableContext?.issue, summary.initialContext?.repository ?? summary.stableContext?.repository);
    const now = new Date().toISOString();
    const existing = summary.trackerStatus ?? createInitialStatusMetadata(now);
    const next = {
        ...existing,
        heading: update.heading ?? existing.heading,
        focus: update.focus ?? existing.focus,
        note: update.note ?? existing.note,
        checklist: update.items ? upsertStatusItems(existing.checklist, update.items) : existing.checklist,
        lastChangedAt: now,
    };
    try {
        const persisted = await client.createOrUpdateStatusComment({
            runId,
            issueNumber: issue.number,
            repository,
            status: next,
        });
        await writeRunSummary(root, {
            ...summary,
            trackerStatus: persisted,
        });
        return persisted;
    }
    catch (err) {
        logger?.warn(`Failed to update orchestrator status for run ${runId}: ${err}`);
        await writeRunSummary(root, {
            ...summary,
            trackerStatus: next,
        });
        return null;
    }
}
export function statusItem(stage, attempt, state, label, detail) {
    return makeStatusItem(stage, attempt, state, label, detail);
}
export function developStatusItem(attempt, state, detail) {
    return statusItem('develop', attempt, state, attempt === 1 ? 'Develop changes' : `Develop rework ${attempt - 1}`, detail);
}
export function qualityStatusItem(attempt, state, detail) {
    return statusItem('quality-gate', attempt, state, attempt === 1 ? 'Quality Gate' : `Quality Gate rework ${attempt - 1}`, detail);
}
export function reviewStatusItem(attempt, state, detail) {
    return statusItem('review', attempt, state, attempt === 1 ? 'Review' : `Review attempt ${attempt}`, detail);
}
