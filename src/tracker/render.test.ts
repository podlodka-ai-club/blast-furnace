import { describe, expect, it } from 'vitest';
import { renderStatusComment } from './render.js';
import { createInitialStatusMetadata, createReworkStatusItems, makeStatusItem, upsertStatusItems } from './status.js';

const repository = { owner: 'owner', repo: 'repo' };

describe('status card renderer', () => {
  it('renders a status card without visible issue or run metadata', () => {
    const status = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const body = renderStatusComment({
      runId: 'run-123',
      repository,
      issueNumber: 42,
      status,
    });

    expect(body).toContain('<!-- blast-furnace:tracker-comment kind=orchestrator-status runId=run-123 owner=owner repo=repo issue=42 -->');
    expect(body).toContain('| Picked up | Last update |');
    expect(body).toContain('| ✅ | Task picked up |  |');
    expect(body).toContain('| ⚪ | Prepare run |  |');
    expect(body).not.toContain('Issue:');
    expect(body).not.toContain('Run:');
    expect(body).not.toContain('completed');
    expect(body).not.toContain('pending');
  });

  it('renders review feedback loop review statuses with icons', () => {
    const initial = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const status = {
      ...initial,
      heading: 'Blast Furnace is applying review feedback',
      focus: 'Current focus: Develop rework 2',
      checklist: upsertStatusItems(initial.checklist, [
        makeStatusItem('develop', 1, 'completed', 'Develop changes'),
        makeStatusItem('quality-gate', 1, 'completed', 'Quality Gate'),
        makeStatusItem('review', 1, 'retrying', 'Code Review', 'Changes requested'),
        makeStatusItem('develop', 2, 'completed', 'Develop rework 1'),
        makeStatusItem('quality-gate', 2, 'completed', 'Quality Gate rework 1'),
        makeStatusItem('review', 2, 'retrying', 'Code Review attempt 2', 'Changes requested'),
        makeStatusItem('develop', 3, 'in-progress', 'Develop rework 2', 'In progress'),
        makeStatusItem('quality-gate', 3, 'pending', 'Quality Gate rework 2'),
        makeStatusItem('review', 3, 'pending', 'Code Review attempt 3'),
      ]),
    };

    const body = renderStatusComment({
      runId: 'run-123',
      repository,
      issueNumber: 42,
      status,
    });

    expect(body).toContain('### Review feedback loop');
    expect(body).toContain('| 1 | ✅ | ✅ | 🟡 Changes requested |');
    expect(body).toContain('| 2 | ✅ | ✅ | 🟡 Changes requested |');
    expect(body).toContain('| 3 | 🔵 In progress | ⚪ | ⚪ |');
  });

  it('renders a rework attempt section with human review as the first row', () => {
    const initial = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const status = {
      ...initial,
      checklist: upsertStatusItems(initial.checklist, createReworkStatusItems(1)),
    };

    const body = renderStatusComment({
      runId: 'run-123',
      repository,
      issueNumber: 42,
      status,
    });

    expect(body).toContain('### Rework attempt 1');
    expect(body).toContain('Human review comments were left during review, so Blast Furnace is redoing the work.');
    expect(body).toContain('| 🟡 | Human Review | Rework needed |');
    expect(body.indexOf('| 🟡 | Human Review | Rework needed |')).toBeLessThan(
      body.indexOf('| ⚪ | Prepare run |  |', body.indexOf('### Rework attempt 1'))
    );
    expect(body.slice(body.indexOf('## Progress'), body.indexOf('### Rework attempt 1'))).not.toContain('Human Review');
  });

  it('renders multiple rework attempts as separate scoped sections', () => {
    const initial = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const status = {
      ...initial,
      checklist: upsertStatusItems(initial.checklist, [
        ...createReworkStatusItems(1),
        makeStatusItem('plan', 1, 'completed', 'Plan solution', undefined, 1),
        ...createReworkStatusItems(2),
        makeStatusItem('plan', 1, 'in-progress', 'Plan solution', 'In progress', 2),
      ]),
    };

    const body = renderStatusComment({
      runId: 'run-123',
      repository,
      issueNumber: 42,
      status,
    });

    expect(body).toContain('### Rework attempt 1');
    expect(body).toContain('### Rework attempt 2');
    expect(body).toContain('| ✅ | Plan solution |  |');
    expect(body).toContain('| 🔵 | Plan solution | In progress |');
    expect(body).not.toContain('### Review feedback loop');
  });

  it('renders PR-created tracker warning as a status note', () => {
    const initial = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const body = renderStatusComment({
      runId: 'run-123',
      repository,
      issueNumber: 42,
      status: {
        ...initial,
        heading: 'Blast Furnace created a pull request',
        focus: 'Result: Pull request #108 created',
        note: 'Pull request #108 was created, but moving the issue to `in review` failed.',
        checklist: upsertStatusItems(initial.checklist, [
          makeStatusItem('draft-pr-and-in-review', 1, 'completed', 'Make PR', 'PR created, tracker warning'),
        ]),
      },
    });

    expect(body).toContain('## Status note');
    expect(body).toContain('PR created, tracker warning');
    expect(body).toContain('Pull request #108 was created');
  });
});
