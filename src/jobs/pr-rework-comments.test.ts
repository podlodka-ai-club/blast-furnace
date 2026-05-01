import { describe, expect, it } from 'vitest';
import { buildPrReworkCommentsMarkdown } from './pr-rework-comments.js';

describe('PR rework comment rendering', () => {
  it('excludes Blast Furnace, bot, outdated, resolved, deleted, and out-of-window comments', () => {
    const markdown = buildPrReworkCommentsMarkdown({
      blastFurnaceLogin: 'blast-furnace',
      since: '2026-04-30T10:00:00.000Z',
      until: '2026-04-30T11:00:00.000Z',
      reviewComments: [
        {
          id: 1,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Please add a regression test.',
          createdAt: '2026-04-30T10:30:00.000Z',
          path: 'src/jobs/develop.ts',
          line: 42,
          originalLine: 40,
          outdated: false,
          resolved: false,
          deleted: false,
        },
        {
          id: 2,
          authorLogin: 'blast-furnace',
          authorType: 'User',
          body: 'Self-authored comment.',
          createdAt: '2026-04-30T10:30:00.000Z',
          outdated: false,
          resolved: false,
          deleted: false,
        },
        {
          id: 3,
          authorLogin: 'ci-bot',
          authorType: 'Bot',
          body: 'Bot comment.',
          createdAt: '2026-04-30T10:30:00.000Z',
          outdated: false,
          resolved: false,
          deleted: false,
        },
        {
          id: 4,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Outdated comment.',
          createdAt: '2026-04-30T10:30:00.000Z',
          outdated: true,
          resolved: false,
          deleted: false,
        },
        {
          id: 5,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Resolved comment.',
          createdAt: '2026-04-30T10:30:00.000Z',
          outdated: false,
          resolved: true,
          deleted: false,
        },
        {
          id: 6,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Deleted comment.',
          createdAt: '2026-04-30T10:30:00.000Z',
          outdated: false,
          resolved: false,
          deleted: true,
        },
        {
          id: 7,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Old comment.',
          createdAt: '2026-04-30T09:59:59.000Z',
          outdated: false,
          resolved: false,
          deleted: false,
        },
      ],
      pullRequestComments: [
        {
          id: 8,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Top-level PR feedback.',
          createdAt: '2026-04-30T10:45:00.000Z',
        },
      ],
    });

    expect(markdown).toContain('Please add a regression test.');
    expect(markdown).toContain('Top-level PR feedback.');
    expect(markdown).not.toContain('Self-authored comment.');
    expect(markdown).not.toContain('Bot comment.');
    expect(markdown).not.toContain('Outdated comment.');
    expect(markdown).not.toContain('Resolved comment.');
    expect(markdown).not.toContain('Deleted comment.');
    expect(markdown).not.toContain('Old comment.');
  });

  it('renders File and Line only for comments with location values', () => {
    const markdown = buildPrReworkCommentsMarkdown({
      reviewComments: [
        {
          id: 1,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'Located comment.',
          createdAt: '2026-04-30T10:00:00.000Z',
          path: 'src/file.ts',
          line: 12,
          outdated: false,
          resolved: false,
          deleted: false,
        },
        {
          id: 2,
          authorLogin: 'reviewer',
          authorType: 'User',
          body: 'No location comment.',
          createdAt: '2026-04-30T10:05:00.000Z',
          outdated: false,
          resolved: false,
          deleted: false,
        },
      ],
      pullRequestComments: [],
    });

    expect(markdown).toContain('File: `src/file.ts`');
    expect(markdown).toContain('Line: 12');
    expect(markdown).toContain('No location comment.');
    expect(markdown).not.toContain('File: undefined');
    expect(markdown).not.toContain('Line: undefined');
  });
});
