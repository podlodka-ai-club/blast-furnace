import * as pty from 'node-pty';
import path from 'node:path';
import type { Job } from 'bullmq';
import type { DevelopJobData, DevelopOutput, PlanOutput, QualityGateJobData } from '../types/index.js';
import { config } from '../config/index.js';
import { ensureNodePtySpawnHelperExecutable } from '../utils/node-pty.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  readValidatedStageInputRecord,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';

const DEFAULT_TIMEOUT_MS = 300000;
const CODEX_SUBCOMMANDS = new Set([
  'exec',
  'review',
  'login',
  'logout',
  'mcp',
  'mcp-server',
  'app-server',
  'app',
  'completion',
  'sandbox',
  'debug',
  'apply',
  'resume',
  'fork',
  'cloud',
  'features',
  'help',
]);

const DEVELOPMENT_RESULT = {
  status: 'completed',
  summary: 'Codex completed successfully.',
} as const;

function hasExplicitModelArg(args: string[]): boolean {
  return args.some((arg, index) => {
    if (arg === '-m' || arg === '--model') return true;
    if (arg.startsWith('--model=')) return true;
    return arg === '-c' && args[index + 1]?.startsWith('model=');
  });
}

function buildCodexCliArgs(cliCmd: string, cliArgs: string[], prompt: string, model: string): string[] {
  const invocationArgs = [...cliArgs];
  const hasExplicitSubcommand = invocationArgs.some((arg) => CODEX_SUBCOMMANDS.has(arg));
  const basename = path.basename(cliCmd);
  const appearsToBeCodexCommand = basename === 'codex' || basename === 'codex-cli' || invocationArgs.some((arg) => arg.includes('codex'));

  if (appearsToBeCodexCommand && !hasExplicitSubcommand) {
    invocationArgs.push('exec');
  }

  if (!invocationArgs.includes('--dangerously-bypass-approvals-and-sandbox')) {
    invocationArgs.push('--dangerously-bypass-approvals-and-sandbox');
  }

  if (model && !hasExplicitModelArg(invocationArgs)) {
    invocationArgs.push('--model', model);
  }

  invocationArgs.push(prompt);
  return invocationArgs;
}

function buildDevelopPrompt(data: PlanOutput): string {
  return [
    `Issue #${data.issue.number}: ${data.issue.title}`,
    '',
    data.issue.body ?? '(No description provided)',
    '',
    'Plan context:',
    JSON.stringify(data.plan, null, 2),
  ].join('\n');
}

export async function runDevelopWork(
  job: Job<DevelopJobData>,
  logger = createJobLogger(job)
): Promise<QualityGateJobData> {
  stagePayloadSchemas.develop.parse(job.data);
  const inputRecord = await readValidatedStageInputRecord(job.data);
  const planned = stageOutputSchemas.plan.parse(inputRecord.output);
  const { branchName, issue, workspacePath } = planned;
  const codexCliPath = process.env['CODEX_CLI_PATH'] ?? config.codex?.cliPath ?? 'npx @openai/codex';
  const codexModel = process.env['CODEX_MODEL'] ?? config.codex?.model ?? 'gpt-5.4';
  const timeoutMs = parseInt(
    process.env['CODEX_TIMEOUT_MS'] ?? String(config.codex?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    10
  );

  logger.info(`Running develop for issue #${issue.number} on branch ${branchName}`);

  const prompt = buildDevelopPrompt(planned);
  const cliParts = codexCliPath.split(/\s+/).filter(Boolean);
  if (cliParts.length === 0) {
    throw new Error('CODEX_CLI_PATH must not be empty');
  }

  const cliCmd = cliParts[0];
  const cliArgs = cliParts.slice(1);
  const finalCliArgs = buildCodexCliArgs(cliCmd, cliArgs, prompt, codexModel);

  await ensureNodePtySpawnHelperExecutable(logger);
  const ptyProcess = pty.spawn(cliCmd, finalCliArgs, {
    cwd: workspacePath,
    name: 'xterm-color',
    env: { ...process.env },
  });

  logger.info(`codex command: ${cliCmd} ${cliArgs.join(' ')}`.trim());

  ptyProcess.onData((data: string) => {
    const line = data.toString().trim();
    if (line) {
      logger.info(`[codex] ${line}`);
    }
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    const timer = setTimeout(() => {
      ptyProcess.kill('SIGTERM');
      settle(() => reject(new Error(`codex process timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      clearTimeout(timer);
      settle(() => resolve(exitCode));
    });
  });

  if (exitCode !== 0) {
    logger.error(`codex process exited with code ${exitCode}`);
    throw new Error(`codex process failed with exit code ${exitCode}`);
  }

  logger.info('codex process completed successfully');

  const output = stageOutputSchemas.develop.parse({
    ...planned,
    status: 'success',
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    development: DEVELOPMENT_RESULT,
  }) as DevelopOutput;
  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'develop',
    toStage: 'quality-gate',
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: job.data.inputRecordRef,
    status: 'success',
    output,
  });

  return createForwardStagePayload(job.data, 'quality-gate', inputRecordRef) as QualityGateJobData;
}

export async function runDevelopFlow(job: Job<DevelopJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const qualityGateJobData = await runDevelopWork(job, logger);
  const outputRecord = await readValidatedStageInputRecord(qualityGateJobData);
  const output = stageOutputSchemas.develop.parse(outputRecord.output);

  await scheduleNextJob(jobQueue, 'quality-gate', qualityGateJobData);
  logger.info(`Quality gate job enqueued for branch: ${output.branchName}`);
}

export const processDevelop = runDevelopFlow;
export const developHandler = processDevelop;
