import { describe, expect, it } from 'vitest';
import {
  createInitialStatusMetadata,
  createReworkStatusItems,
  makeStatusItem,
  statusIcon,
  statusItemId,
  upsertStatusItems,
} from './status.js';

describe('tracker status model', () => {
  it('creates the initial checklist with task pickup completed', () => {
    const status = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');

    expect(status.checklist.map((item) => item.id)).toEqual([
      'task-pickup:attempt-1',
      'prepare-run:attempt-1',
      'assess:attempt-1',
      'plan:attempt-1',
      'develop:attempt-1',
      'quality-gate:attempt-1',
      'review:attempt-1',
      'draft-pr-and-in-review:attempt-1',
    ]);
    expect(status.checklist[0]).toMatchObject({ state: 'completed' });
    expect(status.checklist[1]).toMatchObject({ state: 'pending' });
  });

  it('upserts status items by stable id without duplicates', () => {
    const status = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const updated = upsertStatusItems(status.checklist, [
      makeStatusItem('develop', 1, 'in-progress', 'Develop changes', 'In progress'),
      makeStatusItem('develop', 1, 'completed', 'Develop changes'),
      makeStatusItem('review', 2, 'pending', 'Code Review attempt 2'),
    ]);

    expect(updated.filter((item) => item.id === 'develop:attempt-1')).toHaveLength(1);
    expect(updated.find((item) => item.id === 'develop:attempt-1')).toMatchObject({ state: 'completed' });
    expect(updated.find((item) => item.id === 'review:attempt-2')).toMatchObject({ state: 'pending' });
  });

  it('clears stale status details when an item is completed without detail', () => {
    const status = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const inProgress = upsertStatusItems(status.checklist, [
      makeStatusItem('assess', 1, 'in-progress', 'Assess issue', 'In progress'),
    ]);
    const completed = upsertStatusItems(inProgress, [
      makeStatusItem('assess', 1, 'completed', 'Assess issue'),
    ]);

    expect(completed.find((item) => item.id === 'assess:attempt-1')).toEqual(
      expect.not.objectContaining({ detail: expect.any(String) })
    );
  });

  it('keeps initial and rework scoped ids distinct while upserting idempotently', () => {
    expect(statusItemId('plan', 1)).toBe('plan:attempt-1');
    expect(statusItemId('plan', 1, 1)).toBe('rework-1:plan:attempt-1');
    expect(statusItemId('plan', 1, 2)).toBe('rework-2:plan:attempt-1');

    const status = createInitialStatusMetadata('2026-04-30T10:00:00.000Z');
    const updated = upsertStatusItems(status.checklist, [
      makeStatusItem('plan', 1, 'completed', 'Plan solution'),
      makeStatusItem('plan', 1, 'pending', 'Plan solution', undefined, 1),
      makeStatusItem('plan', 1, 'completed', 'Plan solution', undefined, 1),
      makeStatusItem('plan', 1, 'pending', 'Plan solution', undefined, 2),
    ]);

    expect(updated.filter((item) => item.id === 'plan:attempt-1')).toHaveLength(1);
    expect(updated.filter((item) => item.id === 'rework-1:plan:attempt-1')).toHaveLength(1);
    expect(updated.filter((item) => item.id === 'rework-2:plan:attempt-1')).toHaveLength(1);
    expect(updated.find((item) => item.id === 'rework-1:plan:attempt-1')).toMatchObject({
      reworkAttempt: 1,
      state: 'completed',
    });
  });

  it('creates the full visible rework checklist rows for an attempt', () => {
    expect(createReworkStatusItems(1).map((item) => [item.id, item.label, item.state, item.detail])).toEqual([
      ['rework-1:human-review:attempt-1', 'Human Review', 'retrying', 'Rework needed'],
      ['rework-1:prepare-run:attempt-1', 'Prepare run', 'pending', undefined],
      ['rework-1:plan:attempt-1', 'Plan solution', 'pending', undefined],
      ['rework-1:develop:attempt-1', 'Develop changes', 'pending', undefined],
      ['rework-1:quality-gate:attempt-1', 'Quality Gate', 'pending', undefined],
      ['rework-1:review:attempt-1', 'Code Review', 'pending', undefined],
      ['rework-1:draft-pr-and-in-review:attempt-1', 'Make PR', 'pending', undefined],
    ]);
  });

  it('maps status state icons', () => {
    expect(statusIcon('completed')).toBe('✅');
    expect(statusIcon('in-progress')).toBe('🔵');
    expect(statusIcon('retrying')).toBe('🟡');
    expect(statusIcon('pending')).toBe('⚪');
    expect(statusIcon('failed')).toBe('❌');
    expect(statusIcon('skipped')).toBe('⏭️');
    expect(statusItemId('review', 2)).toBe('review:attempt-2');
  });
});
