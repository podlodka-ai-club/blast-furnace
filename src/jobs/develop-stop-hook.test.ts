import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { QualityGateResult } from '../types/index.js';
import {
  handleDevelopStopHook,
  prepareDevelopStopHook,
  readDevelopStopHookState,
  writeDevelopStopHookState,
} from './develop-stop-hook.js';

const { mockRunQualityGate } = vi.hoisted(() => ({
  mockRunQualityGate: vi.fn(),
}));

vi.mock('./quality-gate-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./quality-gate-runner.js')>();
  return {
    ...actual,
    runQualityGate: mockRunQualityGate,
  };
});

function quality(status: QualityGateResult['status'], attempt: number): QualityGateResult {
  return {
    status,
    command: status === 'misconfigured' ? '' : 'npm test',
    exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : undefined,
    attempts: attempt,
    durationMs: 10,
    summary: `status: ${status}`,
    outputPath: `/tmp/attempt-${attempt}.log`,
  };
}

describe('develop stop hook state and adapter', () => {
  const tempRoots: string[] = [];
  let workspacePath: string;
  let runDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    workspacePath = await mkdtemp(join(tmpdir(), 'hook-workspace-'));
    const orchestrationRoot = await mkdtemp(join(tmpdir(), 'hook-orchestration-'));
    runDir = join(orchestrationRoot, '.orchestrator', 'runs', '2026-04-27_12.00_run-123');
    tempRoots.push(workspacePath, orchestrationRoot);
  });

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('persists run-scoped attempt count, blocked count, last result, output paths, and active guard', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });

    await writeDevelopStopHookState(prepared.statePath, {
      attempts: 2,
      blockedFailureCount: 1,
      active: true,
      outputPaths: ['/tmp/attempt-1.log'],
      lastQualityResult: quality('failed', 2),
    });

    await expect(readDevelopStopHookState(prepared.statePath)).resolves.toMatchObject({
      attempts: 2,
      blockedFailureCount: 1,
      active: true,
      outputPaths: ['/tmp/attempt-1.log'],
      lastQualityResult: {
        status: 'failed',
      },
    });
    expect(prepared.env).toMatchObject({
      BLAST_FURNACE_STOP_HOOK_STATE_PATH: prepared.statePath,
      BLAST_FURNACE_QUALITY_GATE_COMMAND: 'npm test',
    });
    expect(prepared.hookCommand).toContain(prepared.scriptPath);
    expect(prepared.hookTimeoutSeconds).toBeGreaterThan(180);
  });

  it('blocks the first and second failed quality attempts with bounded feedback', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });
    mockRunQualityGate
      .mockResolvedValueOnce(quality('failed', 1))
      .mockResolvedValueOnce(quality('timed-out', 2));

    const first = await handleDevelopStopHook({
      statePath: prepared.statePath,
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: {},
    });
    const second = await handleDevelopStopHook({
      statePath: prepared.statePath,
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: {},
    });

    expect(first).toMatchObject({ decision: 'block', reason: expect.stringContaining('status: failed') });
    expect(second).toMatchObject({ decision: 'block', reason: expect.stringContaining('status: timed-out') });
    await expect(readDevelopStopHookState(prepared.statePath)).resolves.toMatchObject({
      attempts: 2,
      blockedFailureCount: 2,
      lastQualityResult: { status: 'timed-out' },
    });
  });

  it('allows stop on the third failed attempt and persists terminal quality', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });
    await writeDevelopStopHookState(prepared.statePath, {
      attempts: 2,
      blockedFailureCount: 2,
      active: false,
      outputPaths: [],
      lastQualityResult: quality('failed', 2),
    });
    mockRunQualityGate.mockResolvedValueOnce(quality('failed', 3));

    const result = await handleDevelopStopHook({
      statePath: prepared.statePath,
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: {},
    });

    expect(result).toEqual({ decision: 'allow' });
    await expect(readDevelopStopHookState(prepared.statePath)).resolves.toMatchObject({
      attempts: 3,
      blockedFailureCount: 2,
      lastQualityResult: { status: 'failed', attempts: 3 },
    });
  });

  it('allows passed quality and records missing command as misconfigured without remediation loops', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });
    mockRunQualityGate.mockResolvedValueOnce(quality('passed', 1));

    await expect(handleDevelopStopHook({
      statePath: prepared.statePath,
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: {},
    })).resolves.toEqual({ decision: 'allow' });

    const missing = await prepareDevelopStopHook({
      runId: 'run-456',
      runDir: join(runDir, '..', '2026-04-27_12.01_run-456'),
      workspacePath,
      qualityGateCommand: undefined,
      qualityGateTimeoutMs: 180000,
    });
    await expect(handleDevelopStopHook({
      statePath: missing.statePath,
      runDir: missing.runDir,
      workspacePath,
      qualityGateCommand: undefined,
      qualityGateTimeoutMs: 180000,
      hookInput: {},
    })).resolves.toEqual({ decision: 'allow' });
    await expect(readDevelopStopHookState(missing.statePath)).resolves.toMatchObject({
      attempts: 1,
      blockedFailureCount: 0,
      lastQualityResult: {
        status: 'misconfigured',
      },
    });
  });

  it('does not recursively start Quality Gate when the hook input or state is already active', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });

    await expect(handleDevelopStopHook({
      statePath: prepared.statePath,
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: { stop_hook_active: true },
    })).resolves.toEqual({ decision: 'allow' });

    await writeDevelopStopHookState(prepared.statePath, {
      attempts: 0,
      blockedFailureCount: 0,
      active: true,
      outputPaths: [],
    });
    await expect(handleDevelopStopHook({
      statePath: prepared.statePath,
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: {},
    })).resolves.toEqual({ decision: 'allow' });
    expect(mockRunQualityGate).not.toHaveBeenCalled();
  });
});
