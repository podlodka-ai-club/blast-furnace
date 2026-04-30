import { describe, expect, it } from 'vitest';
import {
  createInitialStatusMetadata,
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
      makeStatusItem('review', 2, 'pending', 'Review attempt 2'),
    ]);

    expect(updated.filter((item) => item.id === 'develop:attempt-1')).toHaveLength(1);
    expect(updated.find((item) => item.id === 'develop:attempt-1')).toMatchObject({ state: 'completed' });
    expect(updated.find((item) => item.id === 'review:attempt-2')).toMatchObject({ state: 'pending' });
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
