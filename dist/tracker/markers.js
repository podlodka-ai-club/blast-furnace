const MARKER_PREFIX = '<!-- blast-furnace:tracker-comment ';
const MARKER_SUFFIX = ' -->';
const MARKER_RE = /^<!-- blast-furnace:tracker-comment ([^>]+) -->$/;
export function renderTrackerCommentMarker(marker) {
    return [
        MARKER_PREFIX,
        `kind=${marker.kind}`,
        ` runId=${marker.runId}`,
        ` owner=${marker.owner}`,
        ` repo=${marker.repo}`,
        ` issue=${marker.issue}`,
        MARKER_SUFFIX,
    ].join('');
}
export function parseTrackerCommentMarker(line) {
    const match = line.match(MARKER_RE);
    if (!match?.[1]) {
        return null;
    }
    const values = new Map();
    for (const part of match[1].trim().split(/\s+/)) {
        const [key, value, extra] = part.split('=');
        if (!key || value === undefined || extra !== undefined || values.has(key)) {
            return null;
        }
        values.set(key, value);
    }
    const kind = values.get('kind');
    const runId = values.get('runId');
    const owner = values.get('owner');
    const repo = values.get('repo');
    const issueRaw = values.get('issue');
    if (!kind ||
        !['orchestrator-status', 'orchestrator-plan', 'orchestrator-rework-start'].includes(kind) ||
        !runId ||
        !owner ||
        !repo ||
        !issueRaw ||
        !/^\d+$/.test(issueRaw)) {
        return null;
    }
    return {
        kind: kind,
        runId,
        owner,
        repo,
        issue: Number(issueRaw),
    };
}
export function extractSingleTrackerMarker(body) {
    const markers = body
        .split(/\r?\n/)
        .map((line) => parseTrackerCommentMarker(line.trim()))
        .filter((marker) => marker !== null);
    if (markers.length !== 1) {
        return null;
    }
    return markers[0];
}
export function markerMatches(actual, expected) {
    return actual?.kind === expected.kind &&
        actual.runId === expected.runId &&
        actual.owner === expected.owner &&
        actual.repo === expected.repo &&
        actual.issue === expected.issue;
}
