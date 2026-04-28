import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractFailingTestNames,
  runQualityGate,
  summarizeQualityGateOutput,
} from './quality-gate-runner.js';

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

describe('quality gate runner', () => {
  const tempRoots: string[] = [];
  let workspacePath: string;
  let runDir: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'quality-workspace-'));
    const orchestrationRoot = await mkdtemp(join(tmpdir(), 'quality-orchestration-'));
    runDir = join(orchestrationRoot, '.orchestrator', 'runs', '2026-04-27_12.00_run-123');
    tempRoots.push(workspacePath, orchestrationRoot);
  });

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('executes the configured command from the target repository workspace', async () => {
    const result = await runQualityGate({
      command: nodeCommand('process.stdout.write(process.cwd())'),
      timeoutMs: 1000,
      workspacePath,
      runDir,
      attempt: 1,
    });

    expect(result).toMatchObject({
      status: 'passed',
      exitCode: 0,
      attempts: 1,
      command: expect.stringContaining('-e'),
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.summary).toContain(workspacePath);
    expect(result.outputPath).toBeDefined();
  });

  it('returns passed, failed, timed-out, and misconfigured outcomes with bounded result data', async () => {
    const passed = await runQualityGate({
      command: nodeCommand('process.stdout.write("ok")'),
      timeoutMs: 1000,
      workspacePath,
      runDir,
      attempt: 1,
    });
    const failed = await runQualityGate({
      command: nodeCommand('console.error("FAIL src/example.test.ts > should fail"); process.exit(2)'),
      timeoutMs: 1000,
      workspacePath,
      runDir,
      attempt: 2,
    });
    const timedOut = await runQualityGate({
      command: nodeCommand('setTimeout(() => {}, 1000)'),
      timeoutMs: 20,
      workspacePath,
      runDir,
      attempt: 3,
    });
    const misconfigured = await runQualityGate({
      command: '',
      timeoutMs: 1000,
      workspacePath,
      runDir,
      attempt: 4,
    });

    expect(passed.status).toBe('passed');
    expect(failed).toMatchObject({ status: 'failed', exitCode: 2, attempts: 2 });
    expect(failed.summary).toContain('src/example.test.ts > should fail');
    expect(timedOut).toMatchObject({ status: 'timed-out', attempts: 3 });
    expect(misconfigured).toMatchObject({
      status: 'misconfigured',
      command: '',
      attempts: 4,
      summary: expect.stringContaining('QUALITY_GATE_TEST_COMMAND'),
    });
  });

  it('writes full stdout and stderr to a run-scoped artifact outside the target workspace', async () => {
    const result = await runQualityGate({
      command: nodeCommand('console.log("stdout-line"); console.error("stderr-line"); process.exit(1)'),
      timeoutMs: 1000,
      workspacePath,
      runDir,
      attempt: 1,
    });

    expect(result.outputPath).toBeDefined();
    expect(relative(workspacePath, result.outputPath ?? '')).toMatch(/^\.\./);
    const artifact = await readFile(result.outputPath ?? '', 'utf8');
    expect(artifact).toContain('stdout-line');
    expect(artifact).toContain('stderr-line');
    expect(result.summary.length).toBeLessThan(2000);
  });

  it('summarizes recent output and extracts cheap failing test names', () => {
    const stdout = Array.from({ length: 80 }, (_, index) => `stdout ${index}`).join('\n');
    const stderr = [
      'FAIL src/runner.test.ts > quality gate runner > returns failed',
      '  × validates hook state',
      'AssertionError: expected true to be false',
    ].join('\n');

    const summary = summarizeQualityGateOutput({
      command: 'npm test',
      status: 'failed',
      exitCode: 1,
      durationMs: 123,
      stdout,
      stderr,
    });

    expect(summary).toContain('status: failed');
    expect(summary).toContain('src/runner.test.ts > quality gate runner > returns failed');
    expect(summary).toContain('validates hook state');
    expect(summary).not.toContain('stdout 0');
    expect(summary.length).toBeLessThan(2000);
    expect(extractFailingTestNames(stderr)).toEqual([
      'src/runner.test.ts > quality gate runner > returns failed',
      'validates hook state',
    ]);
  });
});
