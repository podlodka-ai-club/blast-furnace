import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runQualityGate } from './quality-gate-runner.js';
const CODEX_HOOKS_CONFIG_PATH = '.codex/hooks.json';
const CODEX_HOOKS_GIT_EXCLUDES = [
    '.codex/',
    CODEX_HOOKS_CONFIG_PATH,
];
function isErrnoException(err, code) {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}
function emptyState() {
    return {
        attempts: 0,
        blockedFailureCount: 0,
        active: false,
        outputPaths: [],
    };
}
export async function readDevelopStopHookState(statePath) {
    try {
        const raw = await readFile(statePath, 'utf8');
        return {
            ...emptyState(),
            ...JSON.parse(raw),
        };
    }
    catch (err) {
        if (isErrnoException(err, 'ENOENT')) {
            return emptyState();
        }
        throw err;
    }
}
export async function writeDevelopStopHookState(statePath, state) {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}
function blockReason(result) {
    return [
        'Quality Gate failed. Fix the failing tests before stopping.',
        result.summary,
        result.outputPath ? `Full output: ${result.outputPath}` : undefined,
    ].filter((line) => Boolean(line)).join('\n');
}
function misconfiguredResult(attempt) {
    return {
        status: 'misconfigured',
        command: '',
        attempts: attempt,
        durationMs: 0,
        summary: 'QUALITY_GATE_TEST_COMMAND is not configured.',
    };
}
function buildHookScript() {
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
async function pathExists(pathToCheck) {
    try {
        await stat(pathToCheck);
        return true;
    }
    catch (err) {
        if (isErrnoException(err, 'ENOENT')) {
            return false;
        }
        throw err;
    }
}
async function excludeCodexHooksFromWorkspaceGit(workspacePath) {
    const gitDir = join(workspacePath, '.git');
    if (!await pathExists(gitDir)) {
        return;
    }
    const excludePath = join(gitDir, 'info', 'exclude');
    await mkdir(dirname(excludePath), { recursive: true });
    let existing = '';
    try {
        existing = await readFile(excludePath, 'utf8');
    }
    catch (err) {
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
async function writeCodexStopHookConfig(workspacePath, hookCommand, hookTimeoutSeconds) {
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
export async function prepareDevelopStopHook(options) {
    const qualityDir = join(options.runDir, 'quality');
    const statePath = join(qualityDir, 'stop-hook-state.json');
    const scriptPath = join(qualityDir, 'stop-hook.mjs');
    await mkdir(qualityDir, { recursive: true });
    await writeDevelopStopHookState(statePath, await readDevelopStopHookState(statePath));
    await writeFile(scriptPath, buildHookScript(), { encoding: 'utf8', mode: 0o755 });
    const hookCommand = `node ${JSON.stringify(scriptPath)}`;
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
        readFinalQualityResult: async () => (await readDevelopStopHookState(statePath)).lastQualityResult,
    };
}
export async function handleDevelopStopHook(input) {
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
    let result;
    try {
        result = await runQualityGate({
            command: input.qualityGateCommand,
            timeoutMs: input.qualityGateTimeoutMs,
            workspacePath: input.workspacePath,
            runDir: input.runDir,
            attempt,
        });
    }
    finally {
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
