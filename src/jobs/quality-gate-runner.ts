import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { QualityGateResult, QualityGateStatus } from '../types/index.js';

const SUMMARY_MAX_CHARS = 1800;
const RECENT_OUTPUT_LINES = 30;

export interface QualityGateRunOptions {
  command?: string;
  timeoutMs: number;
  workspacePath: string;
  runDir: string;
  attempt: number;
  env?: NodeJS.ProcessEnv;
}

export interface QualityGateSummaryInput {
  command: string;
  status: QualityGateStatus;
  exitCode?: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function recentLines(text: string, maxLines = RECENT_OUTPUT_LINES): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-maxLines)
    .join('\n');
}

export function extractFailingTestNames(output: string, maxNames = 8): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /^\s*FAIL\s+(.+)$/,
    /^\s*[×✕✖x]\s+(.+)$/,
    /^\s*✗\s+(.+)$/,
    /^\s*\d+\)\s+(.+)$/,
    /^\s*Failed:\s+(.+)$/i,
  ];

  for (const line of output.split(/\r?\n/)) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1]?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
      if (names.length >= maxNames) return names;
    }
  }

  return names;
}

export function summarizeQualityGateOutput(input: QualityGateSummaryInput): string {
  const lines = [
    `Quality Gate command: ${input.command}`,
    `status: ${input.status}`,
    input.exitCode === undefined ? undefined : `exit code: ${input.exitCode}`,
    `duration: ${input.durationMs}ms`,
  ].filter((line): line is string => Boolean(line));

  const failingTests = extractFailingTestNames(`${input.stderr}\n${input.stdout}`);
  if (failingTests.length > 0) {
    lines.push('failing tests:');
    lines.push(...failingTests.map((name) => `- ${name}`));
  }

  const stderr = recentLines(input.stderr);
  if (stderr) {
    lines.push('recent stderr:');
    lines.push(stderr);
  }

  const stdout = recentLines(input.stdout);
  if (stdout) {
    lines.push('recent stdout:');
    lines.push(stdout);
  }

  return truncate(lines.join('\n'), SUMMARY_MAX_CHARS);
}

async function writeAttemptArtifact(
  runDir: string,
  attempt: number,
  command: string,
  status: QualityGateStatus,
  exitCode: number | undefined,
  stdout: string,
  stderr: string
): Promise<string> {
  const outputPath = join(runDir, 'quality', `attempt-${attempt}.log`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    [
      `command: ${command}`,
      `status: ${status}`,
      exitCode === undefined ? undefined : `exitCode: ${exitCode}`,
      '',
      '--- stdout ---',
      stdout,
      '',
      '--- stderr ---',
      stderr,
    ].filter((part): part is string => part !== undefined).join('\n'),
    'utf8'
  );
  return outputPath;
}

export async function runQualityGate(options: QualityGateRunOptions): Promise<QualityGateResult> {
  const command = options.command?.trim() ?? '';
  const startedAt = Date.now();

  if (!command) {
    return {
      status: 'misconfigured',
      command: '',
      attempts: options.attempt,
      durationMs: Date.now() - startedAt,
      summary: 'QUALITY_GATE_TEST_COMMAND is not configured.',
    };
  }

  return new Promise<QualityGateResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.workspacePath,
      env: options.env ?? process.env,
      shell: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const exitCode = typeof code === 'number' ? code : undefined;
      const status: QualityGateStatus = timedOut ? 'timed-out' : exitCode === 0 ? 'passed' : 'failed';

      try {
        const outputPath = await writeAttemptArtifact(
          options.runDir,
          options.attempt,
          command,
          status,
          exitCode,
          stdout,
          stderr
        );
        resolve({
          status,
          command,
          exitCode,
          attempts: options.attempt,
          durationMs,
          summary: summarizeQualityGateOutput({ command, status, exitCode, durationMs, stdout, stderr }),
          outputPath,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}
