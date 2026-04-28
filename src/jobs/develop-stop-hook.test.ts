import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { QualityGateResult } from '../types/index.js';
import {
  cleanupSuccessfulQualityArtifacts,
  handleDevelopStopHook,
  prepareDevelopStopHook,
  qualityResultForHandoff,
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

function runHookCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  stdin = '{}'
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Hook command timed out'));
    }, 30000);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
    child.stdin?.end(stdin);
  });
}

describe('develop stop hook state and adapter', () => {
  const tempRoots: string[] = [];
  let workspacePath: string;
  let runDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunQualityGate.mockReset();
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
    expect(prepared.hookCommand).toContain('develop-stop-hook-runner');
    expect(prepared.scriptPath).toContain('develop-stop-hook-runner');
    expect(prepared.scriptPath).not.toContain(runDir);
    await expect(access(join(runDir, 'quality', 'stop-hook.mjs'))).rejects.toThrow();
    expect(prepared.hookTimeoutSeconds).toBeGreaterThan(180);
  });

  it('installs the Codex Stop-hook config in the target workspace and excludes it from git changes', async () => {
    await mkdir(join(workspacePath, '.git', 'info'), { recursive: true });
    await writeFile(join(workspacePath, '.git', 'info', 'exclude'), '# local excludes\n', 'utf8');

    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });

    const hooksConfig = JSON.parse(await readFile(join(workspacePath, '.codex', 'hooks.json'), 'utf8'));
    expect(hooksConfig).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: prepared.hookCommand,
                timeout: prepared.hookTimeoutSeconds,
                statusMessage: 'Running Quality Gate',
              },
            ],
          },
        ],
      },
    });

    const exclude = await readFile(join(workspacePath, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('# local excludes');
    expect(exclude).toContain('.codex/');
    expect(exclude).toContain('.codex/hooks.json');
  });

  it('keeps stdout empty when the runner allows Stop after a passing Quality Gate', async () => {
    const passingTest = join(workspacePath, 'quality-passes.mjs');
    await writeFile(passingTest, 'process.exit(0);', 'utf8');
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(passingTest)}`,
      qualityGateTimeoutMs: 30000,
    });

    const result = await runHookCommand(prepared.hookCommand, workspacePath, {
      ...process.env,
      ...prepared.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
    await expect(readDevelopStopHookState(prepared.statePath)).resolves.toMatchObject({
      attempts: 1,
      blockedFailureCount: 0,
      lastQualityResult: { status: 'passed', attempts: 1 },
    });
  });

  it('writes a block decision to stdout when the runner blocks Stop after a failed Quality Gate', async () => {
    const failingTest = join(workspacePath, 'quality-fails.mjs');
    await writeFile(failingTest, 'console.error("intentional failure"); process.exit(1);', 'utf8');
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(failingTest)}`,
      qualityGateTimeoutMs: 30000,
    });

    const result = await runHookCommand(prepared.hookCommand, workspacePath, {
      ...process.env,
      ...prepared.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('Quality Gate failed'),
    });
    await expect(readDevelopStopHookState(prepared.statePath)).resolves.toMatchObject({
      attempts: 1,
      blockedFailureCount: 1,
      lastQualityResult: { status: 'failed', attempts: 1 },
    });
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

  it('blocks a failed quality attempt and allows stop after the retry passes', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });
    mockRunQualityGate
      .mockResolvedValueOnce(quality('failed', 1))
      .mockResolvedValueOnce(quality('passed', 2));

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
    expect(second).toEqual({ decision: 'allow' });
    expect(mockRunQualityGate).toHaveBeenCalledTimes(2);
    await expect(readDevelopStopHookState(prepared.statePath)).resolves.toMatchObject({
      attempts: 2,
      blockedFailureCount: 1,
      outputPaths: ['/tmp/attempt-1.log', '/tmp/attempt-2.log'],
      lastQualityResult: { status: 'passed', attempts: 2 },
    });
  });

  it('runs a retry Quality Gate when Codex reports stop_hook_active but run state is inactive', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });
    await writeDevelopStopHookState(prepared.statePath, {
      attempts: 1,
      blockedFailureCount: 1,
      active: false,
      outputPaths: ['/tmp/attempt-1.log'],
      lastQualityResult: quality('failed', 1),
    });
    mockRunQualityGate.mockResolvedValueOnce(quality('passed', 2));

    const result = await handleDevelopStopHook({
      statePath: prepared.statePath,
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
      hookInput: { stop_hook_active: true },
    });

    expect(result).toEqual({ decision: 'allow' });
    expect(mockRunQualityGate).toHaveBeenCalledTimes(1);
    await expect(readDevelopStopHookState(prepared.statePath)).resolves.toMatchObject({
      attempts: 2,
      blockedFailureCount: 1,
      lastQualityResult: { status: 'passed', attempts: 2 },
    });
    await expect(prepared.readFinalQualityResult()).resolves.toMatchObject({
      status: 'passed',
      attempts: 2,
    });
  });

  it('does not expose blocked quality failures as final Develop results', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });

    await writeDevelopStopHookState(prepared.statePath, {
      attempts: 1,
      blockedFailureCount: 1,
      active: false,
      outputPaths: ['/tmp/attempt-1.log'],
      lastQualityResult: quality('failed', 1),
    });
    await expect(prepared.readFinalQualityResult()).resolves.toBeUndefined();

    await writeDevelopStopHookState(prepared.statePath, {
      attempts: 3,
      blockedFailureCount: 2,
      active: false,
      outputPaths: ['/tmp/attempt-1.log', '/tmp/attempt-2.log', '/tmp/attempt-3.log'],
      lastQualityResult: quality('failed', 3),
    });
    await expect(prepared.readFinalQualityResult()).resolves.toMatchObject({
      status: 'failed',
      attempts: 3,
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

  it('removes successful Quality Gate runtime artifacts and omits stale output paths from handoff data', async () => {
    const qualityDir = join(runDir, 'quality');
    const outputPath = join(qualityDir, 'attempt-1.log');
    await mkdir(qualityDir, { recursive: true });
    await writeFile(outputPath, 'test output', 'utf8');
    await writeFile(join(qualityDir, 'stop-hook-state.json'), '{}', 'utf8');
    const passed = {
      ...quality('passed', 1),
      outputPath,
    };

    expect(qualityResultForHandoff(passed)).not.toHaveProperty('outputPath');
    await expect(cleanupSuccessfulQualityArtifacts(runDir, passed)).resolves.toBe(true);
    await expect(access(qualityDir)).rejects.toThrow();
  });

  it('keeps failed Quality Gate runtime artifacts and preserves their output path', async () => {
    const qualityDir = join(runDir, 'quality');
    const outputPath = join(qualityDir, 'attempt-1.log');
    await mkdir(qualityDir, { recursive: true });
    await writeFile(outputPath, 'failing output', 'utf8');
    const failed = {
      ...quality('failed', 1),
      outputPath,
    };

    expect(qualityResultForHandoff(failed)).toHaveProperty('outputPath', outputPath);
    await expect(cleanupSuccessfulQualityArtifacts(runDir, failed)).resolves.toBe(false);
    await expect(access(outputPath)).resolves.toBeUndefined();
  });

  it('does not recursively start Quality Gate when run state is already active', async () => {
    const prepared = await prepareDevelopStopHook({
      runId: 'run-123',
      runDir,
      workspacePath,
      qualityGateCommand: 'npm test',
      qualityGateTimeoutMs: 180000,
    });

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
