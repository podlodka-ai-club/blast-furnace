import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  prepareDevelopStopHook,
  readDevelopStopHookState,
} from './develop-stop-hook.js';

const runSmoke = process.env['RUN_CODEX_STOP_HOOK_SMOKE'] === '1';

function splitCommand(command: string): { command: string; args: string[] } {
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('CODEX_CLI_PATH must not be empty');
  }
  return {
    command: parts[0],
    args: parts.slice(1),
  };
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`smoke process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

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
  });
}

describe.skipIf(!runSmoke)('Codex Stop-hook smoke', () => {
  it('blocks a real codex exec stop through codex_hooks and persists Quality Gate state', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'codex-hook-smoke-workspace-'));
    const orchestrationRoot = await mkdtemp(join(tmpdir(), 'codex-hook-smoke-orchestration-'));
    try {
      const runDir = join(orchestrationRoot, '.orchestrator', 'runs', 'smoke-run');
      const failingTest = join(workspacePath, 'quality-fails.mjs');
      await writeFile(failingTest, 'console.error("FAIL smoke.test.ts > stop hook blocks"); process.exit(1);', 'utf8');
      const prepared = await prepareDevelopStopHook({
        runId: 'smoke-run',
        runDir,
        workspacePath,
        qualityGateCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(failingTest)}`,
        qualityGateTimeoutMs: 30000,
      });
      const codex = splitCommand(process.env['CODEX_CLI_PATH'] ?? 'npx @openai/codex');
      const args = [
        ...codex.args,
        'exec',
        '--enable',
        'codex_hooks',
        '--model',
        process.env['CODEX_MODEL'] ?? 'gpt-5.4',
        '--sandbox',
        'workspace-write',
        '--skip-git-repo-check',
        'Do not modify files. Finish immediately.',
      ];

      const result = await runProcess(
        codex.command,
        args,
        workspacePath,
        { ...process.env, ...prepared.env },
        120000
      );
      const state = await readDevelopStopHookState(prepared.statePath);

      expect(`${result.stdout}\n${result.stderr}`).toContain('Quality');
      expect(state.blockedFailureCount).toBeGreaterThanOrEqual(1);
      expect(state.lastQualityResult).toMatchObject({
        status: 'failed',
      });
    } finally {
      await Promise.all([
        rm(workspacePath, { recursive: true, force: true }),
        rm(orchestrationRoot, { recursive: true, force: true }),
      ]);
    }
  }, 130000);
});
