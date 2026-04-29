import { describe, expect, it } from 'vitest';
import { buildCodexSessionArgs } from './codex-session.js';

describe('codex session helpers', () => {
  it('builds Plan continuation args that resume the last Codex session', () => {
    const args = buildCodexSessionArgs({
      cliCmd: 'codex',
      cliArgs: [],
      prompt: 'Continue planning',
      model: 'gpt-5.4',
      resumeLastSession: true,
      outputLastMessagePath: '/tmp/last-message.md',
    });

    expect(args).toEqual(expect.arrayContaining([
      'exec',
      'resume',
      '--last',
      '--output-last-message',
      '/tmp/last-message.md',
    ]));
    expect(args.at(-1)).toBe('Continue planning');
  });

  it('builds Develop args for a fresh Codex session with hooks enabled', () => {
    const args = buildCodexSessionArgs({
      cliCmd: 'codex',
      cliArgs: [],
      prompt: 'Implement the accepted plan',
      model: 'gpt-5.4',
      resumeLastSession: false,
      enableHooks: true,
    });

    expect(args).toEqual(expect.arrayContaining([
      'exec',
      '--enable',
      'codex_hooks',
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'gpt-5.4',
    ]));
    expect(args).not.toContain('resume');
    expect(args).not.toContain('--last');
    expect(args).not.toContain('--output-last-message');
    expect(args.at(-1)).toBe('Implement the accepted plan');
  });
});
