import type { RepositoryIdentity, RunStatusMetadata, StatusChecklistItem } from '../types/index.js';
import { renderTrackerCommentMarker } from './markers.js';
import { statusIcon } from './status.js';

export interface RenderStatusCommentInput {
  runId: string;
  repository: RepositoryIdentity;
  issueNumber: number;
  status: RunStatusMetadata;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
}

function mainItems(checklist: StatusChecklistItem[]): StatusChecklistItem[] {
  const initialChecklist = checklist.filter((item) => (item.reworkAttempt ?? 0) === 0);
  const firstAttempt = initialChecklist.filter((item) => item.attempt === 1 && item.stage !== 'review-feedback-loop');
  const hasRework = initialChecklist.some((item) => item.attempt > 1);
  if (!hasRework) {
    return firstAttempt;
  }
  const review = firstAttempt.find((item) => item.stage === 'review');
  const beforeFinal = firstAttempt.filter((item) => item.stage !== 'draft-pr-and-in-review');
  const final = firstAttempt.find((item) => item.stage === 'draft-pr-and-in-review');
  const loop: StatusChecklistItem = {
    id: 'review-feedback-loop:attempt-1',
    stage: 'review-feedback-loop',
    attempt: 1,
    label: 'Review feedback loop',
    state: initialChecklist.some((item) => item.state === 'failed' && item.stage === 'review') ? 'failed' : 'retrying',
    detail: review?.detail ?? 'Active',
  };
  return [...beforeFinal, loop, ...(final ? [final] : [])];
}

function renderProgressTable(items: StatusChecklistItem[]): string[] {
  return [
    '|  | Stage | Status |',
    '|---|---|---|',
    ...items.map((item) => `| ${statusIcon(item.state)} | ${escapeCell(item.label)} | ${escapeCell(item.detail ?? '')} |`),
  ];
}

function renderReviewLoop(checklist: StatusChecklistItem[]): string[] {
  const scopedReworkExists = checklist.some((item) => (item.reworkAttempt ?? 0) > 0);
  if (scopedReworkExists) {
    return [];
  }
  const initialChecklist = checklist.filter((item) => (item.reworkAttempt ?? 0) === 0);
  const attempts = [...new Set(initialChecklist.filter((item) => item.attempt > 1 || item.stage === 'review').map((item) => item.attempt))]
    .sort((a, b) => a - b);
  if (attempts.length <= 1) {
    return [];
  }

  const byId = new Map(initialChecklist.map((item) => [item.id, item]));
  const row = (attempt: number): string => {
    const develop = byId.get(`develop:attempt-${attempt}`);
    const quality = byId.get(`quality-gate:attempt-${attempt}`);
    const review = byId.get(`review:attempt-${attempt}`);
    const cell = (item: StatusChecklistItem | undefined): string => {
      if (!item) return '⚪';
      const detail = item.detail ? ` ${item.detail}` : '';
      return `${statusIcon(item.state)}${detail}`;
    };
    return `| ${attempt} | ${escapeCell(cell(develop))} | ${escapeCell(cell(quality))} | ${escapeCell(cell(review))} |`;
  };

  return [
    '',
    '### Review feedback loop',
    '',
    '| Attempt | Develop | Quality Gate | Code Review |',
    '|---|---|---|---|',
    ...attempts.map(row),
  ];
}

function renderReworkSections(checklist: StatusChecklistItem[]): string[] {
  const byAttempt = new Map<number, StatusChecklistItem[]>();
  for (const item of checklist) {
    const reworkAttempt = item.reworkAttempt ?? 0;
    if (reworkAttempt <= 0) continue;
    byAttempt.set(reworkAttempt, [...(byAttempt.get(reworkAttempt) ?? []), item]);
  }
  return [...byAttempt.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([attempt, items]) => [
      '',
      `### Rework attempt ${attempt}`,
      '',
      'Human review comments were left during review, so Blast Furnace is redoing the work.',
      '',
      ...renderProgressTable(items),
    ]);
}

export function renderStatusComment(input: RenderStatusCommentInput): string {
  const marker = renderTrackerCommentMarker({
    kind: input.status.kind,
    runId: input.runId,
    owner: input.repository.owner,
    repo: input.repository.repo,
    issue: input.issueNumber,
  });
  const lines = [
    marker,
    '',
    `# ${input.status.heading ?? 'Blast Furnace status'}`,
    '',
    '| Picked up | Last update |',
    '|---|---|',
    `| ${formatTimestamp(input.status.pickedUpAt)} | ${formatTimestamp(input.status.lastChangedAt)} |`,
    '',
    `> ${input.status.focus ?? 'Current focus: Working'}`,
    '',
    '## Progress',
    '',
    ...renderProgressTable(mainItems(input.status.checklist)),
    ...renderReworkSections(input.status.checklist),
    ...renderReviewLoop(input.status.checklist),
  ];

  if (input.status.note) {
    lines.push('', '## Status note', '', input.status.note);
  }

  return lines.join('\n');
}
