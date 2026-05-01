const BASE_STAGES = [
    { stage: 'task-pickup', label: 'Task picked up' },
    { stage: 'prepare-run', label: 'Prepare run' },
    { stage: 'assess', label: 'Assess issue' },
    { stage: 'plan', label: 'Plan solution' },
    { stage: 'develop', label: 'Develop changes' },
    { stage: 'quality-gate', label: 'Quality Gate' },
    { stage: 'review', label: 'Code Review' },
    { stage: 'draft-pr-and-in-review', label: 'Make PR' },
];
const STAGE_ORDER = new Map(BASE_STAGES.map((entry, index) => [entry.stage, index]));
export function statusItemId(stage, attempt) {
    return `${stage}:attempt-${attempt}`;
}
export function createInitialStatusMetadata(now) {
    return {
        provider: 'github',
        kind: 'orchestrator-status',
        pickedUpAt: now,
        lastChangedAt: now,
        heading: 'Blast Furnace is starting work',
        focus: 'Current focus: Prepare run',
        checklist: BASE_STAGES.map(({ stage, label }) => ({
            id: statusItemId(stage, 1),
            stage,
            attempt: 1,
            label,
            state: stage === 'task-pickup' ? 'completed' : 'pending',
        })),
    };
}
function itemSortKey(item) {
    const order = STAGE_ORDER.get(item.stage) ?? 99;
    const attempt = String(item.attempt).padStart(4, '0');
    return `${attempt}:${String(order).padStart(2, '0')}:${item.id}`;
}
export function upsertStatusItems(checklist, updates) {
    const byId = new Map(checklist.map((item) => [item.id, item]));
    for (const update of updates) {
        byId.set(update.id, update);
    }
    return [...byId.values()].sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));
}
export function makeStatusItem(stage, attempt, state, label, detail) {
    return {
        id: statusItemId(stage, attempt),
        stage,
        attempt,
        state,
        label,
        ...(detail !== undefined && { detail }),
    };
}
export function statusIcon(state) {
    switch (state) {
        case 'completed':
            return '✅';
        case 'in-progress':
            return '🔵';
        case 'retrying':
            return '🟡';
        case 'failed':
            return '❌';
        case 'skipped':
            return '⏭️';
        case 'blocked':
            return '🟡';
        case 'pending':
            return '⚪';
    }
}
