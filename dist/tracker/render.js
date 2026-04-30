import { renderTrackerCommentMarker } from './markers.js';
import { statusIcon } from './status.js';
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function formatTimestamp(value) {
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
function mainItems(checklist) {
    const firstAttempt = checklist.filter((item) => item.attempt === 1 && item.stage !== 'review-feedback-loop');
    const hasRework = checklist.some((item) => item.attempt > 1);
    if (!hasRework) {
        return firstAttempt;
    }
    const review = firstAttempt.find((item) => item.stage === 'review');
    const beforeFinal = firstAttempt.filter((item) => item.stage !== 'draft-pr-and-in-review');
    const final = firstAttempt.find((item) => item.stage === 'draft-pr-and-in-review');
    const loop = {
        id: 'review-feedback-loop:attempt-1',
        stage: 'review-feedback-loop',
        attempt: 1,
        label: 'Review feedback loop',
        state: checklist.some((item) => item.state === 'failed' && item.stage === 'review') ? 'failed' : 'retrying',
        detail: review?.detail ?? 'Active',
    };
    return [...beforeFinal, loop, ...(final ? [final] : [])];
}
function renderProgressTable(items) {
    return [
        '|  | Stage | Status |',
        '|---|---|---|',
        ...items.map((item) => `| ${statusIcon(item.state)} | ${escapeCell(item.label)} | ${escapeCell(item.detail ?? '')} |`),
    ];
}
function renderReviewLoop(checklist) {
    const attempts = [...new Set(checklist.filter((item) => item.attempt > 1 || item.stage === 'review').map((item) => item.attempt))]
        .sort((a, b) => a - b);
    if (attempts.length <= 1) {
        return [];
    }
    const byId = new Map(checklist.map((item) => [item.id, item]));
    const row = (attempt) => {
        const develop = byId.get(`develop:attempt-${attempt}`);
        const quality = byId.get(`quality-gate:attempt-${attempt}`);
        const review = byId.get(`review:attempt-${attempt}`);
        const cell = (item) => {
            if (!item)
                return '⚪';
            const detail = item.detail ? ` ${item.detail}` : '';
            return `${statusIcon(item.state)}${detail}`;
        };
        return `| ${attempt} | ${escapeCell(cell(develop))} | ${escapeCell(cell(quality))} | ${escapeCell(cell(review))} |`;
    };
    return [
        '',
        '### Review feedback loop',
        '',
        '| Attempt | Develop | Quality Gate | Review |',
        '|---|---|---|---|',
        ...attempts.map(row),
    ];
}
export function renderStatusComment(input) {
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
        '| Взято в работу | Последнее изменение |',
        '|---|---|',
        `| ${formatTimestamp(input.status.pickedUpAt)} | ${formatTimestamp(input.status.lastChangedAt)} |`,
        '',
        `> ${input.status.focus ?? 'Current focus: Working'}`,
        '',
        '## Progress',
        '',
        ...renderProgressTable(mainItems(input.status.checklist)),
        ...renderReviewLoop(input.status.checklist),
    ];
    if (input.status.note) {
        lines.push('', '## Status note', '', input.status.note);
    }
    return lines.join('\n');
}
