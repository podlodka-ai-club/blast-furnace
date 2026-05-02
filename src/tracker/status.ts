import type {
  RunStatusMetadata,
  StatusChecklistItem,
  StatusItemStage,
  StatusItemState,
} from '../types/index.js';

const BASE_STAGES: Array<{ stage: StatusItemStage; label: string }> = [
  { stage: 'task-pickup', label: 'Task picked up' },
  { stage: 'prepare-run', label: 'Prepare run' },
  { stage: 'assess', label: 'Assess issue' },
  { stage: 'plan', label: 'Plan solution' },
  { stage: 'develop', label: 'Develop changes' },
  { stage: 'quality-gate', label: 'Quality Gate' },
  { stage: 'review', label: 'Code Review' },
  { stage: 'draft-pr-and-in-review', label: 'Make PR' },
];

const REWORK_STAGES: Array<{ stage: StatusItemStage; label: string }> = [
  { stage: 'human-review', label: 'Human Review' },
  { stage: 'prepare-run', label: 'Prepare run' },
  { stage: 'plan', label: 'Plan solution' },
  { stage: 'develop', label: 'Develop changes' },
  { stage: 'quality-gate', label: 'Quality Gate' },
  { stage: 'review', label: 'Code Review' },
  { stage: 'draft-pr-and-in-review', label: 'Make PR' },
];

const STAGE_ORDER = new Map(BASE_STAGES.map((entry, index) => [entry.stage, index]));
STAGE_ORDER.set('human-review', -1);

export function statusItemId(stage: StatusItemStage, attempt: number, reworkAttempt = 0): string {
  const base = `${stage}:attempt-${attempt}`;
  return reworkAttempt > 0 ? `rework-${reworkAttempt}:${base}` : base;
}

export function createInitialStatusMetadata(now: string): RunStatusMetadata {
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

function itemSortKey(item: StatusChecklistItem): string {
  const reworkAttempt = String(item.reworkAttempt ?? 0).padStart(4, '0');
  const order = STAGE_ORDER.get(item.stage) ?? 99;
  const attempt = String(item.attempt).padStart(4, '0');
  return `${reworkAttempt}:${attempt}:${String(order).padStart(2, '0')}:${item.id}`;
}

export function upsertStatusItems(
  checklist: StatusChecklistItem[],
  updates: StatusChecklistItem[]
): StatusChecklistItem[] {
  const byId = new Map(checklist.map((item) => [item.id, item]));
  for (const update of updates) {
    byId.set(update.id, update);
  }
  return [...byId.values()].sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));
}

export function makeStatusItem(
  stage: StatusItemStage,
  attempt: number,
  state: StatusItemState,
  label: string,
  detail?: string,
  reworkAttempt = 0
): StatusChecklistItem {
  return {
    id: statusItemId(stage, attempt, reworkAttempt),
    stage,
    attempt,
    ...(reworkAttempt > 0 && { reworkAttempt }),
    state,
    label,
    ...(detail !== undefined && { detail }),
  };
}

export function createReworkStatusItems(reworkAttempt: number): StatusChecklistItem[] {
  return REWORK_STAGES.map(({ stage, label }) => makeStatusItem(
    stage,
    1,
    stage === 'human-review' ? 'retrying' : 'pending',
    label,
    stage === 'human-review' ? 'Rework needed' : undefined,
    reworkAttempt
  ));
}

export function statusIcon(state: StatusItemState): string {
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
