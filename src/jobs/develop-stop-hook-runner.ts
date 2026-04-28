#!/usr/bin/env node
import { handleDevelopStopHook, type StopHookDecision } from './develop-stop-hook.js';

interface StopHookInput {
  stop_hook_active?: boolean;
}

function parseTimeout(value: string | undefined): number {
  const parsed = Number(value ?? '180000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180000;
}

async function readHookInput(): Promise<StopHookInput> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as StopHookInput
      : {};
  } catch {
    return {};
  }
}

async function run(): Promise<StopHookDecision> {
  const statePath = process.env['BLAST_FURNACE_STOP_HOOK_STATE_PATH'];
  const runDir = process.env['BLAST_FURNACE_STOP_HOOK_RUN_DIR'];
  const workspacePath = process.env['BLAST_FURNACE_WORKSPACE_PATH'];

  if (!statePath || !runDir || !workspacePath) {
    return { decision: 'allow' };
  }

  return handleDevelopStopHook({
    statePath,
    runDir,
    workspacePath,
    qualityGateCommand: process.env['BLAST_FURNACE_QUALITY_GATE_COMMAND'] ?? '',
    qualityGateTimeoutMs: parseTimeout(process.env['BLAST_FURNACE_QUALITY_GATE_TIMEOUT_MS']),
    hookInput: await readHookInput(),
  });
}

try {
  process.stdout.write(JSON.stringify(await run()));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Quality Gate Stop-hook failed: ${message}\n`);
  process.exitCode = 1;
}
