import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import type { DevelopJobData, DevelopOutput, QualityGateResult, ReviewJobData } from '../types/index.js';
import { config } from '../config/index.js';
import { buildCodexSessionArgs, runCodexSession } from './codex-session.js';
import {
  cleanupSuccessfulQualityArtifacts,
  handleDevelopStopHook,
  prepareDevelopStopHook,
  qualityResultForHandoff,
} from './develop-stop-hook.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveDevelopContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
import {
  developStatusItem,
  qualityStatusItem,
  reviewStatusItem,
  statusItem,
  updateRunStatus,
} from './status.js';

export const DEVELOP_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'develop.md');
export const DEVELOP_REWORK_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'develop-rework.md');

const DEVELOPMENT_RESULT = {
  status: 'completed',
  summary: 'Codex completed successfully.',
} as const;

export interface DevelopWorkResult {
  output: DevelopOutput;
  reviewJobData?: ReviewJobData;
}

export function buildCodexCliArgs(cliCmd: string, cliArgs: string[], prompt: string, model: string): string[] {
  return buildCodexSessionArgs({
    cliCmd,
    cliArgs,
    prompt,
    model,
    enableHooks: true,
    resumeLastSession: false,
  });
}

function parseMinimumTimeout(value: string | undefined, defaultVal: number): number {
  const parsed = parseInt(value ?? String(defaultVal), 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return defaultVal;
  }
  return parsed;
}

export interface DevelopPromptInput {
  planContent: string;
  reviewContent?: string;
}

export async function renderDevelopPrompt(templatePath: string, input: DevelopPromptInput): Promise<string> {
  const template = await readFile(templatePath, 'utf8');
  const replacements: Record<string, string> = {
    planContent: input.planContent,
    reviewContent: input.reviewContent ?? '',
  };

  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key: string) => replacements[key] ?? match);
}

export async function runDevelopWork(
  job: Job<DevelopJobData>,
  logger = createJobLogger(job)
): Promise<DevelopWorkResult> {
  stagePayloadSchemas.develop.parse(job.data);
  const context = await resolveDevelopContext(job.data);
  const { branchName, issue, workspacePath } = context.runContext;
  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  const attempt = job.data.stageAttempt;
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: context.inputKind === 'review-rework'
      ? 'Blast Furnace is applying review feedback'
      : 'Blast Furnace is building a solution',
    focus: `Current focus: ${attempt === 1 ? 'Develop changes' : `Develop rework ${attempt - 1}`}`,
    items: [
      developStatusItem(attempt, 'in-progress', 'In progress'),
      qualityStatusItem(attempt, 'pending'),
      reviewStatusItem(attempt, 'pending'),
    ],
  }, logger);
  const qualityGateCommand = process.env['QUALITY_GATE_TEST_COMMAND'] ?? config.qualityGate?.testCommand;
  const qualityGateTimeoutMs = parseMinimumTimeout(
    process.env['QUALITY_GATE_TEST_TIMEOUT_MS'],
    config.qualityGate?.testTimeoutMs ?? 180000
  );

  logger.info(`Running develop for issue #${issue.number} on branch ${branchName}`);

  const promptTemplatePath = context.inputKind === 'review-rework'
    ? DEVELOP_REWORK_PROMPT_TEMPLATE_PATH
    : DEVELOP_PROMPT_TEMPLATE_PATH;
  const prompt = await renderDevelopPrompt(promptTemplatePath, {
    planContent: context.plan.content,
    reviewContent: context.reviewFailureContent,
  });
  const stopHook = await prepareDevelopStopHook({
    runId: job.data.runId,
    runDir: job.data.inputRecordRef.runDir,
    workspacePath,
    qualityGateCommand,
    qualityGateTimeoutMs,
  });
  await runCodexSession({
    prompt,
    workspacePath,
    logger,
    resumeLastSession: false,
    enableHooks: true,
    env: stopHook.env,
    logPrefix: 'codex',
    timeoutLabel: 'codex process',
  });

  logger.info('codex process completed successfully');

  let quality = await stopHook.readFinalQualityResult();
  if (!quality) {
    logger.warn('Quality Gate did not produce a Stop-hook result before Codex stopped; running fallback Quality Gate');
    for (let fallbackAttempt = 0; fallbackAttempt < 3 && !quality; fallbackAttempt += 1) {
      const decision = await handleDevelopStopHook({
        statePath: stopHook.statePath,
        runDir: stopHook.runDir,
        workspacePath,
        qualityGateCommand,
        qualityGateTimeoutMs,
        hookInput: {},
      });
      quality = await stopHook.readFinalQualityResult();
      if (decision.decision === 'allow' && !quality) {
        break;
      }
    }
    if (!quality) {
      if (!qualityGateCommand?.trim()) {
        throw new Error('Quality Gate did not record misconfiguration before Codex stopped');
      }
      throw new Error('Quality Gate did not produce a Stop-hook result before Codex stopped');
    }
  }

  const terminalStatusByQualityStatus: Partial<Record<QualityGateResult['status'], DevelopOutput['status']>> = {
    failed: 'quality-failed',
    'timed-out': 'quality-timed-out',
    misconfigured: 'quality-misconfigured',
  };
  const outputStatus = quality.status === 'passed' ? 'success' : terminalStatusByQualityStatus[quality.status];
  if (!outputStatus) {
    throw new Error(`Unsupported Quality Gate status: ${quality.status}`);
  }
  const handoffQuality = qualityResultForHandoff(quality);
  const output = stageOutputSchemas.develop.parse({
    status: outputStatus,
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    development: DEVELOPMENT_RESULT,
    quality: handoffQuality,
  }) as DevelopOutput;
  const toStage = output.status === 'success' ? 'review' : null;
  const handoffStatus = output.status === 'quality-misconfigured'
    ? 'blocked'
    : output.status === 'success'
      ? 'success'
      : 'failure';
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'develop',
    toStage,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: context.inputKind === 'review-rework'
      ? [job.data.inputRecordRef, context.planRecord.recordId]
      : [job.data.inputRecordRef],
    status: handoffStatus,
    output,
  }, toStage === null ? output.status : undefined);
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: output.status === 'success'
      ? 'Blast Furnace is ready for review'
      : 'Blast Furnace stopped during Quality Gate',
    focus: output.status === 'success'
      ? `Current focus: ${attempt === 1 ? 'Review' : `Review attempt ${attempt}`}`
      : `Final state: Quality Gate ${output.quality.status}`,
    items: output.status === 'success'
      ? [
          developStatusItem(attempt, 'completed'),
          qualityStatusItem(attempt, 'completed'),
          reviewStatusItem(attempt, 'pending'),
        ]
      : [
          developStatusItem(attempt, 'failed', 'Quality Gate failed'),
          qualityStatusItem(attempt, 'failed', output.quality.status),
          reviewStatusItem(attempt, 'skipped'),
          statusItem('draft-pr-and-in-review', 1, 'skipped', 'Draft PR + move to `in review`'),
        ],
  }, logger);

  try {
    await cleanupSuccessfulQualityArtifacts(stopHook.runDir, quality);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to clean up successful Quality Gate artifacts for run ${job.data.runId}: ${message}`);
  }

  return {
    output,
    reviewJobData: toStage === 'review'
      ? createForwardStagePayload(job.data, 'review', inputRecordRef, job.data.stageAttempt) as ReviewJobData
      : undefined,
  };
}

export async function runDevelopFlow(job: Job<DevelopJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const result = await runDevelopWork(job, logger);

  if (!result.reviewJobData) {
    logger.info(`Develop stopped after ${result.output.status} for run: ${job.data.runId}`);
    return;
  }

  await scheduleNextJob(jobQueue, 'review', result.reviewJobData);
  logger.info(`Review job enqueued for run: ${job.data.runId}`);
}

export const processDevelop = runDevelopFlow;
export const developHandler = processDevelop;
