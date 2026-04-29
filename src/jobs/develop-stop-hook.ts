import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QualityGateResult } from '../types/index.js';
import { runQualityGate } from './quality-gate-runner.js';

const CODEX_HOOKS_CONFIG_PATH = '.codex/hooks.json';
const CODEX_HOOKS_GIT_EXCLUDES = [
  '.codex/',
  CODEX_HOOKS_CONFIG_PATH,
];

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
  hookConfigPath: string;
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

function isErrnoException(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

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
    if (isErrnoException(err, 'ENOENT')) {
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

function localTsxLoaderPath(): string | undefined {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs'),
    join(currentDir, '..', '..', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function quoteCommandPart(value: string): string {
  return JSON.stringify(value);
}

export function resolveDevelopStopHookRunner(): { scriptPath: string; hookCommand: string } {
  const currentPath = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentPath);
  const sourceMode = extname(currentPath) === '.ts';
  const scriptPath = join(currentDir, sourceMode ? 'develop-stop-hook-runner.ts' : 'develop-stop-hook-runner.js');

  if (sourceMode) {
    const tsxLoaderPath = localTsxLoaderPath();
    const hookCommand = tsxLoaderPath
      ? `${quoteCommandPart(process.execPath)} --import ${quoteCommandPart(tsxLoaderPath)} ${quoteCommandPart(scriptPath)}`
      : `${quoteCommandPart(process.execPath)} --import tsx ${quoteCommandPart(scriptPath)}`;
    return { scriptPath, hookCommand };
  }

  return {
    scriptPath,
    hookCommand: `${quoteCommandPart(process.execPath)} ${quoteCommandPart(scriptPath)}`,
  };
}

export function qualityResultForHandoff(result: QualityGateResult): QualityGateResult {
  if (result.status !== 'passed' || result.outputPath === undefined) {
    return result;
  }

  const handoffResult: QualityGateResult = { ...result };
  delete handoffResult.outputPath;
  return handoffResult;
}

export function finalQualityResultFromState(
  state: DevelopStopHookState
): QualityGateResult | undefined {
  const result = state.lastQualityResult;
  if (!result) {
    return undefined;
  }

  if (result.status === 'passed' || result.status === 'misconfigured') {
    return result;
  }

  if (result.status === 'failed' || result.status === 'timed-out') {
    return state.blockedFailureCount >= 2 && result.attempts > state.blockedFailureCount
      ? result
      : undefined;
  }

  return undefined;
}

export async function cleanupSuccessfulQualityArtifacts(
  runDir: string,
  result: QualityGateResult
): Promise<boolean> {
  if (result.status !== 'passed') {
    return false;
  }

  await rm(join(runDir, 'quality'), { recursive: true, force: true });
  return true;
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await stat(pathToCheck);
    return true;
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return false;
    }
    throw err;
  }
}

async function excludeCodexHooksFromWorkspaceGit(workspacePath: string): Promise<void> {
  const gitDir = join(workspacePath, '.git');
  if (!await pathExists(gitDir)) {
    return;
  }

  const excludePath = join(gitDir, 'info', 'exclude');
  await mkdir(dirname(excludePath), { recursive: true });

  let existing = '';
  try {
    existing = await readFile(excludePath, 'utf8');
  } catch (err) {
    if (!isErrnoException(err, 'ENOENT')) {
      throw err;
    }
  }

  const existingEntries = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const additions = CODEX_HOOKS_GIT_EXCLUDES.filter((entry) => !existingEntries.has(entry));
  if (additions.length === 0) {
    return;
  }

  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await writeFile(excludePath, `${existing}${separator}${additions.join('\n')}\n`, 'utf8');
}

async function writeCodexStopHookConfig(
  workspacePath: string,
  hookCommand: string,
  hookTimeoutSeconds: number
): Promise<string> {
  const hookConfigPath = join(workspacePath, CODEX_HOOKS_CONFIG_PATH);
  await mkdir(dirname(hookConfigPath), { recursive: true });
  await writeFile(hookConfigPath, JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand,
              timeout: hookTimeoutSeconds,
              statusMessage: 'Running Quality Gate',
            },
          ],
        },
      ],
    },
  }, null, 2), 'utf8');
  await excludeCodexHooksFromWorkspaceGit(workspacePath);
  return hookConfigPath;
}

export async function prepareDevelopStopHook(
  options: PrepareDevelopStopHookOptions
): Promise<PreparedDevelopStopHook> {
  const qualityDir = join(options.runDir, 'quality');
  const statePath = join(qualityDir, 'stop-hook-state.json');
  const { scriptPath, hookCommand } = resolveDevelopStopHookRunner();
  await mkdir(qualityDir, { recursive: true });
  await writeDevelopStopHookState(statePath, await readDevelopStopHookState(statePath));
  const hookTimeoutSeconds = Math.max(1, Math.ceil(options.qualityGateTimeoutMs / 1000) + 5);
  const hookConfigPath = await writeCodexStopHookConfig(options.workspacePath, hookCommand, hookTimeoutSeconds);

  return {
    runDir: options.runDir,
    statePath,
    scriptPath,
    hookConfigPath,
    hookCommand,
    hookTimeoutSeconds,
    env: {
      BLAST_FURNACE_STOP_HOOK_STATE_PATH: statePath,
      BLAST_FURNACE_STOP_HOOK_RUN_DIR: options.runDir,
      BLAST_FURNACE_STOP_HOOK_SCRIPT_PATH: scriptPath,
      BLAST_FURNACE_STOP_HOOK_CONFIG_PATH: hookConfigPath,
      BLAST_FURNACE_WORKSPACE_PATH: options.workspacePath,
      BLAST_FURNACE_QUALITY_GATE_COMMAND: options.qualityGateCommand ?? '',
      BLAST_FURNACE_QUALITY_GATE_TIMEOUT_MS: String(options.qualityGateTimeoutMs),
      CODEX_STOP_HOOK_COMMAND: hookCommand,
    },
    readFinalQualityResult: async () => finalQualityResultFromState(await readDevelopStopHookState(statePath)),
  };
}

export async function handleDevelopStopHook(input: DevelopStopHookInput): Promise<StopHookDecision> {
  let state = await readDevelopStopHookState(input.statePath);
  if (state.active) {
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
