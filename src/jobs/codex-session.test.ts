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

  it('builds Review args for read-only Codex execution with hooks disabled', () => {
    const args = buildCodexSessionArgs({
      cliCmd: 'codex',
      cliArgs: [],
      prompt: 'Review the workspace',
      model: 'gpt-5.4',
      enableHooks: false,
      bypassSandbox: false,
      sandboxMode: 'read-only',
      outputLastMessagePath: '/tmp/review-message.md',
    });

    expect(args).toEqual(expect.arrayContaining([
      'exec',
      '--sandbox',
      'read-only',
      '--model',
      'gpt-5.4',
      '--output-last-message',
      '/tmp/review-message.md',
    ]));
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain('codex_hooks');
    expect(args.at(-1)).toBe('Review the workspace');
  });
});
