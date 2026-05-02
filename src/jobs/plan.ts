import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Job } from 'bullmq';
import type { DevelopJobData, GitHubIssue, HandoffRecordDependency, InputRecordRef, PlanJobData, PlanOutput } from '../types/index.js';
import { runCodexSession } from './codex-session.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolvePlanContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
import { statusItem, updateRunStatus } from './status.js';

const MAX_PLAN_ATTEMPTS = 3;
export const PLAN_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'plan.md');
export const PLAN_REWORK_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'plan-rework.md');
export const PLAN_CHECKS_PATH = join(process.cwd(), 'config', 'plan-checks.yaml');
export const PLAN_CONTINUATION_PROMPT = [
  'Rewrite the full implementation plan and include every required Markdown section title.',
  'Return one complete plan response; do not describe the previous failed attempt.',
].join('\n');

export interface PlanChecks {
  requiredTitles: string[];
}

export interface PlanResponseValidation {
  passed: boolean;
  missingTitles: string[];
  failureReason?: string;
}

export interface PlanPromptInput {
  issue: Pick<GitHubIssue, 'number' | 'title' | 'body'>;
  latestPlanContent?: string;
  commentsMarkdown?: string;
}

export interface PlanningSession {
  send(prompt: string): Promise<string>;
  close?(): Promise<void>;
}

export interface PlanRunOptions {
  promptTemplatePath?: string;
  checksPath?: string;
  createPlanningSession?: (input: {
    workspacePath: string;
    logger: ReturnType<typeof createJobLogger>;
  }) => Promise<PlanningSession>;
}

export interface PlanWorkResult {
  output: PlanOutput;
  developJobData?: DevelopJobData;
}

async function runCodexOnce(
  prompt: string,
  workspacePath: string,
  logger: ReturnType<typeof createJobLogger>,
  resumeLastSession: boolean
): Promise<string> {
  const result = await runCodexSession({
    prompt,
    workspacePath,
    logger,
    resumeLastSession,
    outputLastMessage: true,
    logPrefix: 'plan-codex',
    timeoutLabel: 'plan codex process',
  });
  return result.output;
}

async function createDefaultPlanningSession(input: {
  workspacePath: string;
  logger: ReturnType<typeof createJobLogger>;
}): Promise<PlanningSession> {
  let hasStartedSession = false;
  return {
    async send(prompt: string) {
      const response = await runCodexOnce(prompt, input.workspacePath, input.logger, hasStartedSession);
      hasStartedSession = true;
      return response;
    },
  };
}

export async function renderPlanPrompt(templatePath: string, input: PlanPromptInput): Promise<string> {
  const template = await readFile(templatePath, 'utf8');
  const replacements: Record<string, string> = {
    issueNumber: String(input.issue.number),
    issueTitle: input.issue.title,
    issueDescription: input.issue.body?.trim() ? input.issue.body : '(No description provided)',
    latestPlanContent: input.latestPlanContent ?? '',
    commentsMarkdown: input.commentsMarkdown ?? '',
  };

  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key: string) => replacements[key] ?? match);
}

export async function loadPlanChecks(checksPath: string): Promise<PlanChecks> {
  const raw = await readFile(checksPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`Failed to parse Plan checks YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Plan checks YAML must be an object');
  }
  const requiredTitles = (parsed as { requiredTitles?: unknown }).requiredTitles;
  if (!Array.isArray(requiredTitles) || requiredTitles.length === 0) {
    throw new Error('requiredTitles must be a non-empty array');
  }
  if (!requiredTitles.every((title) => typeof title === 'string' && title.trim().length > 0)) {
    throw new Error('requiredTitles must contain only non-empty strings');
  }

  return { requiredTitles: requiredTitles.map((title) => title.trim()) };
}

export function validatePlanResponse(content: string, checks: PlanChecks): PlanResponseValidation {
  const headings = new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]?.trim().toLowerCase())
      .filter((heading): heading is string => Boolean(heading))
  );
  const missingTitles = checks.requiredTitles.filter((title) => !headings.has(title.trim().toLowerCase()));

  if (missingTitles.length === 0) {
    return { passed: true, missingTitles: [] };
  }

  return {
    passed: false,
    missingTitles,
    failureReason: `Missing required plan section titles: ${missingTitles.join(', ')}`,
  };
}

export async function runPlanWork(job: Job<PlanJobData>, options: PlanRunOptions = {}): Promise<PlanWorkResult> {
  stagePayloadSchemas.plan.parse(job.data);
  const context = await resolvePlanContext(job.data);
  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  const logger = createJobLogger(job);
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: 'Blast Furnace is planning the solution',
    focus: 'Current focus: Plan solution',
    items: [statusItem('plan', 1, 'in-progress', 'Plan solution', 'In progress', job.data.reworkAttempt)],
  }, logger);
  const checks = await loadPlanChecks(options.checksPath ?? PLAN_CHECKS_PATH);
  const initialPrompt = context.inputKind === 'pr-rework'
    ? await renderPlanPrompt(options.promptTemplatePath ?? PLAN_REWORK_PROMPT_TEMPLATE_PATH, {
        issue: context.runContext.issue,
        latestPlanContent: context.latestPlan?.content,
        commentsMarkdown: context.commentsMarkdown,
      })
    : await renderPlanPrompt(options.promptTemplatePath ?? PLAN_PROMPT_TEMPLATE_PATH, {
        issue: context.runContext.issue,
      });
  const session = await (options.createPlanningSession ?? createDefaultPlanningSession)({
    workspacePath: context.runContext.workspacePath,
    logger,
  });

  let dependencies: Array<InputRecordRef | HandoffRecordDependency> = context.inputKind === 'pr-rework' && context.latestPlanRecord
    ? [job.data.inputRecordRef, context.latestPlanRecord.recordId]
    : [job.data.inputRecordRef];
  let latestOutput: PlanOutput | undefined;
  try {
    for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 1 ? initialPrompt : PLAN_CONTINUATION_PROMPT;
      const content = await session.send(prompt);
      const validation = validatePlanResponse(content, checks);
      const isFinalAttempt = attempt === MAX_PLAN_ATTEMPTS;
      const output = stageOutputSchemas.plan.parse({
        status: validation.passed ? 'success' : 'validation-failed',
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        plan: validation.passed
          ? {
              status: 'success',
              summary: 'Plan validated successfully.',
              content,
            }
          : {
              status: 'validation-failed',
              summary: 'Plan validation failed.',
              content,
              failureReason: validation.failureReason,
            },
      }) as PlanOutput;
      latestOutput = output;

      if (validation.passed) {
        const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
          runId: job.data.runId,
          fromStage: 'plan',
          toStage: 'develop',
          stageAttempt: job.data.stageAttempt,
          reworkAttempt: job.data.reworkAttempt,
          dependsOn: dependencies,
          status: 'success',
          output,
        });
        await updateRunStatus(orchestrationRoot, job.data.runId, {
          heading: 'Blast Furnace is building a solution',
          focus: 'Current focus: Develop changes',
          items: [
            statusItem('plan', 1, 'completed', 'Plan solution', undefined, job.data.reworkAttempt),
            statusItem('develop', 1, 'pending', 'Develop changes', undefined, job.data.reworkAttempt),
          ],
        }, logger);

        return {
          output,
          developJobData: createForwardStagePayload(job.data, 'develop', inputRecordRef) as DevelopJobData,
        };
      }

      const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId: job.data.runId,
        fromStage: 'plan',
        toStage: isFinalAttempt ? null : 'plan',
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: dependencies,
        status: isFinalAttempt ? 'blocked' : 'rework-needed',
        output,
      }, isFinalAttempt ? 'blocked' : undefined);
      await updateRunStatus(orchestrationRoot, job.data.runId, {
        heading: isFinalAttempt ? 'Blast Furnace stopped during planning' : 'Blast Furnace is refining the plan',
        focus: isFinalAttempt ? 'Final state: Plan validation exhausted' : 'Current focus: Plan solution',
        items: isFinalAttempt
          ? [
              statusItem('plan', 1, 'blocked', 'Plan solution', 'Validation limit reached', job.data.reworkAttempt),
              statusItem('develop', 1, 'skipped', 'Develop changes', undefined, job.data.reworkAttempt),
              statusItem('quality-gate', 1, 'skipped', 'Quality Gate', undefined, job.data.reworkAttempt),
              statusItem('review', 1, 'skipped', 'Code Review', undefined, job.data.reworkAttempt),
              statusItem('draft-pr-and-in-review', 1, 'skipped', 'Make PR', undefined, job.data.reworkAttempt),
            ]
          : [statusItem('plan', 1, 'retrying', 'Plan solution', 'Validation retry', job.data.reworkAttempt)],
      }, logger);
      dependencies = [inputRecordRef];

      if (isFinalAttempt) {
        return { output };
      }
    }
  } finally {
    await session.close?.();
  }

  if (!latestOutput) {
    throw new Error('Plan did not produce output');
  }
  return { output: latestOutput };
}

export async function runPlanFlow(job: Job<PlanJobData>, options: PlanRunOptions = {}): Promise<void> {
  const logger = createJobLogger(job);

  const result = await runPlanWork(job, options);
  if (!result.developJobData) {
    logger.info(`Planning stopped after ${result.output.status} for run: ${job.data.runId}`);
    return;
  }

  const developJobData = result.developJobData;
  await scheduleNextJob(jobQueue, 'develop', developJobData);
  logger.info(`Develop job enqueued for run: ${job.data.runId}`);
}

export const processPlan = runPlanFlow;
export const planHandler = processPlan;
