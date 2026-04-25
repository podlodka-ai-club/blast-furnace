import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export function resolveRunDirectory(root, runId) {
    return join(root, '.orchestrator', 'runs', runId);
}
export function resolveStageAttemptDirectory(root, location) {
    return join(resolveRunDirectory(root, location.runId), 'stages', location.stageName, `attempt-${location.attempt}`);
}
export function resolveArtifactPath(root, location) {
    return join(resolveStageAttemptDirectory(root, location), 'artifacts', location.artifactName);
}
export function resolveEventPath(root, runId, eventName) {
    return join(resolveRunDirectory(root, runId), 'events', eventName);
}
export function resolveRunSummaryPath(root, runId) {
    return join(resolveRunDirectory(root, runId), 'run.json');
}
async function writeJson(path, data, flag) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), { encoding: 'utf8', flag });
}
export async function writeArtifactFile(root, location, data) {
    const path = resolveArtifactPath(root, location);
    const createdAt = new Date().toISOString();
    await writeJson(path, data, 'wx');
    return {
        ...location,
        path,
        createdAt,
    };
}
export async function writeEventFile(root, runId, eventName, data) {
    const path = resolveEventPath(root, runId, eventName);
    const createdAt = new Date().toISOString();
    await writeJson(path, data, 'wx');
    return {
        runId,
        eventName,
        path,
        createdAt,
    };
}
export async function readRunSummary(root, runId) {
    try {
        const raw = await readFile(resolveRunSummaryPath(root, runId), 'utf8');
        return JSON.parse(raw);
    }
    catch (err) {
        if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}
export async function writeRunSummary(root, summary) {
    const now = new Date().toISOString();
    await writeJson(resolveRunSummaryPath(root, summary.runId), {
        ...summary,
        createdAt: summary.createdAt ?? now,
        updatedAt: now,
    }, 'w');
}
export async function updateRunSummary(root, runId, update) {
    const existing = await readRunSummary(root, runId);
    const next = update(existing ?? {
        runId,
        status: 'running',
        stages: {},
    });
    await writeRunSummary(root, next);
    const written = await readRunSummary(root, runId);
    if (!written) {
        throw new Error(`Failed to write run summary for ${runId}`);
    }
    return written;
}
export async function scheduleNextJob(queue, jobName, data) {
    return queue.add(jobName, data);
}
