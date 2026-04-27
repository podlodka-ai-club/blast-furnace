import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { QualityGateResult } from '../types/index.js';
import { runQualityGate } from './quality-gate-runner.js';

export interface DevelopStopHookState {
  attempts: number;
  blockedFailureCount: number;
  active: boolean;
  outputPaths: string[];
  lastQualityResult?: QualityGateResult;
}

export interface PrepareDevelopStopHookOptions {
  runId: string;
  runDir: string;
  workspacePath: string;
  qualityGateCommand?: string;
  qualityGateTimeoutMs: number;
}

export interface PreparedDevelopStopHook {
  runDir: string;
  statePath: string;
  scriptPath: string;
  hookCommand: string;
  hookTimeoutSeconds: number;
  env: NodeJS.ProcessEnv;
  readFinalQualityResult(): Promise<QualityGateResult | undefined>;
}

export interface DevelopStopHookInput {
  statePath: string;
  runDir: string;
  workspacePath: string;
  qualityGateCommand?: string;
  qualityGateTimeoutMs: number;
  hookInput?: {
    stop_hook_active?: boolean;
  };
}

export type StopHookDecision =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string };

function emptyState(): DevelopStopHookState {
  return {
    attempts: 0,
    blockedFailureCount: 0,
    active: false,
    outputPaths: [],
  };
}

export async function readDevelopStopHookState(statePath: string): Promise<DevelopStopHookState> {
  try {
    const raw = await readFile(statePath, 'utf8');
    return {
      ...emptyState(),
      ...JSON.parse(raw) as Partial<DevelopStopHookState>,
    };
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return emptyState();
    }
    throw err;
  }
}

export async function writeDevelopStopHookState(
  statePath: string,
  state: DevelopStopHookState
): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function blockReason(result: QualityGateResult): string {
  return [
    'Quality Gate failed. Fix the failing tests before stopping.',
    result.summary,
    result.outputPath ? `Full output: ${result.outputPath}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function misconfiguredResult(attempt: number): QualityGateResult {
  return {
    status: 'misconfigured',
    command: '',
    attempts: attempt,
    durationMs: 0,
    summary: 'QUALITY_GATE_TEST_COMMAND is not configured.',
  };
}

function buildHookScript(): string {
  return `#!/usr/bin/env node
const fs = await import('node:fs/promises');
const { spawn } = await import('node:child_process');

const statePath = process.env.BLAST_FURNACE_STOP_HOOK_STATE_PATH;
const runDir = process.env.BLAST_FURNACE_STOP_HOOK_RUN_DIR;
const workspacePath = process.env.BLAST_FURNACE_WORKSPACE_PATH;
const command = process.env.BLAST_FURNACE_QUALITY_GATE_COMMAND || '';
const timeoutMs = Number(process.env.BLAST_FURNACE_QUALITY_GATE_TIMEOUT_MS || '180000');
let input = {};
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  input = raw ? JSON.parse(raw) : {};
} catch {}
async function readState() {
  try {
    return { attempts: 0, blockedFailureCount: 0, active: false, outputPaths: [], ...JSON.parse(await fs.readFile(statePath, 'utf8')) };
  } catch {
    return { attempts: 0, blockedFailureCount: 0, active: false, outputPaths: [] };
  }
}
async function writeState(state) {
  await fs.mkdir(new URL('.', 'file://' + statePath).pathname, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}
function allow() {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
}
if (!statePath || !runDir || !workspacePath) allow();
else {
  const state = await readState();
  if (input.stop_hook_active || state.active) allow();
  else if (!command.trim()) {
    const result = { status: 'misconfigured', command: '', attempts: state.attempts + 1, durationMs: 0, summary: 'QUALITY_GATE_TEST_COMMAND is not configured.' };
    await writeState({ ...state, attempts: state.attempts + 1, active: false, lastQualityResult: result });
    allow();
  } else {
    const attempt = state.attempts + 1;
    await writeState({ ...state, attempts: attempt, active: true });
    const startedAt = Date.now();
    const child = spawn(command, { cwd: workspacePath, shell: true, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', async (code) => {
      clearTimeout(timer);
      const status = timedOut ? 'timed-out' : code === 0 ? 'passed' : 'failed';
      const outputPath = runDir + '/quality/attempt-' + attempt + '.log';
      await fs.mkdir(runDir + '/quality', { recursive: true });
      await fs.writeFile(outputPath, stdout + '\\n--- stderr ---\\n' + stderr);
      const result = { status, command, exitCode: typeof code === 'number' ? code : undefined, attempts: attempt, durationMs: Date.now() - startedAt, summary: ['Quality Gate command: ' + command, 'status: ' + status, stderr, stdout].filter(Boolean).join('\\n').slice(-1800), outputPath };
      const nextState = { ...state, attempts: attempt, active: false, lastQualityResult: result, outputPaths: [...(state.outputPaths || []), outputPath] };
      if ((status === 'failed' || status === 'timed-out') && state.blockedFailureCount < 2) {
        nextState.blockedFailureCount = state.blockedFailureCount + 1;
        await writeState(nextState);
        process.stdout.write(JSON.stringify({ decision: 'block', reason: result.summary }));
      } else {
        await writeState(nextState);
        allow();
      }
    });
  }
}
`;
}

export async function prepareDevelopStopHook(
  options: PrepareDevelopStopHookOptions
): Promise<PreparedDevelopStopHook> {
  const qualityDir = join(options.runDir, 'quality');
  const statePath = join(qualityDir, 'stop-hook-state.json');
  const scriptPath = join(qualityDir, 'stop-hook.mjs');
  await mkdir(qualityDir, { recursive: true });
  await writeDevelopStopHookState(statePath, await readDevelopStopHookState(statePath));
  await writeFile(scriptPath, buildHookScript(), { encoding: 'utf8', mode: 0o755 });
  const hookCommand = `node ${JSON.stringify(scriptPath)}`;
  const hookTimeoutSeconds = Math.max(1, Math.ceil(options.qualityGateTimeoutMs / 1000) + 5);

  return {
    runDir: options.runDir,
    statePath,
    scriptPath,
    hookCommand,
    hookTimeoutSeconds,
    env: {
      BLAST_FURNACE_STOP_HOOK_STATE_PATH: statePath,
      BLAST_FURNACE_STOP_HOOK_RUN_DIR: options.runDir,
      BLAST_FURNACE_STOP_HOOK_SCRIPT_PATH: scriptPath,
      BLAST_FURNACE_WORKSPACE_PATH: options.workspacePath,
      BLAST_FURNACE_QUALITY_GATE_COMMAND: options.qualityGateCommand ?? '',
      BLAST_FURNACE_QUALITY_GATE_TIMEOUT_MS: String(options.qualityGateTimeoutMs),
      CODEX_STOP_HOOK_COMMAND: hookCommand,
    },
    readFinalQualityResult: async () => (await readDevelopStopHookState(statePath)).lastQualityResult,
  };
}

export async function handleDevelopStopHook(input: DevelopStopHookInput): Promise<StopHookDecision> {
  let state = await readDevelopStopHookState(input.statePath);
  if (input.hookInput?.stop_hook_active || state.active) {
    return { decision: 'allow' };
  }

  const attempt = state.attempts + 1;
  if (!input.qualityGateCommand?.trim()) {
    const result = misconfiguredResult(attempt);
    await writeDevelopStopHookState(input.statePath, {
      ...state,
      attempts: attempt,
      active: false,
      lastQualityResult: result,
    });
    return { decision: 'allow' };
  }

  await writeDevelopStopHookState(input.statePath, {
    ...state,
    attempts: attempt,
    active: true,
  });

  let result: QualityGateResult;
  try {
    result = await runQualityGate({
      command: input.qualityGateCommand,
      timeoutMs: input.qualityGateTimeoutMs,
      workspacePath: input.workspacePath,
      runDir: input.runDir,
      attempt,
    });
  } finally {
    state = await readDevelopStopHookState(input.statePath);
    await writeDevelopStopHookState(input.statePath, {
      ...state,
      active: false,
    });
  }

  state = await readDevelopStopHookState(input.statePath);
  const outputPaths = result.outputPath ? [...state.outputPaths, result.outputPath] : state.outputPaths;
  const shouldBlock = ['failed', 'timed-out'].includes(result.status) && state.blockedFailureCount < 2;
  await writeDevelopStopHookState(input.statePath, {
    ...state,
    active: false,
    attempts: attempt,
    blockedFailureCount: shouldBlock ? state.blockedFailureCount + 1 : state.blockedFailureCount,
    outputPaths,
    lastQualityResult: result,
  });

  if (shouldBlock) {
    return {
      decision: 'block',
      reason: blockReason(result),
    };
  }

  return { decision: 'allow' };
}
